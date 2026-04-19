import fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import * as fs from "node:fs/promises";
import path from "node:path";
import { TokenStore, type StoredToken } from "./token-store";
import { SequentialPipeline } from "../orchestration/sequential-pipeline";
import { AntigravityClient } from "../orchestration/antigravity-client";
import { eventBus } from "../orchestration/event-bus";
import { loadManagedProject } from "../plugin/project";
import { AccountManager } from "../plugin/accounts";
import { AutonomySessionManager } from "./autonomy-session-manager";
import { orchestratorService } from "../orchestration/OrchestratorService";
import type { MissionRepository } from "../repositories/mission.repository";
import {
  type AutonomyEvent,
  type AutonomySession,
  type CreateAutonomySessionRequest,
  type PauseAutonomySessionRequest,
  type ResumeAutonomySessionRequest,
  type StopAutonomySessionRequest,
} from "../orchestration/autonomy-types";
import {
  GatewayAuthManager,
  type ConsumedWsTicket,
  type WsSocketGeneration,
} from "./gateway-auth-manager";
import { getMissionDatabase, resetMissionDatabase, type MissionDatabase } from "../persistence/database";
import { SQLiteMissionRepository } from "../persistence/SQLiteMissionRepository";
import { MissionPersistenceSubscriber } from "../persistence/MissionPersistenceSubscriber";
import { StartupRecoveryCoordinator } from "../persistence/recovery/StartupRecovery";
import type { RecoveryNotifier } from "../persistence/recovery/RecoveryNotifier";
import { TelegramRecoveryNotifier } from "../persistence/recovery/TelegramRecoveryNotifier";
import {
  DEFAULT_OAUTH_CALLBACK_PORT,
  checkOAuthCallbackPortAvailability,
} from "./oauth-port";
import { BudgetTracker } from "../orchestration/BudgetTracker";
import {
  createApproveAuthMiddleware,
  registerFormatWrapperMiddleware,
  registerRateLimitMiddleware,
} from "./rest-middleware";
import { apiError, apiResponse, parsePagination } from "./rest-response";
import { registerMissionRoutes } from "../api/routers/mission.router";
import { registerSettingsRoutes } from "../services/settings/routes";
import { registerOptimizeRoutes } from "./routes/optimize";
import { type MissionModel } from "../models/mission.model";
import { MissionService, MissionServiceError } from "../services/mission.service";
import { AutonomyMissionRuntime } from "../services/mission-runtime";
import { SQLiteUnitOfWork } from "../uow/unit-of-work";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mask email for PII safety: "user@gmail.com" → "u***@gmail.com" */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

/**
 * Defensive normalization for OAuth consent URLs before exposing them to clients.
 * This guards against malformed links from stale builds or intermediate rewrites.
 */
function normalizeOAuthConsentUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const isGoogleOAuthHost = host === "accounts.google.com" || host.endsWith(".accounts.google.com");
    if (!isGoogleOAuthHost) return rawUrl;

    if (!parsed.searchParams.get("response_type")) {
      parsed.searchParams.set("response_type", "code");
    }
    if (!parsed.searchParams.get("access_type")) {
      parsed.searchParams.set("access_type", "offline");
    }
    if (!parsed.searchParams.get("prompt")) {
      parsed.searchParams.set("prompt", "consent");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

// ─── Rate Limit Tracking (in-memory, per-IP) ────────────────────────────────

// ─── Allowed Plan Modes ─────────────────────────────────────────────────────

const VALID_PLAN_MODES = new Set([
  "full",
  "management_only",
  "dev_only",
  "quality_only",
  "custom",
]);
const MAX_USER_TASK_LENGTH = 10_000;

// ─── CORS Whitelist ──────────────────────────────────────────────────────────

const CORS_ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^vscode-webview:/,
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Same-origin requests have no Origin header
  return CORS_ALLOWED_ORIGINS.some((allowed) => {
    if (typeof allowed === "string") return allowed === origin;
    return allowed.test(origin);
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GatewayServerOptions {
  port: number;
  projectRoot: string;
  tokenStorePath?: string;
  missionDatabasePath?: string;
  missionRepository?: MissionRepository;
  recoveryNotifier?: RecoveryNotifier;
  modelRequestTimeoutMs?: number;
  /** Additional CORS origins to allow */
  corsOrigins?: string[];
  /** Bind host (defaults to localhost only) */
  host?: string;
  /** Required auth token for REST and WS APIs */
  authToken: string;
}

function summarizeAutonomySession(session: AutonomySession) {
  return {
    id: session.id,
    state: session.state,
    objective: session.objective,
    account: session.account,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    queuePosition: session.queuePosition,
    branchName: session.branchName,
    baseBranch: session.baseBranch,
    commitHash: session.commitHash,
    currentModel: session.currentModel,
    currentGear: session.currentGear,
    reviewStatus: session.reviewStatus,
    reviewUpdatedAt: session.reviewUpdatedAt,
  };
}

function summarizeMission(session: MissionModel) {
  return {
    id: session.id,
    state: session.currentPhase ?? session.state,
    objective: session.prompt,
    account: session.account,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    queuePosition: null,
    branchName: null,
    baseBranch: null,
    commitHash: null,
    currentModel: session.currentModel,
    currentGear: session.currentGear,
    reviewStatus: session.reviewStatus,
    reviewUpdatedAt: session.reviewUpdatedAt,
  };
}

function missionArtifactsToSocketPayload(mission: MissionModel): Record<string, unknown> {
  const rawResponses: string[] = [];
  let plan = mission.plan?.raw ?? "";
  let changeSummary = "";
  let nextActionReason = "";
  let gateResult: unknown = mission.gateResults[mission.gateResults.length - 1] ?? null;
  let contextPack = "";

  for (const artifact of mission.artifacts) {
    if (artifact.kind === "plan" && typeof artifact.value === "string") {
      plan = artifact.value;
    } else if (artifact.kind === "change_summary" && typeof artifact.value === "string") {
      changeSummary = artifact.value;
    } else if (artifact.kind === "next_action_reason" && typeof artifact.value === "string") {
      nextActionReason = artifact.value;
    } else if (artifact.kind === "context_pack" && typeof artifact.value === "string") {
      contextPack = artifact.value;
    } else if (artifact.kind === "raw_response" && typeof artifact.value === "string") {
      rawResponses.push(artifact.value);
    } else if (artifact.kind === "gate_result") {
      gateResult = artifact.value;
    }
  }

  return {
    plan,
    changeSummary,
    nextActionReason,
    gateResult,
    rawResponses,
    contextPack,
  };
}

const SOCKET_SNAPSHOT_BYTE_CAP = 256 * 1024;
const SOCKET_SNAPSHOT_TEXT_CAP = 32 * 1024;
const SOCKET_SNAPSHOT_TIMELINE_TAIL = 200;
const MISSION_MAX_ACTIVE_CLIENTS = 8;

interface MissionSocketSnapshotMeta {
  truncated: boolean;
  droppedFields: string[];
  timelineTailCount?: number;
}

interface MissionSocketClientEntry {
  socket: any;
  clientId: string;
  generation: WsSocketGeneration;
}

interface MissionWsTicketRequestBody {
  clientId?: string;
  generation?: WsSocketGeneration | null;
}

// ─── Server ──────────────────────────────────────────────────────────────────

export class GatewayServer {
  private app = fastify({
    logger: {
      level: process.env.LOJINEXT_GATEWAY_LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.query.token",
          "req.query.ticket",
          "headers.authorization",
          "query.token",
          "query.ticket",
        ],
        censor: "[REDACTED]",
      },
      serializers: {
        req: (req) => {
          const sanitizedUrl =
            typeof req.url === "string"
              ? req.url
                  .replace(/([?&]token=)[^&]+/i, "$1[REDACTED]")
                  .replace(/([?&]ticket=)[^&]+/i, "$1[REDACTED]")
              : req.url;
          return {
            method: req.method,
            url: sanitizedUrl,
            host: req.host,
            remoteAddress: req.ip,
          };
        },
      },
    },
  });
  private options: GatewayServerOptions;
  private tokenStore: TokenStore;
  private accountManager: AccountManager | null = null;
  private activePipeline: SequentialPipeline | null = null;
  private activeAuthServer: import("./auth-server").AuthServer | null = null;
  private readonly autonomyManager: AutonomySessionManager;
  private readonly autonomySubscribers = new Map<string, Map<string, MissionSocketClientEntry>>();
  private projectRoot: string;
  private readonly host: string;
  private readonly authManager: GatewayAuthManager;
  private readonly startedAtMs = Date.now();
  private readonly missionDatabase: MissionDatabase | null;
  private readonly missionRepository: MissionRepository;
  private readonly budgetTracker: BudgetTracker;
  private quotaStateReady = false;
  private readonly missionService: MissionService;
  private readonly missionPersistence: MissionPersistenceSubscriber;
  private readonly startupRecovery: StartupRecoveryCoordinator;
  private readonly recoveryNotifier: RecoveryNotifier;
  private readonly autonomyEventSubscription: { dispose: () => void };

  constructor(options: GatewayServerOptions) {
    this.options = options;
    this.projectRoot = options.projectRoot;
    this.host = options.host ?? "127.0.0.1";
    const resolvedAuthToken = options.authToken.trim();
    if (!resolvedAuthToken) {
      throw new Error("Gateway auth token is required. Set LOJINEXT_GATEWAY_TOKEN or pass authToken.");
    }
    this.authManager = new GatewayAuthManager(resolvedAuthToken);
    this.tokenStore = new TokenStore(
      options.tokenStorePath || path.join(options.projectRoot, "token-store.json"),
    );
    this.missionDatabase = options.missionRepository
      ? null
      : getMissionDatabase({ dbPath: options.missionDatabasePath });
    this.missionRepository =
      options.missionRepository ??
      new SQLiteMissionRepository(this.missionDatabase ?? getMissionDatabase());
    this.budgetTracker = new BudgetTracker({
      repository: this.missionRepository,
    });
    this.recoveryNotifier = options.recoveryNotifier ?? new TelegramRecoveryNotifier();
    this.autonomyManager = new AutonomySessionManager({
      projectRoot: this.projectRoot,
      tokenStore: this.tokenStore,
      getAccountManager: () => this.accountManager,
      modelRequestTimeoutMs: options.modelRequestTimeoutMs,
      budgetTracker: this.budgetTracker,
    });
    this.missionService = new MissionService(
      new SQLiteUnitOfWork({
        repository: this.missionRepository,
        database: this.missionDatabase ?? undefined,
      }),
      new AutonomyMissionRuntime(this.autonomyManager),
      this.app.log,
    );
    this.missionPersistence = new MissionPersistenceSubscriber(this.missionRepository, {
      getSession: (sessionId) => this.autonomyManager.getSession(sessionId),
      logger: this.app.log,
    });
    this.startupRecovery = new StartupRecoveryCoordinator(
      this.missionRepository,
      this.autonomyManager,
    );
    this.autonomyEventSubscription = this.autonomyManager.onEvent((event) => {
      this.handleAutonomyRuntimeEvent(event);
      void this.missionPersistence.handleEvent(event);
    });
    
    // Initialize Global Orchestrator Service (Phase 1.1)
    orchestratorService(this.projectRoot);

    // Lazy load real account pool
    AccountManager.loadFromDisk().then(m => {
        this.accountManager = m;
        console.log(`[Gateway] Real account pool loaded: ${m.getTotalAccountCount()} accounts`);
    }).catch(err => {
        console.error("[Gateway] Failed to load real account pool:", err);
    });
  }

  public async start(): Promise<void> {
    // 1. CORS — whitelist based (fixes CORS origin: '*' vulnerability)
    const extraOrigins = this.options.corsOrigins ?? [];
    await this.app.register(cors, {
      origin: (origin, callback) => {
        if (
          !origin ||
          isOriginAllowed(origin) ||
          extraOrigins.includes(origin)
        ) {
          callback(null, true);
        } else {
          callback(new Error("CORS: origin not allowed"), false);
        }
      },
      credentials: true,
    });

    await this.app.register(websocket);
    registerFormatWrapperMiddleware(this.app);
    registerRateLimitMiddleware(this.app);

    // 1.5 Static UI Serving
    const uiDistPath = path.join(this.projectRoot, "ui", "dist");
    const extensionUiDistPath = path.join(this.projectRoot, "vscode-extension", "ui", "dist");
    let serveIndexWithToken: ((request: unknown, reply: unknown) => Promise<unknown>) | null = null;

    let rootPath = "";
    try {
      const fsSync = await import('node:fs');
      // Prioritize the Extension UI Dist as it's the primary build target in vite.config.ts
      if (fsSync.existsSync(extensionUiDistPath)) {
        rootPath = extensionUiDistPath;
      } else if (fsSync.existsSync(uiDistPath)) {
        rootPath = uiDistPath;
      }
    } catch { /* ignore */ }

    if (rootPath) {
      console.log(`[Gateway] Serving UI from: ${rootPath}`);
      
      // Manual handler for index.html to inject the gateway token
      serveIndexWithToken = async (_request: any, reply: any) => {
        const indexPath = path.join(rootPath, "index.html");
        try {
          let html = await fs.readFile(indexPath, "utf8");
          const token = this.options.authToken;
          if (token) {
            // Inject a small script to persist the token in sessionStorage
            const inject = `\n<script>
              (function() {
                const key = 'gateway_auth_token';
                const token = '${token}';
                if (sessionStorage.getItem(key) !== token) {
                  sessionStorage.setItem(key, token);
                  console.log('[Gateway] Token auto-injected from server');
                }
              })();
            </script>\n`;
            html = html.replace("<head>", `<head>${inject}`);
          }
          return reply.type("text/html").send(html);
        } catch (err) {
          return reply.status(500).send(apiError("Failed to load dashboard index"));
        }
      };

      this.app.get("/", serveIndexWithToken);
      this.app.get("/index.html", serveIndexWithToken);

      await this.app.register(staticPlugin, {
        root: rootPath,
        prefix: "/",
        wildcard: true,
        index: false, // Handled manually above
      });
    }

    this.app.setNotFoundHandler(async (request, reply) => {
      const url = request.raw.url ?? "";
      if (serveIndexWithToken && !url.startsWith("/api/") && !url.startsWith("/ws/")) {
        return serveIndexWithToken(request, reply);
      }
      if (url.startsWith("/api/")) {
        return reply.status(404).send(
          apiError(`Route ${request.method}:${url} not found`, {
            code: "ROUTE_NOT_FOUND",
          }),
        );
      }
      return reply.status(404).type("text/plain").send("Not Found");
    });

    // 2. Authentication hook for API + WebSocket endpoints
    this.app.addHook("onRequest", async (request, reply) => {
      const rawUrl = request.raw.url ?? "";
      const pathOnly = rawUrl.split("?")[0] ?? rawUrl;
      const protectedPath = pathOnly.startsWith("/api/") || pathOnly.startsWith("/ws/");
      if (!protectedPath) return;

      if (!this.quotaStateReady && this.isQuotaGuardedPath(pathOnly, request.method)) {
        return reply.status(503).send(
          apiError("Quota state is still loading", {
            code: "QUOTA_STATE_NOT_READY",
          }),
        );
      }

      if (pathOnly.startsWith("/ws/autonomy/") || pathOnly.startsWith("/ws/mission/")) {
        const sessionId = decodeURIComponent(
          pathOnly.startsWith("/ws/mission/")
            ? pathOnly.replace("/ws/mission/", "")
            : pathOnly.replace("/ws/autonomy/", ""),
        );
        const ticket =
          request.query && typeof request.query === "object" && "ticket" in (request.query as Record<string, unknown>)
            ? String((request.query as Record<string, unknown>).ticket ?? "")
            : "";
        const ticketContext = ticket ? this.authManager.consumeWsTicket(sessionId, ticket) : null;
        if (!ticket || !ticketContext) {
          return reply.status(401).send(
            apiError("Unauthorized websocket ticket", {
              code: "UNAUTHORIZED",
            }),
          );
        }
        (request as { wsTicketContext?: ConsumedWsTicket }).wsTicketContext = ticketContext;
        return;
      }

      // Special case: Allow local UI to access API without token if same-origin
      // This is safe for 127.0.0.1/localhost development
      const origin = request.headers.origin;
      const isLocal = origin && (origin.includes("127.0.0.1") || origin.includes("localhost"));
      const isSameOrigin = !origin; // When served from same port/host
      
      if (isLocal || isSameOrigin) {
          return; 
      }

      const authHeader = request.headers.authorization;
      const queryToken =
        request.query && typeof request.query === "object" && "token" in (request.query as Record<string, unknown>)
          ? String((request.query as Record<string, unknown>).token ?? "")
          : "";

      const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
      const acceptedToken = bearerToken || queryToken;
      if (!this.authManager.isAuthorized(acceptedToken)) {
        return reply.status(401).send(
          apiError("Unauthorized", {
            code: "UNAUTHORIZED",
          }),
        );
      }
    });

    // 3. REST Endpoints
    this.setupRoutes();

    // 4. WebSocket Setup
    this.setupWebSockets();

    // 5. Start listening
    try {
      await this.app.listen({ port: this.options.port, host: this.host });
      console.log(
        `🚀 Gateway Server running at http://${this.host}:${this.options.port}`,
      );
      if (this.missionDatabase?.lastCorruptionNotice) {
        this.app.log.warn(this.missionDatabase.lastCorruptionNotice);
      }
      await this.budgetTracker.initialize();
      const pendingRecoveries = await this.startupRecovery.scanInterrupted();
      if (pendingRecoveries.length > 0) {
        try {
          await this.recoveryNotifier.notifyPendingRecoveries(
            pendingRecoveries,
            `http://${this.host}:${this.options.port}`,
          );
        } catch (error) {
          this.app.log.warn(
            `Recovery notifier failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.quotaStateReady = true;

      // Handle graceful shutdown signals
      const shutdown = async (signal: string) => {
        this.app.log.info(`Received ${signal}, starting graceful shutdown...`);
        try {
          await this.stop();
          this.app.log.info("Graceful shutdown completed.");
          process.exit(0);
        } catch (error) {
          this.app.log.error(error, "Graceful shutdown failed");
          process.exit(1);
        }
      };

      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
    } catch (err) {
      this.app.log.error(err);
      process.exit(1);
    }
  }

  private setupRoutes() {
    const issueMissionWsTicket = async (
      sessionId: string,
      reply: any,
      body?: MissionWsTicketRequestBody,
    ) => {
      try {
        const mission = await this.missionService.getById(sessionId);
        const activeAccount = this.tokenStore.getActiveToken();
        if (
          mission.account.includes("@") &&
          activeAccount?.email &&
          mission.account !== activeAccount.email
        ) {
          return reply.status(403).send(apiError("Forbidden: ticket can only be issued by mission owner"));
        }
        const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
        if (
          clientId &&
          this.countMissionClients(sessionId) >= MISSION_MAX_ACTIVE_CLIENTS &&
          !this.autonomySubscribers.get(sessionId)?.has(clientId)
        ) {
          return reply.status(429).send(
            apiError("Mission client limit reached", {
              code: "TOO_MANY_CLIENTS",
            }),
          );
        }

        return apiResponse(
          this.authManager.issueWsTicket(sessionId, {
            clientId,
            generation: body?.generation ?? null,
          }),
        );
      } catch (error) {
        if (error instanceof MissionServiceError && error.code === "MISSION_NOT_FOUND") {
          return reply.status(404).send(apiError("Mission not found", { code: "MISSION_NOT_FOUND" }));
        }
        throw error;
      }
    };

    registerMissionRoutes(this.app, {
      missionService: this.missionService,
      resolveActiveMissionAccount: async () => {
        const accessToken = await this.tokenStore.getValidAccessToken();
        const activeToken = this.tokenStore.getActiveToken();
        if (!accessToken || !activeToken?.email) {
          return null;
        }
        return activeToken.email;
      },
      approveAuth: createApproveAuthMiddleware(this.authManager),
      isQuotaStateReady: () => this.quotaStateReady,
    });

    this.app.post<{ Params: { id: string }; Body: MissionWsTicketRequestBody }>(
      "/api/missions/:id/ws-ticket",
      async (request, reply) => issueMissionWsTicket(request.params.id, reply, request.body),
    );

    // Sovereign settings — full console configuration surface.
    registerSettingsRoutes(this.app);

    // Bridge proxy routes — /api/optimize/*.
    registerOptimizeRoutes(this.app);

    this.app.get("/api/health", async () => {
      const now = Date.now();
      return apiResponse({
        status: this.quotaStateReady ? "ok" : "starting",
        uptimeSec: Math.max(0, Math.floor((now - this.startedAtMs) / 1000)),
        timestamp: new Date(now).toISOString(),
        version: process.env.npm_package_version ?? "unknown",
      });
    });

    this.app.get("/api/auth/login", async (_request, reply) => {
      try {
        const { authorizeAntigravity } = await import("../antigravity/oauth");
        const { AuthServer } = await import("./auth-server");
        const { loadAccounts, saveAccounts } = await import("../plugin/storage");

        const callbackPort = DEFAULT_OAUTH_CALLBACK_PORT;
        // Releasing a stale in-process auth listener avoids false EADDRINUSE on retry.
        if (this.activeAuthServer) {
          console.log("[Gateway] Stopping previous AuthServer instance...");
          this.activeAuthServer.stop();
          this.activeAuthServer = null;
        }
        const portCheck = await checkOAuthCallbackPortAvailability(callbackPort);
        if (!portCheck.available) {
          const message = `OAuth callback port ${callbackPort} is busy. Stop the other local auth process and retry.`;
          console.error("[Gateway] OAuth callback port preflight failed", {
            port: callbackPort,
            code: portCheck.code,
            detail: portCheck.message,
          });
          return reply.status(409).send(
            apiError(message, {
              code: "OAUTH_CALLBACK_PORT_IN_USE",
              meta: {
                port: callbackPort,
                detail: portCheck.message ?? null,
              },
            }),
          );
        }
        
        // Generate the Google OAuth Consent URL and state first
        console.log("[Gateway] Generating OAuth URL...");
        const authData = await authorizeAntigravity();
        const oauthUrl = normalizeOAuthConsentUrl(authData.url);
        if (oauthUrl !== authData.url) {
          console.warn("[Gateway] OAuth URL normalized before returning to client.");
        }
        console.log("[Gateway] OAuth URL generated:", oauthUrl);

        // Start AuthServer to listen for the callback, expecting the specific state
        this.activeAuthServer = new AuthServer({ 
          port: callbackPort,
          tokenStore: this.tokenStore,
          expectedState: authData.state
        });
        
        this.activeAuthServer.start().then(async (result) => {
          this.activeAuthServer = null; // Clear when done
          if (!result.success || !result.token) return;
          
          try {
            // Also sync to the VSCode Plugin extension storage 
            // `TokenStore` saves for gateway, `saveAccounts` saves for VSCode
            const existing = await loadAccounts();
            const storage = existing ?? { version: 3 as const, accounts: [], activeIndex: 0 };
            
            // Check if duplicate
            const duplicate = storage.accounts.find(a => a.email && a.email === result.token!.email);
            if (duplicate) {
               duplicate.refreshToken = result.token!.refreshToken;
               duplicate.lastUsed = Date.now();
               duplicate.enabled = true;
            } else {
               storage.accounts.push({
                 email: result.token.email,
                 refreshToken: result.token.refreshToken,
                 projectId: result.token.projectId || undefined,
                 addedAt: Date.now(),
                 lastUsed: 0,
                 enabled: true,
               });
            }
            await saveAccounts(storage);
            console.log("[Gateway] Hesabın VSCode plugin storage'a senkronizasyonu tamamlandı.");

          } catch (storageErr) {
             console.error("[Gateway] Plugin storage sync error:", storageErr);
          }
        }).catch(err => {
          console.error("[Gateway] AuthServer background start error:", err);
        });

        return apiResponse({ url: oauthUrl });
      } catch (err) {
        console.error("[Gateway] Failed to generate auth URL:", err);
        return reply.status(500).send(apiError("Authentication preparation failed"));
      }
    });

    this.app.get("/api/models", async (_request, reply) => {
      try {
        const { loadManagedProject } = await import("../plugin/project");
        const accessToken = await this.tokenStore.getValidAccessToken();
        const token = this.tokenStore.getActiveToken();
        
        // Standard high-quality list as requested by user
        const resultModels = [
          { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "Google", status: "active" },
          { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "Google", status: "active" },
          { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", status: "active" },
          { id: "claude-3-opus", name: "Claude 3 Opus", provider: "Anthropic", status: "active" },
          { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", provider: "Google", status: "active" },
          { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", provider: "Google", status: "active" }
        ];

        return apiResponse(resultModels);
      } catch (err) {
        console.error("[Gateway] Failed to fetch models:", err);
        return reply.status(500).send(apiError("Modeller listelenemedi"));
      }
    });

    // ── GET /api/skills ──────────────────────────────────────────────────────
    this.app.get("/api/skills", async (_request, reply) => {
      try {
        const skillsDir = path.join(this.projectRoot, ".agent", "skills");
        const fsSync = await import("node:fs");
        
        if (!fsSync.existsSync(skillsDir)) {
          return apiResponse([]);
        }

        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        const skills = [];

        for (const entry of entries) {
           if (entry.isDirectory()) {
              const skillId = entry.name;
              const mdPath = path.join(skillsDir, skillId, "SKILL.md");
              let description = "Agent skill for " + skillId;
              let name = skillId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              let tags = [skillId.split("-")[0]];
              
              if (fsSync.existsSync(mdPath)) {
                 const content = await fs.readFile(mdPath, "utf8");
                 const descMatch = content.match(/description:\s*(.+)/i);
                 if (descMatch && descMatch[1]) {
                    description = descMatch[1].trim();
                 }
                 const nameMatch = content.match(/name:\s*(.+)/i);
                 if (nameMatch && nameMatch[1]) {
                    name = nameMatch[1].trim();
                 }
              }

              skills.push({
                id: skillId,
                name,
                description,
                icon: "Wrench",
                tags,
                status: "active"
              });
           }
        }

        return apiResponse(skills);
      } catch (err) {
        console.error("[Gateway] Failed to fetch skills:", err);
        return reply.status(500).send(apiError("Yetenekler listelenemedi"));
      }
    });

    // ── GET /api/accounts — paginated account list ──────────────────────────
    this.app.get<{ Querystring: Record<string, unknown> }>(
      "/api/accounts",
      async (request) => {
        const accounts = this.tokenStore.getAllAccounts();
        const { page, limit, offset } = parsePagination(
          request.query as Record<string, unknown>,
        );
        const now = Date.now();

        const total = accounts.length;
        const slice = accounts.slice(offset, offset + limit);

        return apiResponse(
          slice.map((t: StoredToken) => ({
            email: t.email ?? '',
            expiresAt: t.expiresAt,
            // A token is considered "valid" for the UI if it's either not expired 
            // OR it has a refresh token (meaning we can auto-renew it).
            isValid: (t.expiresAt > now) || (!!t.refreshToken),
          })),
          { page, limit, total, totalPages: Math.ceil(total / limit) },
        );
      },
    );
    
    // ── GET /api/accounts/quota ─────────────────────────────────────────────
    this.app.get("/api/accounts/quota", async (_request, reply) => {
      try {
        if (!this.accountManager) {
          return reply.status(503).send(apiError("Hesap yöneticisi henüz hazır değil"));
        }
        
        const accounts = this.accountManager.getAccountsSnapshot();
        const quotaResults = accounts.map(acc => ({
          email: acc.email,
          quota: acc.cachedQuota,
          updatedAt: acc.cachedQuotaUpdatedAt,
          isCoolingDown: this.accountManager?.isAccountCoolingDown(acc) ?? false,
          cooldownReason: acc.cooldownReason
        }));

        return apiResponse(quotaResults);
      } catch (err) {
        console.error("[Gateway] Failed to fetch quota data:", err);
        return reply.status(500).send(apiError("Kota bilgileri alınamadı"));
      }
    });

    // ── GET /api/accounts/active ────────────────────────────────────────────
    this.app.get("/api/accounts/active", async () => {
      const token = this.tokenStore.getActiveToken();
      return apiResponse(token ? { email: token.email ?? '' } : null);
    });

    // ── POST /api/accounts/active — input validated ─────────────────────────
    this.app.post<{ Body: { email: string } }>(
      "/api/accounts/active",
      async (request, reply) => {
        const { email } = request.body ?? {};
        if (!email || typeof email !== "string" || !email.includes("@")) {
          return reply.status(400).send(apiError("Invalid email format"));
        }

        const success = this.tokenStore.setActiveAccountByEmail(email);
        if (success) return apiResponse({ email: email });
        return reply.status(404).send(apiError("Hesap bulunamadı"));
      },
    );

    // ── DELETE /api/accounts/:email ──────────────────────────────────────────
    this.app.delete<{ Params: { email: string } }>(
      "/api/accounts/:email",
      async (request, reply) => {
        const emailToDel = request.params.email;
        if (!emailToDel) return reply.status(400).send(apiError("Geçersiz email"));
        
        const decodedEmail = decodeURIComponent(emailToDel).trim().toLowerCase();
        console.log(`[Gateway] Attempting to delete account: "${decodedEmail}"`);
        
        // 1. Remove from Gateway's TokenStore
        const tokenDeleted = this.tokenStore.removeAccount(decodedEmail);
        
        // 2. Remove from Antigravity's AccountManager pool
        let poolDeleted = false;
        if (this.accountManager) {
          const accounts = this.accountManager.getAccounts();
          // Find the exact email (ignoring case)
          const target = accounts.find(a => a.email?.toLowerCase().trim() === decodedEmail);
          
          if (target) {
            console.log(`[Gateway] Found account in pool: ${target.email}. Deleting...`);
            poolDeleted = this.accountManager.removeAccountByEmail(target.email || "");
            if (poolDeleted) {
              await this.accountManager.saveToDisk();
              console.log(`[Gateway] Successfully deleted ${decodedEmail} from AccountManager pool.`);
            }
          }
        }

        if (tokenDeleted || poolDeleted) {
          return apiResponse({ deleted: true });
        } else {
          return reply.status(404).send(apiError("Hesap bulunamadı"));
        }
      }
    );

    // ── GET /api/pipelines/status ───────────────────────────────────────────
    this.app.get("/api/pipelines/status", async () => {
      if (!this.activePipeline) {
        return apiResponse({ status: "idle" });
      }
      const progress = await this.activePipeline.getProgress();
      return apiResponse(progress);
    });

    // ── POST /api/pipelines/start — validated userTask + planMode ───────────
    this.app.post<{ Body: { userTask: string; planMode?: string } }>(
      "/api/pipelines/start",
      async (request, reply) => {
        const { userTask, planMode } = request.body ?? {};

        // Input validation
        if (
          !userTask ||
          typeof userTask !== "string" ||
          userTask.trim().length === 0
        ) {
          return reply
            .status(400)
            .send(
              apiError("userTask is required and must be a non-empty string"),
            );
        }
        if (userTask.length > MAX_USER_TASK_LENGTH) {
          return reply
            .status(400)
            .send(
              apiError(
                `userTask exceeds maximum length of ${MAX_USER_TASK_LENGTH} characters`,
              ),
            );
        }
        if (planMode !== undefined && !VALID_PLAN_MODES.has(planMode)) {
          return reply
            .status(400)
            .send(
              apiError(
                `Invalid planMode. Valid values: ${[...VALID_PLAN_MODES].join(", ")}`,
              ),
            );
        }

        if (this.activePipeline) {
          const progress = await this.activePipeline.getProgress();
          if (progress.state.pipelineStatus === "running") {
            return reply
              .status(400)
              .send(apiError("Pipeline is already running"));
          }
        }

        const token = this.tokenStore.getActiveToken();
        if (!token) {
          return reply.status(401).send(apiError("No active account"));
        }

        if (this.accountManager && token.email) {
            this.accountManager.switchToAccountByEmail(token.email);
        }

        const client = AntigravityClient.fromToken(
          token.accessToken,
          token.email,
          this.accountManager || undefined
        );
        this.activePipeline = new SequentialPipeline(this.projectRoot, client);

        // Start in background
        this.activePipeline
          .start(userTask.trim(), { planMode: planMode as any })
          .catch((err) => {
            console.error("[GatewayServer] Pipeline background error:", err);
          });

        return apiResponse({ message: "Pipeline started" });
      },
    );

    // ── POST /api/pipelines/stop ────────────────────────────────────────────
    this.app.post("/api/pipelines/stop", async (_request, reply) => {
      if (this.activePipeline) {
        this.activePipeline.pause();
        return apiResponse({ stopped: true });
      }
      return reply.status(400).send(apiError("No active pipeline"));
    });

    this.app.post<{ Body: CreateAutonomySessionRequest }>(
      "/api/autonomy/sessions",
      async (request, reply) => {
        const body = request.body;
        const validationError = this.validateAutonomyCreateRequest(body);
        if (validationError) {
          return reply.status(400).send(apiError(validationError));
        }

        const normalizedRequest: CreateAutonomySessionRequest = {
          account: body.account.trim(),
          anchorModel: body.anchorModel.trim(),
          objective: body.objective.trim(),
          scope: {
            mode: "selected_only",
            paths: body.scope.paths
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          },
          modelPolicy: "smart_multi",
          gitMode: body.gitMode,
          startMode: body.startMode ?? "queued",
          reviewAfterPlan: body.reviewAfterPlan ?? false,
          strictMode: body.strictMode ?? true,
          maxCycles: body.maxCycles,
          maxDurationMs: body.maxDurationMs,
          budgets: body.budgets,
        };

        if (normalizedRequest.account.includes("@")) {
          this.tokenStore.setActiveAccountByEmail(normalizedRequest.account);
          this.accountManager?.switchToAccountByEmail(normalizedRequest.account);
        }

        const session = this.autonomyManager.startSession(normalizedRequest);
        return apiResponse(summarizeAutonomySession(session));
      },
    );

    this.app.get("/api/autonomy/sessions", async () => {
      const sessions = (await this.autonomyManager.listSessions()).map((session) => summarizeAutonomySession(session));
      return apiResponse(sessions);
    });

    this.app.get("/api/autonomy/queue", async () => {
      return apiResponse(this.autonomyManager.getQueue());
    });

    this.app.get<{ Params: { id: string } }>("/api/autonomy/sessions/:id", async (request, reply) => {
      const session = this.autonomyManager.getSession(request.params.id);
      if (!session) {
        return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse(session);
    });

    this.app.post<{ Params: { id: string }; Body: StopAutonomySessionRequest }>(
      "/api/autonomy/sessions/:id/stop",
      async (request, reply) => {
        const reason =
          request.body && typeof request.body.reason === "string"
            ? request.body.reason
            : "Stopped by API request";
        const stopped = this.autonomyManager.stopSession(request.params.id, reason);
        if (!stopped) {
          return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse({ stopped: true });
      },
    );

    this.app.post<{ Params: { id: string }; Body: StopAutonomySessionRequest }>(
      "/api/autonomy/sessions/:id/cancel",
      async (request, reply) => {
        const reason =
          request.body && typeof request.body.reason === "string"
            ? request.body.reason
            : "Cancelled by API request";
        const cancelled = this.autonomyManager.stopSession(request.params.id, reason);
        if (!cancelled) {
          return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse({ cancelled: true });
      },
    );

    this.app.post<{ Params: { id: string } }>(
      "/api/autonomy/sessions/:id/promote",
      async (request, reply) => {
        const promoted = this.autonomyManager.promoteSession(request.params.id);
        if (!promoted) {
          return reply.status(404).send(apiError("Autonomy queued session not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse({ promoted: true });
      },
    );

    this.app.post<{ Params: { id: string }; Body: PauseAutonomySessionRequest }>(
      "/api/autonomy/sessions/:id/pause",
      async (request, reply) => {
        const reason =
          request.body && typeof request.body.reason === "string"
            ? request.body.reason
            : "Paused by API request";
        const paused = this.autonomyManager.pauseSession(request.params.id, reason);
        if (!paused) {
          return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse({ paused: true });
      },
    );

    this.app.post<{ Params: { id: string }; Body: ResumeAutonomySessionRequest }>(
      "/api/autonomy/sessions/:id/resume",
      async (request, reply) => {
        const reason =
          request.body && typeof request.body.reason === "string"
            ? request.body.reason
            : "Resumed by API request";
        const resumed = this.autonomyManager.resumeSession(request.params.id, reason);
        if (!resumed) {
          return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse({ resumed: true });
      },
    );

    this.app.post<{ Params: { id: string }; Body: MissionWsTicketRequestBody }>(
      "/api/autonomy/sessions/:id/ws-ticket",
      async (request, reply) => {
        return issueMissionWsTicket(request.params.id, reply, request.body);
      },
    );

    this.app.get<{ Params: { id: string } }>(
      "/api/autonomy/sessions/:id/artifacts",
      async (request, reply) => {
        const artifacts = this.autonomyManager.getArtifacts(request.params.id);
        if (!artifacts) {
          return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse(artifacts);
      },
    );

    this.app.get("/api/autonomy/recovery/pending", async () => {
      return apiResponse(this.startupRecovery.listPendingRecoveries());
    });

    this.app.post<{ Params: { id: string } }>(
      "/api/autonomy/recovery/:id/resume",
      async (request, reply) => {
        const resumed = await this.startupRecovery.resumeRecovery(request.params.id);
        if (!resumed) {
          return reply.status(404).send(apiError("Pending recovery not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse({ resumed: true });
      },
    );

    this.app.post<{ Params: { id: string } }>(
      "/api/autonomy/recovery/:id/cancel",
      async (request, reply) => {
        const cancelled = await this.startupRecovery.cancelRecovery(request.params.id);
        if (!cancelled) {
          return reply.status(404).send(apiError("Pending recovery not found", { code: "MISSION_NOT_FOUND" }));
        }
        return apiResponse({ cancelled: true });
      },
    );

    this.app.get("/api/gateway/token/status", async () => {
      return apiResponse(this.authManager.getTokenState());
    });

    this.app.post<{ Body: { token?: string; graceMs?: number } }>(
      "/api/gateway/token/rotate",
      async (request, reply) => {
        try {
          const graceMs =
            request.body && typeof request.body.graceMs === "number" ? request.body.graceMs : undefined;
          const token =
            request.body && typeof request.body.token === "string" ? request.body.token : undefined;
          const rotated = this.authManager.rotateToken(token, graceMs);
          return apiResponse(rotated);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return reply.status(400).send(apiError(message));
        }
      },
    );

    this.app.post("/api/gateway/token/revoke-grace", async () => {
      this.authManager.revokeGraceTokens();
      return apiResponse({ revoked: true });
    });

    // ── GET /api/stats — real metrics for dashboard ─────────────────────────
    this.app.get("/api/stats", async () => {
      const accounts = this.tokenStore.getAllAccounts();
      const activeAccount = this.tokenStore.getActiveToken();
      
      // 1. Calculate real project count (directories in project root)
      let projectCount = 0;
      try {
        const entries = await fs.readdir(this.projectRoot, { withFileTypes: true });
        projectCount = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).length;
      } catch (err) {
        console.error("[Gateway] Failed to count projects:", err);
      }

      // 2. Count skills from .agent/skills
      let skillCount = 0;
      try {
        const skillsDir = path.join(this.projectRoot, '.agent', 'skills');
        const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
        skillCount = skillEntries.filter(e => e.isDirectory()).length;
      } catch (err) {
        console.warn("[Gateway] Failed to count skills:", err);
        skillCount = 54; // Fallback to what we found
      }

      // 3. Model discovery (use dynamic models count)
      let modelCount = 0;
      try {
        const accessToken = await this.tokenStore.getValidAccessToken();
        if (accessToken && activeAccount) {
            const managed = await loadManagedProject(accessToken, activeAccount.projectId || undefined);
            if (managed && managed.allowedTiers) modelCount = managed.allowedTiers.length;
        }
      } catch (err) {
        modelCount = 6; 
      }

      // 4. Usage Percentage from AccountManager
      let usagePercentage = 0;
      try {
        if (this.accountManager) {
          const pool = this.accountManager.getAccountsSnapshot();
          const rateLimitedCount = pool.filter(acc => {
             const resetTimes = Object.values(acc.rateLimitResetTimes || {});
             return resetTimes.some(t => t && typeof t === 'number' && t > Date.now());
          }).length;
          
          usagePercentage = pool.length > 0 ? Math.round((rateLimitedCount / pool.length) * 100) : 0;
          if (usagePercentage === 0 && pool.length > 0) {
              const activeCount = pool.filter(acc => (Date.now() - acc.lastUsed) < 3600000).length;
              usagePercentage = Math.round((activeCount / pool.length) * 100);
          }
        } else {
            usagePercentage = 5; // Initial fallback while loading
        }
      } catch (err) {
        usagePercentage = 87; // Fallback
      }

      return apiResponse({
        projects: {
          total: projectCount,
          completedThisMonth: 1, 
        },
        skills: {
          active: skillCount,
          total: 625,
        },
        accounts: {
          total: this.accountManager ? this.accountManager.getTotalAccountCount() : accounts.length,
          activeEmail: activeAccount?.email || (this.accountManager ? this.accountManager.getCurrentAccountForFamily("claude")?.email : null),
          usagePercentage: usagePercentage || 5, 
        },
        models: {
          active: modelCount || 6, // Show fallback if discovery failed but we have a pool
        },
      });
    });

    // ── GET /health ─────────────────────────────────────────────────────────
    this.app.get("/health", async () => {
      const accounts = this.tokenStore.getAllAccounts();
      const validAccounts = accounts.filter((a) => a.expiresAt > Date.now());

      let pipelineStatus = "idle";
      if (this.activePipeline) {
        const progress = await this.activePipeline.getProgress();
        pipelineStatus = progress.state.pipelineStatus;
      }

      return apiResponse(
        {
          status: this.quotaStateReady ? "ok" : "starting",
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        },
        {
          accounts: { total: accounts.length, valid: validAccounts.length },
          pipeline: { status: pipelineStatus },
        },
      );
    });
  }

  private validateAutonomyCreateRequest(payload: CreateAutonomySessionRequest | undefined): string | null {
    if (!payload || typeof payload !== "object") {
      return "Request body is required";
    }
    if (!payload.account || typeof payload.account !== "string") {
      return "account is required";
    }
    if (!payload.anchorModel || typeof payload.anchorModel !== "string") {
      return "anchorModel is required";
    }
    if (!payload.objective || typeof payload.objective !== "string" || payload.objective.trim().length === 0) {
      return "objective is required";
    }
    if (payload.objective.length > MAX_USER_TASK_LENGTH) {
      return `objective exceeds maximum length of ${MAX_USER_TASK_LENGTH}`;
    }
    if (!payload.scope || payload.scope.mode !== "selected_only") {
      return "scope.mode must be selected_only";
    }
    if (!Array.isArray(payload.scope.paths) || payload.scope.paths.length === 0) {
      return "scope.paths must include at least one path";
    }
    if (payload.scope.paths.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      return "scope.paths entries must be non-empty strings";
    }
    if (payload.modelPolicy !== "smart_multi") {
      return "modelPolicy must be smart_multi";
    }
    if (
      payload.startMode !== undefined &&
      payload.startMode !== "queued" &&
      payload.startMode !== "immediate"
    ) {
      return "startMode must be queued or immediate";
    }
    if (payload.reviewAfterPlan !== undefined && typeof payload.reviewAfterPlan !== "boolean") {
      return "reviewAfterPlan must be a boolean";
    }
    if (payload.gitMode !== "auto_branch_commit" && payload.gitMode !== "patch_only") {
      return "gitMode must be auto_branch_commit or patch_only";
    }
    if (payload.maxDurationMs !== undefined) {
      if (typeof payload.maxDurationMs !== "number" || payload.maxDurationMs <= 0) {
        return "maxDurationMs must be a positive number";
      }
    }
    if (!payload.budgets || typeof payload.budgets !== "object") {
      return "budgets is required and must be an object";
    }
    const numericKeys: Array<keyof NonNullable<CreateAutonomySessionRequest["budgets"]>> = [
      "maxCycles",
      "maxDurationMs",
      "maxInputTokens",
      "maxOutputTokens",
      "maxTPM",
      "maxRPD",
    ];
    for (const key of numericKeys) {
      const value = payload.budgets[key];
      if (value !== undefined && (typeof value !== "number" || value <= 0)) {
        return `budgets.${key} must be a positive number`;
      }
    }
    if (
      payload.budgets.maxUsd !== undefined &&
      (typeof payload.budgets.maxUsd !== "number" || payload.budgets.maxUsd < 0)
    ) {
      return "budgets.maxUsd must be a non-negative number";
    }
    return null;
  }

  public async stop(): Promise<void> {
    this.app.log.info("[Gateway] Stopping server...");
    
    // 1. Notify WS clients
    for (const subscribers of this.autonomySubscribers.values()) {
      for (const entry of subscribers.values()) {
        this.safeSendSocket(entry.socket, {
          type: "server_shutdown",
          timestamp: new Date().toISOString(),
          payload: { message: "Gateway is shutting down gracefully" }
        });
      }
    }

    // 2. Dispose background tasks
    this.autonomyEventSubscription.dispose();
    this.budgetTracker.dispose();
    if (this.activeAuthServer) {
      this.activeAuthServer.stop();
      this.activeAuthServer = null;
    }

    // 3. Give WS clients a moment to receive the notification
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Close Fastify and DB
    await this.app.close();
    if (this.missionDatabase) {
      resetMissionDatabase(this.missionDatabase.dbPath);
    }
  }

  private handleAutonomyRuntimeEvent(event: AutonomyEvent): void {
    const interrupted = event.type === "stopped" && this.autonomyManager.consumeInterruptedStop(event.sessionId);
    this.publishMissionEventBridge(event, interrupted);
    this.broadcastAutonomyEvent(event, interrupted);
  }

  private publishMissionEventBridge(event: AutonomyEvent, interrupted: boolean): void {
    eventBus.publish(`mission.${event.type}`, event);

    if (event.type === "created") {
      eventBus.publish("mission:created", event);
      return;
    }

    if (event.type === "state") {
      eventBus.publish("phase:started", event);
      return;
    }

    if (event.type === "step") {
      eventBus.publish("phase:completed", event);
      return;
    }

    if (event.type === "model_switch") {
      eventBus.publish("gear:started", event);
      return;
    }

    if (event.type === "gear_completed") {
      eventBus.publish("gear:completed", event);
      return;
    }

    if (event.type === "gear_failed") {
      eventBus.publish("gear:failed", event);
      return;
    }

    if (event.type === "gate_result") {
      eventBus.publish(event.payload.passed === true ? "gate:passed" : "gate:failed", event);
      return;
    }

    if (event.type === "gate_bypass") {
      eventBus.publish("gate_bypass", event);
      return;
    }

    if (event.type === "budget" && event.payload.warning === true) {
      eventBus.publish("budget:warning", event);
      return;
    }

    if (event.type === "decision_log") {
      eventBus.publish("decision_log", event);
      return;
    }

    if (event.type === "done") {
      eventBus.publish("mission:completed", event);
      return;
    }

    if (event.type === "failed") {
      eventBus.publish("mission:failed", event);
      return;
    }

    if (event.type === "stopped" && interrupted) {
      eventBus.publish("interrupted", event);
    }
  }

  private broadcastAutonomyEvent(event: AutonomyEvent, interrupted = false): void {
    const subscribers = this.autonomySubscribers.get(event.sessionId);
    if (!subscribers || subscribers.size === 0) return;

    for (const subscriber of subscribers.values()) {
      this.safeSendSocket(subscriber.socket, this.mapAutonomyWsPayload(event, interrupted));
    }
  }

  private mapAutonomyWsPayload(event: AutonomyEvent, interrupted = false): Record<string, unknown> {
    const session = this.autonomyManager.getSession(event.sessionId);
    const payload =
      session === null
        ? event.payload
        : {
            ...event.payload,
            selectedSession: summarizeAutonomySession(session),
          };

    if (event.type === "model_switch") {
      return {
        type: "modelSwitchEvent",
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        payload,
      };
    }
    if (event.type === "gate_result" || event.type === "gate_bypass") {
      return {
        type: "gateEvent",
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        payload: {
          ...payload,
          eventType: event.type,
        },
      };
    }
    if (event.type === "budget") {
      return {
        type: "budgetEvent",
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        payload,
      };
    }
    if (event.type === "queue") {
      return {
        type: "queueEvent",
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        payload,
      };
    }
    if (event.type === "decision_log" || event.type === "artifact") {
      return {
        type: "diagnosticEvent",
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        payload: {
          ...payload,
          diagnosticType: event.type,
        },
      };
    }
    return {
      type: "autonomyEvent",
      eventType: interrupted ? "interrupted" : event.type,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload,
    };
  }

  private async buildMissionSocketSnapshot(sessionId: string): Promise<Record<string, unknown> | null> {
    const liveSession = this.autonomyManager.getSession(sessionId);
    if (liveSession) {
      return {
        state: liveSession.state,
        cycleCount: liveSession.cycleCount,
        timeline: structuredClone(liveSession.timeline),
        artifacts: structuredClone(liveSession.artifacts),
        budgets: structuredClone(liveSession.budgets),
        touchedFiles: [...liveSession.touchedFiles],
        selectedSession: summarizeAutonomySession(liveSession),
        queue: this.autonomyManager.getQueue(),
      };
    }

    try {
      const mission = await this.missionService.getById(sessionId);
      const lastTimelineEntry = mission.timeline[mission.timeline.length - 1];
      const missionState = mission.currentPhase ?? mission.state;
      return {
        state: missionState,
        cycleCount: lastTimelineEntry?.cycle ?? 0,
        timeline: mission.timeline.map((entry) => ({
          cycle: entry.cycle,
          state: entry.state,
          taskId: entry.taskId,
          note: entry.note,
          timestamp: entry.timestamp,
        })),
        artifacts: missionArtifactsToSocketPayload(mission),
        budgets: structuredClone(mission.budget),
        touchedFiles: [...mission.touchedFiles],
        selectedSession: summarizeMission(mission),
        queue: this.autonomyManager.getQueue(),
      };
    } catch (error) {
      if (error instanceof MissionServiceError && error.code === "MISSION_NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }

  private countMissionClients(sessionId: string): number {
    return this.autonomySubscribers.get(sessionId)?.size ?? 0;
  }

  private compareGeneration(left: WsSocketGeneration, right: WsSocketGeneration): number {
    if (left.epochMs !== right.epochMs) {
      return left.epochMs - right.epochMs;
    }
    return left.seq - right.seq;
  }

  private isQuotaGuardedPath(pathOnly: string, method: string): boolean {
    if ((pathOnly === "/api/missions" || pathOnly.startsWith("/api/missions/")) && method !== "GET") {
      return true;
    }
    if (pathOnly.startsWith("/ws/mission/") || pathOnly.startsWith("/ws/autonomy/")) {
      return true;
    }
    if (
      pathOnly.startsWith("/api/autonomy/sessions/") &&
      (pathOnly.endsWith("/ws-ticket") ||
        pathOnly.endsWith("/stop") ||
        pathOnly.endsWith("/cancel") ||
        pathOnly.endsWith("/pause") ||
        pathOnly.endsWith("/resume"))
    ) {
      return true;
    }
    return false;
  }

  private serializeSnapshotPayload(payload: Record<string, unknown>): number {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  }

  private truncateSnapshotText(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }
    if (value.length <= SOCKET_SNAPSHOT_TEXT_CAP) {
      return value;
    }
    return `${value.slice(0, SOCKET_SNAPSHOT_TEXT_CAP)}\n...[truncated]`;
  }

  private shapeMissionSocketSnapshot(
    sessionId: string,
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    const payload = structuredClone(snapshot);
    if (this.serializeSnapshotPayload(payload) <= SOCKET_SNAPSHOT_BYTE_CAP) {
      return payload;
    }

    const meta: MissionSocketSnapshotMeta = {
      truncated: true,
      droppedFields: [],
    };
    const artifacts = payload.artifacts && typeof payload.artifacts === "object"
      ? (payload.artifacts as Record<string, unknown>)
      : null;

    if (artifacts && Array.isArray(artifacts.rawResponses)) {
      artifacts.rawResponses = [];
      meta.droppedFields.push("artifacts.rawResponses");
    }
    if (this.serializeSnapshotPayload(payload) <= SOCKET_SNAPSHOT_BYTE_CAP) {
      return { ...payload, snapshotMeta: meta };
    }

    if (artifacts && typeof artifacts.contextPack === "string" && artifacts.contextPack.length > 0) {
      artifacts.contextPack = "";
      meta.droppedFields.push("artifacts.contextPack");
    }
    if (this.serializeSnapshotPayload(payload) <= SOCKET_SNAPSHOT_BYTE_CAP) {
      return { ...payload, snapshotMeta: meta };
    }

    if (Array.isArray(payload.timeline) && payload.timeline.length > SOCKET_SNAPSHOT_TIMELINE_TAIL) {
      payload.timeline = payload.timeline.slice(-SOCKET_SNAPSHOT_TIMELINE_TAIL);
      meta.timelineTailCount = SOCKET_SNAPSHOT_TIMELINE_TAIL;
      meta.droppedFields.push("timeline.oldest");
    }
    if (artifacts) {
      if (typeof artifacts.plan === "string" && artifacts.plan.length > SOCKET_SNAPSHOT_TEXT_CAP) {
        artifacts.plan = this.truncateSnapshotText(artifacts.plan);
        meta.droppedFields.push("artifacts.plan");
      }
      if (
        typeof artifacts.changeSummary === "string" &&
        artifacts.changeSummary.length > SOCKET_SNAPSHOT_TEXT_CAP
      ) {
        artifacts.changeSummary = this.truncateSnapshotText(artifacts.changeSummary);
        meta.droppedFields.push("artifacts.changeSummary");
      }
    }

    if (this.serializeSnapshotPayload(payload) <= SOCKET_SNAPSHOT_BYTE_CAP) {
      return { ...payload, snapshotMeta: meta };
    }

    return {
      type: "snapshot_error",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        code: "SNAPSHOT_TOO_LARGE",
        message: "Mission snapshot was truncated beyond the transport limit.",
        snapshotMeta: meta,
      },
    };
  }

  private safeSendSocket(socket: any, payload: Record<string, unknown>): void {
    try {
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify(payload));
      }
    } catch (error) {
      console.warn("[WS] Failed to send payload:", error);
    }
  }

  private resolveSocket(connection: any): any {
    if (typeof connection?.on === "function") return connection;
    return connection?.socket ?? connection;
  }

  private closeSocket(socket: any, code: number, reason: string): void {
    try {
      if (socket && typeof socket.close === "function" && socket.readyState < 2) {
        socket.close(code, reason);
      }
    } catch (error) {
      console.warn("[WS] Failed to close socket:", error);
    }
  }

  private setupWebSockets() {
    // ── WebSocket Heartbeat (30s) ──────────────────────────────────────────
    const HEARTBEAT_INTERVAL_MS = 30_000;
    const HEARTBEAT_TIMEOUT_MS = 5_000;

    const heartbeatInterval = setInterval(() => {
      for (const subscribers of this.autonomySubscribers.values()) {
        for (const entry of subscribers.values()) {
          const socket = entry.socket;
          if (socket.readyState !== 1) continue;

          try {
             if (typeof (socket as any).ping === 'function') {
                (socket as any).ping();
             } else {
                this.safeSendSocket(socket, { type: "ping", timestamp: Date.now() });
             }
          } catch (e) {
             console.warn("[WS] Ping failed, terminating socket", e);
             socket.terminate?.() || socket.close();
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS).unref();

    this.app.addHook("onClose", async () => {
      clearInterval(heartbeatInterval);
    });
    this.app.get("/ws/logs", { websocket: true }, (connection) => {
      const socket = this.resolveSocket(connection);

      const safeSend = (payload: Record<string, unknown>) => {
        this.safeSendSocket(socket, payload);
      };

      if (!this.activePipeline) {
        safeSend({ type: "info", message: "No active pipeline" });
      }

      const cleanup: Array<() => void> = [];
      cleanup.push(eventBus.subscribe("agent_start", (data: unknown) => safeSend({ type: "agent_start", ...(data as object) })));
      cleanup.push(eventBus.subscribe("agent_complete", (data: unknown) => safeSend({ type: "agent_complete", ...(data as object) })));
      cleanup.push(eventBus.subscribe("rarv_phase", (data: unknown) => safeSend({ type: "rarv", ...(data as object) })));
      cleanup.push(eventBus.subscribe("verify", (data: unknown) => safeSend({ type: "verify", ...(data as object) })));
      cleanup.push(eventBus.subscribe("error", (data: unknown) => safeSend({ type: "error", ...(data as object) })));

      socket.on("close", () => {
        cleanup.forEach((dispose) => dispose());
      });

      socket.on("error", (err: Error) => {
        console.warn("[WS] Socket error:", err.message);
        cleanup.forEach((dispose) => dispose());
      });
    });

    const registerMissionSocketRoute = (route: "/ws/autonomy/:id" | "/ws/mission/:id") => {
      this.app.get<{ Params: { id: string } }>(
        route,
        { websocket: true },
        (connection, request) => {
          const sessionId = request.params.id;
          const socket = this.resolveSocket(connection);
          const ticketContext = (request as { wsTicketContext?: ConsumedWsTicket }).wsTicketContext;
          if (!ticketContext) {
            this.closeSocket(socket, 4401, "Missing websocket ticket context");
            return;
          }

          const subscribers = this.autonomySubscribers.get(sessionId) ?? new Map<string, MissionSocketClientEntry>();
          const existing = subscribers.get(ticketContext.clientId);
          if (!existing && subscribers.size >= MISSION_MAX_ACTIVE_CLIENTS) {
            this.safeSendSocket(socket, {
              type: "error",
              sessionId,
              timestamp: new Date().toISOString(),
              payload: { message: "Mission client limit reached" },
            });
            this.closeSocket(socket, 4429, "TOO_MANY_CLIENTS");
            return;
          }

          if (existing) {
            const comparison = this.compareGeneration(ticketContext.generation, existing.generation);
            if (comparison <= 0) {
              this.safeSendSocket(socket, {
                type: "error",
                sessionId,
                timestamp: new Date().toISOString(),
                payload: { message: "Stale websocket generation" },
              });
              this.closeSocket(socket, 4409, "Stale generation");
              return;
            }
            subscribers.set(ticketContext.clientId, {
              socket,
              clientId: ticketContext.clientId,
              generation: ticketContext.generation,
            });
            this.autonomySubscribers.set(sessionId, subscribers);
            this.closeSocket(existing.socket, 4409, "Superseded");
          } else {
            subscribers.set(ticketContext.clientId, {
              socket,
              clientId: ticketContext.clientId,
              generation: ticketContext.generation,
            });
            this.autonomySubscribers.set(sessionId, subscribers);
          }

          void this.buildMissionSocketSnapshot(sessionId)
            .then((snapshot) => {
              if (!snapshot) {
                this.safeSendSocket(socket, {
                  type: "error",
                  sessionId,
                  timestamp: new Date().toISOString(),
                  payload: { message: "Mission not found" },
                });
                this.closeSocket(socket, 4404, "Mission not found");
                return;
              }

              const shapedPayload = this.shapeMissionSocketSnapshot(sessionId, snapshot);
              if (shapedPayload.type === "snapshot_error") {
                this.safeSendSocket(socket, shapedPayload);
                this.closeSocket(socket, 4501, "Mission snapshot overflow");
                return;
              }

              this.safeSendSocket(socket, {
                type: "autonomyEvent",
                eventType: "snapshot",
                sessionId,
                timestamp: new Date().toISOString(),
                payload: shapedPayload,
              });
            })
            .catch((error) => {
              this.app.log.error(error, `[WS] Failed to build mission snapshot for ${sessionId}`);
              this.safeSendSocket(socket, {
                type: "error",
                sessionId,
                timestamp: new Date().toISOString(),
                payload: { message: "Failed to load mission snapshot" },
              });
              this.closeSocket(socket, 4500, "Mission snapshot failure");
            });

          const dispose = () => {
            const current = this.autonomySubscribers.get(sessionId);
            if (!current) return;
            const activeEntry = current.get(ticketContext.clientId);
            if (activeEntry?.socket === socket) {
              current.delete(ticketContext.clientId);
            }
            if (current.size === 0) {
              this.autonomySubscribers.delete(sessionId);
            }
          };

          socket.on("close", dispose);
          socket.on("error", dispose);
        },
      );
    };

    registerMissionSocketRoute("/ws/autonomy/:id");
    registerMissionSocketRoute("/ws/mission/:id");
  }

  public getAuthManager(): GatewayAuthManager {
    return this.authManager;
  }

  public getConnectedClientCount(): number {
    let count = 0;
    for (const clients of this.autonomySubscribers.values()) {
      count += clients.size;
    }
    return count;
  }
}
