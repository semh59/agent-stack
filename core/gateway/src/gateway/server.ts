import fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import * as fs from "node:fs/promises";
import path from "node:path";
import { TokenStore } from "./token-store";
import type { SequentialPipeline } from "../orchestration/sequential-pipeline";
import { eventBus } from "../orchestration/event-bus";



import { AccountManager } from "../plugin/accounts";

import { AutonomySessionManager } from "./autonomy-session-manager";
import { orchestratorService } from "../orchestration/OrchestratorService";
import { SlashCommandRegistry } from "../orchestration/commands/SlashCommandRegistry";
import { DeepPlanningCommand } from "../orchestration/commands/DeepPlanningCommand";


import type { MissionRepository } from "../repositories/mission.repository";
import {
  type AutonomyEvent,
  type AutonomySession,
} from "../orchestration/autonomy-types";
import {
  GatewayAuthManager,
  type ConsumedWsTicket,
  type WsSocketGeneration,
} from "./gateway-auth-manager";
import { getMissionDatabase, resetMissionDatabase, type MissionDatabase } from "../persistence/database";
import { SQLiteMissionRepository } from "../persistence/SQLiteMissionRepository";
import { SQLiteChatRepository } from "../persistence/SQLiteChatRepository";
import { MissionPersistenceSubscriber } from "../persistence/MissionPersistenceSubscriber";
import { StartupRecoveryCoordinator } from "../persistence/recovery/StartupRecovery";
import type { RecoveryNotifier } from "../persistence/recovery/RecoveryNotifier";
import { TelegramRecoveryNotifier } from "../persistence/recovery/TelegramRecoveryNotifier";
import { BudgetTracker } from "../orchestration/BudgetTracker";
import {
  createApproveAuthMiddleware,
  registerFormatWrapperMiddleware,
  registerRateLimitMiddleware,
} from "./rest-middleware";
import { apiError, apiResponse } from "./rest-response";
import { registerMissionRoutes } from "../api/routers/mission.router";
import { registerSettingsRoutes } from "../services/settings/routes";
import { registerOptimizeRoutes } from "./routes/optimize";
import { registerChatRoutes } from "../api/routers/chat.router";
import { registerSystemRoutes } from "../api/routers/system.router";
import { registerAuthRoutes } from "../api/routers/auth.router";
import { registerAccountsRoutes } from "../api/routers/accounts.router";
import { registerPipelineRoutes } from "../api/routers/pipeline.router";
import { registerAutonomyRoutes } from "../api/routers/autonomy.router";
import { registerPrivacyRoutes } from "../api/routers/privacy.router";
import { registerProjectsRoutes } from "../api/routers/projects.router";
import { registerMetroRoutes } from "../api/routers/metro.router";
import { MetroWatchdog } from "./metro-watchdog";
import type { MissionModel } from "../models/mission.model";
import type { AuthServer } from "./auth-server";


import { MissionService, MissionServiceError } from "../services/mission.service";
import { AutonomyMissionRuntime } from "../services/mission-runtime";
import { SQLiteUnitOfWork } from "../uow/unit-of-work";
import type { QuotaRepository } from "../repositories/quota.repository";
import { SQLiteQuotaRepository } from "../persistence/SQLiteQuotaRepository";



// ——————————————————————————————————————————————————————————————————————————————————————————————————





// ————————————————————————————————— Rate Limit Tracking (in-memory, per-IP) —————————————————————————————————

// ————————————————————————————————— Allowed Plan Modes ——————————————————————————————————————————————————————



// ————————————————————————————————— CORS Whitelist ——————————————————————————————————————————————————————————

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

// ————————————————————————————————— Types ———————————————————————————————————————————————————————————————————

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

interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  ping?(): void;
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
  socket: WebSocketLike;
  clientId: string;
  generation: WsSocketGeneration;
}



interface MissionWsTicketRequestBody {
  clientId?: string;
  generation?: WsSocketGeneration | null;
}

// ————————————————————————————————— Server ——————————————————————————————————————————————————————————————————

export class GatewayServer {
  private app = fastify({
    logger: {
      level: process.env.ALLOY_GATEWAY_LOG_LEVEL ?? "info",
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
  private activeAuthServer: AuthServer | null = null;


  private readonly autonomyManager: AutonomySessionManager;
  private readonly autonomySubscribers = new Map<string, Map<string, MissionSocketClientEntry>>();
  private projectRoot: string;
  private readonly host: string;
  private readonly authManager: GatewayAuthManager;
  private readonly startedAtMs = Date.now();
  private readonly missionDatabase: MissionDatabase | null;
  private readonly missionRepository: MissionRepository;
  private readonly quotaRepository: QuotaRepository;
  private readonly slashCommandRegistry = new SlashCommandRegistry();
  private readonly budgetTracker: BudgetTracker;


  private quotaStateReady = false;
  private readonly missionService: MissionService;
  private readonly missionPersistence: MissionPersistenceSubscriber;
  private readonly chatRepository: SQLiteChatRepository;
  private readonly startupRecovery: StartupRecoveryCoordinator;
  private readonly recoveryNotifier: RecoveryNotifier;
  private readonly autonomyEventSubscription: { dispose: () => void };
  private metroWatchdog: MetroWatchdog | null = null;

  constructor(options: GatewayServerOptions) {
    this.options = options;
    this.projectRoot = options.projectRoot;
    this.host = options.host ?? "127.0.0.1";
    const resolvedAuthToken = options.authToken.trim();
    if (!resolvedAuthToken) {
      throw new Error("Gateway auth token is required. Set ALLOY_GATEWAY_TOKEN or pass authToken.");
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
    this.quotaRepository = new SQLiteQuotaRepository(this.missionDatabase ?? getMissionDatabase());
    this.budgetTracker = new BudgetTracker({
      quotaRepository: this.quotaRepository,
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
        quotaRepository: this.quotaRepository,
        database: this.missionDatabase ?? undefined,
      }),
      new AutonomyMissionRuntime(this.autonomyManager),
      this.app.log,
    );
    this.chatRepository = new SQLiteChatRepository(this.missionDatabase ?? getMissionDatabase());
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
        this.app.log.info(`[Gateway] Real account pool loaded: ${m.getTotalAccountCount()} accounts`);
    }).catch(err => {
        this.app.log.error(`[Gateway] Failed to load real account pool: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Register Default Commands
    this.slashCommandRegistry.register(new DeepPlanningCommand());

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
    let serveIndexWithToken: ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) | null = null;

    const repoRoot = path.join(this.projectRoot, "..", "..");
    const interfaceUiDistPath = path.join(repoRoot, "interface", "extension", "ui", "dist");

    let rootPath = "";
    try {
      const fsSync = await import('node:fs');
      // Prioritize the Extension UI Dist
      if (fsSync.existsSync(interfaceUiDistPath)) {
        rootPath = interfaceUiDistPath;
      } else if (fsSync.existsSync(extensionUiDistPath)) {
        rootPath = extensionUiDistPath;
      } else if (fsSync.existsSync(uiDistPath)) {
        rootPath = uiDistPath;
      }
    } catch { /* ignore */ }

    if (rootPath) {
      console.log(`[Gateway] Serving UI from: ${rootPath}`);
      
      // Manual handler for index.html to inject the gateway token
      serveIndexWithToken = async (_request: FastifyRequest, reply: FastifyReply) => {
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
                console.log('[Gateway] Handshake initiated. Pulse check...');
                if (token) {
                  sessionStorage.setItem(key, token);
                  console.log('[Gateway] Token synchronized with session storage.');
                } else {
                  console.warn('[Gateway] No token provided for injection!');
                }
              })();
            </script>\n`;
            html = html.replace("<head>", `<head>${inject}`);
          }
          return reply.type("text/html").send(html);
        } catch (_) {
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

      // ── Start Metro Watchdog ──
      const bridgeUrl = process.env.ALLOY_BRIDGE_URL ?? "http://127.0.0.1:9100";
      const bridgeSecret = process.env.ALLOY_BRIDGE_SECRET ?? "";
      if (bridgeSecret) {
        this.metroWatchdog = new MetroWatchdog({
          bridgeUrl,
          bridgeSecret,
          pollIntervalMs: 10_000,
          downThreshold: 3,
          degradedLatencyMs: 2_000,
        });
        this.metroWatchdog.start();
      } else {
        this.app.log.warn("[Gateway] Metro Watchdog disabled — ALLOY_BRIDGE_SECRET not set");
      }

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
      reply: { status: (s: number) => { send: (b: unknown) => unknown }; send?: (b: unknown) => unknown },
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
        const b = typeof body === "object" ? body as MissionWsTicketRequestBody : {};
        const clientId = typeof b?.clientId === "string" ? b.clientId.trim() : "";
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
            generation: b?.generation ?? null,
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

    registerSettingsRoutes(this.app);
    registerOptimizeRoutes(this.app);
    registerChatRoutes(this.app, {
      tokenStore: this.tokenStore,
      getAccountManager: () => this.accountManager,
      chatRepository: this.chatRepository,
      slashCommandRegistry: this.slashCommandRegistry,
    });

    registerPrivacyRoutes(this.app, {
      ledger: orchestratorService(this.projectRoot).getSharedMemory().getPrivacyLedger(),
    });

    registerProjectsRoutes(this.app, {
      projectRoot: this.projectRoot,
      tokenStore: this.tokenStore,
      getAccountManager: () => this.accountManager,
    });




    registerSystemRoutes(this.app, {
      tokenStore: this.tokenStore,
      getAccountManager: () => this.accountManager,
      projectRoot: this.projectRoot,
      getActivePipeline: () => this.activePipeline,
      isQuotaStateReady: () => this.quotaStateReady,
      startedAtMs: this.startedAtMs,
    });

    registerAuthRoutes(this.app, {
      tokenStore: this.tokenStore,
      authManager: this.authManager,
    });

    registerAccountsRoutes(this.app, {
      tokenStore: this.tokenStore,
      getAccountManager: () => this.accountManager,
    });

    registerPipelineRoutes(this.app, {
      tokenStore: this.tokenStore,
      getAccountManager: () => this.accountManager,
      projectRoot: this.projectRoot,
      getActivePipeline: () => this.activePipeline,
      setActivePipeline: (p) => { this.activePipeline = p; },
    });

    registerAutonomyRoutes(this.app, {
      tokenStore: this.tokenStore,
      getAccountManager: () => this.accountManager,
      autonomyManager: this.autonomyManager,
      startupRecovery: this.startupRecovery,
      issueMissionWsTicket: (sessionId, reply, body) => issueMissionWsTicket(sessionId, reply, body as MissionWsTicketRequestBody | undefined),
    });

    // ── Metro Watchdog Routes ──
    registerMetroRoutes(this.app, {
      getWatchdog: () => this.metroWatchdog,
    });
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
    if (this.metroWatchdog) {
      this.metroWatchdog.stop();
      this.metroWatchdog = null;
    }
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

  private safeSendSocket(socket: WebSocketLike | null, payload: Record<string, unknown>): void {
    try {
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify(payload));
      }
    } catch (error) {
      console.warn("[WS] Failed to send payload:", error);
    }
  }

  private resolveSocket(connection: unknown): WebSocketLike {
    const conn = connection as Record<string, unknown> | null | undefined;
    if (conn && typeof conn.on === "function") return conn as unknown as WebSocketLike;
    return ((conn?.socket ?? connection) as WebSocketLike);
  }


  private closeSocket(socket: WebSocketLike | null, code: number, reason: string): void {
    try {
      if (socket && typeof socket.close === "function" && socket.readyState < 2) {
        socket.close(code, reason);
      }
    } catch (error) {
      console.warn("[WS] Failed to close socket:", error);
    }
  }


  private setupWebSockets() {
    // â”€â”€ WebSocket Heartbeat (30s) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const HEARTBEAT_INTERVAL_MS = 30_000;


    const heartbeatInterval = setInterval(() => {
      for (const subscribers of this.autonomySubscribers.values()) {
        for (const entry of subscribers.values()) {
          const socket = entry.socket as WebSocketLike;
          if (socket.readyState !== 1) continue;
 
          try {
             if (typeof socket.ping === 'function') {
                socket.ping();
             } else {
                this.safeSendSocket(socket, { type: "ping", timestamp: Date.now() });
             }


          } catch (e) {
             console.warn("[WS] Ping failed, terminating socket", e);
             const s = socket as WebSocketLike;
             if (s.terminate) {
               s.terminate();
             } else {
               s.close();
             }
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

      socket.on("error", (err: unknown) => {
        const error = err as Error;
        console.warn("[WS] Socket error:", error.message);
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
