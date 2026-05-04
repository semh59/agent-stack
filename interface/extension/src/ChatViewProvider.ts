import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { SequentialPipeline } from "../../../core/gateway/src/orchestration/sequential-pipeline";
import { AlloyGatewayClient } from "../../../core/gateway/src/orchestration/gateway-client";
import { AccountManager } from "../../../core/gateway/src/plugin/accounts";
import { loadConfig } from "../../../core/gateway/src/plugin/config/loader";
import { GOOGLE_GEMINI_PROVIDER_ID } from "../../../core/gateway/src/constants";
import {
  buildWebviewHtml,
  resolveWebviewAssets,
  WebviewBootGate,
} from "../../../core/gateway/src/gateway/webview-bootstrap";
import { VSCodeTerminalExecutor } from "./VSCodeTerminalExecutor";
import { VSCodeSharedMemory } from "./VSCodeSharedMemory";
import { ToolExecutionEngine } from "./ToolExecutionEngine";
import { UnifiedCostTracker } from "./TokenTracker";
import { getAllModels } from "../../../core/gateway/src/gateway/provider-types";
/**
 * Cline-Parity Messaging Protocol
 *
 * K2 FIX: WebviewMessage now supports payload field for startPipeline and selectAccount.
 */
interface WebviewMessage {
  type:
    | "sendMessage"
    | "approveAction"
    | "rejectAction"
    | "getAccounts"
    | "getModels"
    | "selectAccount"
    | "addAccount"
    | "removeAccount"
    | "getPipelineStatus"
    | "startPipeline"
    | "startAutonomy"
    | "pauseAutonomy"
    | "resumeAutonomy"
    | "stopAutonomy"
    | "subscribeAutonomyEvents"
    | "saveSettings"
    | "clearHistory"
    | "getWorkspaceFiles"
    | "ui_boot_started"
    | "ui_boot_failed"
    | "ui_boot_ready";
  value?: string;
  actionId?: string;
  payload?: unknown;
}

/**
 * K2 FIX: ExtensionMessage now includes payload and log fields
 * to match the UI store's expected message shape.
 */
interface ExtensionMessage {
  type:
    | "agentStart"
    | "agentComplete"
    | "rarvPhase"
    | "log"
    | "system"
    | "error"
    | "approvalRequired"
    | "user"
    | "accounts"
    | "models"
    | "pipeline_status"
    | "authToken"
    | "autonomyEvent"
    | "modelSwitchEvent"
    | "gateEvent"
    | "budgetEvent"
    | "queueEvent"
    | "token_update"
    | "assistantText"
    | "chatHistory"
    | "workspaceFiles";
  agent?: string;
  order?: number;
  phase?: string;
  content?: string;
  level?: "info" | "success" | "error" | "warning";
  value?: string;
  id?: string;
  action?: string;
  tokenStats?: unknown;
  payload?: unknown;
  log?: unknown;
  status?: unknown;
  token?: string;
  eventType?: string;
  timestamp?: string;
  sessionId?: string;
  messages?: Array<{role:string;content:string;timestamp:string;isError?:boolean}>;
  files?: string[];
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
  reject: (reason: string) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const DEFAULT_GATEWAY_HTTP_BASE = "http://127.0.0.1:51122";
const DEFAULT_GATEWAY_WS_BASE = "ws://127.0.0.1:51122";

function normalizeConnectOrigins(input: readonly string[] | undefined): string[] {
  if (!input) return [];
  const allowed = new Set<string>();
  for (const origin of input) {
    if (typeof origin !== "string") continue;
    const trimmed = origin.trim();
    if (!trimmed) continue;
    if (!/^(https?|wss?):\/\/[a-z0-9.-]+(?::\d+)?$/i.test(trimmed)) continue;
    allowed.add(trimmed);
  }
  return [...allowed];
}

function normalizeOAuthUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === "accounts.google.com" || host.endsWith(".accounts.google.com")) {
      if (!parsed.searchParams.get("response_type")) {
        parsed.searchParams.set("response_type", "code");
      }
      if (!parsed.searchParams.get("access_type")) {
        parsed.searchParams.set("access_type", "offline");
      }
      if (!parsed.searchParams.get("prompt")) {
        parsed.searchParams.set("prompt", "consent");
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

interface ParsedGatewayError {
  message: string;
  errorCode: string | null;
}

async function parseGatewayError(response: Response): Promise<ParsedGatewayError> {
  const fallback = `Gateway request failed (${response.status})`;
  let message = fallback;
  let errorCode: string | null = null;

  try {
    const payload = (await response.clone().json()) as {
      errors?: Array<{ message?: unknown }>;
      meta?: Record<string, unknown>;
    };
    if (Array.isArray(payload.errors) && typeof payload.errors[0]?.message === "string") {
      message = payload.errors[0].message;
    }
    if (isRecord(payload.meta) && typeof payload.meta.errorCode === "string") {
      errorCode = payload.meta.errorCode;
    }
  } catch {
    try {
      const text = (await response.clone().text()).trim();
      if (text) {
        message = text;
      }
    } catch {
      // keep fallback
    }
  }

  return { message, errorCode };
}

function mapOAuthActionableError(parsed: ParsedGatewayError): string {
  if (parsed.errorCode === "OAUTH_CALLBACK_PORT_IN_USE") {
    return "OAuth callback port 51121 is busy. Stop the local auth process using that port and retry.";
  }
  return parsed.message;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "alloy.chatView";

  private _view?: vscode.WebviewView;
  private _pipeline?: SequentialPipeline;
  private _accountManager?: AccountManager;
  private _disposables: vscode.Disposable[] = [];
  private _pendingApprovals = new Map<string, PendingApproval>();
  private _autonomySessionId: string | null = null;
  private _autonomySocket: WebSocket | null = null;
  private _costTracker: UnifiedCostTracker;
  private _gatewayAuthToken: string | null;
  private readonly _cspConnectOrigins: string[];
  private readonly _bootMessageGate = new WebviewBootGate<ExtensionMessage>(400);
  private _webviewBootReady = false;
  private _bootSnapshotSent = false;
  private _chatHistory: Array<{role:string;content:string;timestamp:string;isError?:boolean}> = [];
  private readonly _historyPath: string | undefined;

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _globalStoragePath?: string) {
    this._costTracker = new UnifiedCostTracker(undefined, this._globalStoragePath);
    const config = vscode.workspace.getConfiguration("alloy");
    this._gatewayAuthToken =
      process.env.ALLOY_GATEWAY_TOKEN
      ?? config.get<string>("gatewayAuthToken")
      ?? ChatViewProvider._readTokenFromDotEnv(this._extensionUri.fsPath)
      ?? null;
    this._cspConnectOrigins = normalizeConnectOrigins(config.get<string[]>("gatewayConnectOrigins"));
    if (this._globalStoragePath) {
      this._historyPath = path.join(this._globalStoragePath, "chat-history.json");
      try {
        if (fs.existsSync(this._historyPath)) {
          const raw = fs.readFileSync(this._historyPath, "utf8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            // Keep last 200 messages
            this._chatHistory = parsed.slice(-200);
          }
        }
      } catch { /* start fresh */ }
    }
  }

  /**
   * Reads ALLOY_GATEWAY_TOKEN from .env files next to the workspace root
   * so users don't have to set a VS Code setting manually.
   * Checks: workspaceRoot/.env  and  workspaceRoot/gateway/.env
   */
  private static _readTokenFromDotEnv(extensionPath?: string): string | undefined {
    try {
      const candidates: string[] = [];

      // 1. Walk up from extension install dir — the most reliable anchor
      let dir = extensionPath ?? __dirname;
      for (let i = 0; i < 8; i++) {
        candidates.push(path.join(dir, ".env"));
        candidates.push(path.join(dir, "gateway", ".env"));
        candidates.push(path.join(dir, "core", "gateway", ".env"));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }

      // 2. From open workspace folders
      for (const wf of vscode.workspace.workspaceFolders ?? []) {
        const r = wf.uri.fsPath;
        candidates.push(path.join(r, ".env"));
        candidates.push(path.join(r, "gateway", ".env"));
        candidates.push(path.join(r, "core", "gateway", ".env"));
        candidates.push(path.join(r, "..", "gateway", ".env"));
        candidates.push(path.join(r, "..", "core", "gateway", ".env"));
      }

      for (const envPath of candidates) {
        try {
          if (!fs.existsSync(envPath)) continue;
          const lines = fs.readFileSync(envPath, "utf8").split("\n");
          for (const line of lines) {
            if (!line.startsWith("ALLOY_GATEWAY_TOKEN=")) continue;
            const raw = line.slice("ALLOY_GATEWAY_TOKEN=".length).trim();
            const value = raw.replace(/^["']|["']$/g, "");
            if (value) return value;
          }
        } catch { /* skip unreadable */ }
      }
    } catch (_e) { /* ignore */ }
    return undefined;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    console.log("ChatViewProvider#resolveWebviewView called");
    this._view = webviewView;
    this._webviewBootReady = false;
    this._bootSnapshotSent = false;
    this._bootMessageGate.reset();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    console.log("Setting webview HTML...");
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    console.log("Webview HTML set");

    webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
      switch (data.type) {
        case "ui_boot_started":
          console.log("[ChatViewProvider] ui_boot_started");
          break;
        case "ui_boot_failed": {
          const message = this._extractBootFailureMessage(data.payload);
          console.error("[ChatViewProvider] ui_boot_failed", message);
          void vscode.window.showErrorMessage(`Mission Control boot failed: ${message}`);
          this._postMessage({ type: "error", value: `UI boot failed: ${message}` });
          break;
        }
        case "ui_boot_ready":
          this._onWebviewBootReady();
          break;
        case "sendMessage":
          if (data.value) {
            this._emitUiEvent("send_message");
            await this._handleUserMessage(data.value);
          }
          break;
        case "approveAction":
          if (data.actionId) {
            this._emitUiEvent("approve_action", { actionId: data.actionId });
            const pending = this._pendingApprovals.get(data.actionId);
            if (pending) {
              clearTimeout(pending.timer);
              pending.resolve(true);
              this._pendingApprovals.delete(data.actionId);
            }
          }
          break;
        case "rejectAction":
          if (data.actionId) {
            const pending = this._pendingApprovals.get(data.actionId);
            if (pending) {
              clearTimeout(pending.timer);
              pending.resolve(false);
              this._pendingApprovals.delete(data.actionId);
            }
          }
          break;
        case "getAccounts":
          this._sendAccounts();
          break;
        case "getModels":
          this._sendModels();
          break;
        case "selectAccount":
          // O4 FIX: selectAccount implementation
          if (data.payload && this._accountManager) {
            const email =
              typeof data.payload === "string"
                ? data.payload
                : (typeof data.payload === "object" && data.payload && "email" in data.payload
                    ? String((data.payload as { email?: string }).email ?? "")
                    : "");
            if (email) {
              const accounts = this._accountManager.getAccountsSnapshot();
              const idx = accounts.findIndex(a => a.email === email);
              if (idx >= 0) {
                // AccountManager doesn't expose setActiveIndex directly,
                // but the select event is acknowledged and can be used for UI state
                console.log(`[ChatViewProvider] Account selected: ${email} (index: ${idx})`);
              }
            }
          }
          break;
        case "addAccount":
          this._emitUiEvent("add_account_click");
          await this._handleAddAccount();
          break;
        case "removeAccount":
          await this._handleRemoveAccount(data.payload);
          break;
        case "getPipelineStatus":
          // K2 FIX: type "pipelineStatus" → "pipeline_status", status as object
          this._postMessage({
            type: "pipeline_status",
            status: this._pipeline ? { status: "active" } : { status: "standby" },
          });
          break;
        case "startPipeline":
          // K2 FIX: data.value -> data.payload?.userTask
          {
            const payloadTask =
              isRecord(data.payload) && typeof data.payload.userTask === "string"
                ? data.payload.userTask
                : undefined;
            const userTask = payloadTask ?? data.value;
            if (userTask) {
              await this._handleUserMessage(userTask);
            }
          }
          break;
        case "startAutonomy":
          this._emitUiEvent("start_autonomy");
          await this._handleStartAutonomy(data.payload);
          break;
        case "pauseAutonomy":
          await this._handlePauseAutonomy(data.payload);
          break;
        case "resumeAutonomy":
          await this._handleResumeAutonomy(data.payload);
          break;
        case "stopAutonomy":
          await this._handleStopAutonomy(data.payload);
          break;
        case "subscribeAutonomyEvents":
          {
            const sessionId =
              isRecord(data.payload) && typeof data.payload.sessionId === "string"
                ? data.payload.sessionId
                : this._autonomySessionId;
            if (sessionId) {
              void this._connectAutonomySocket(sessionId);
            }
          }
          break;
        case "clearHistory":
          this._chatHistory = [];
          if (this._historyPath) {
            try { fs.writeFileSync(this._historyPath, "[]", "utf8"); } catch { /* ignore */ }
          }
          break;
        case "getWorkspaceFiles":
          void this._sendWorkspaceFiles();
          break;
        case "saveSettings":
          {
            const p = isRecord(data.payload) ? data.payload : {};
            const cfg = vscode.workspace.getConfiguration("alloy");
            if (typeof p.anthropicKey === "string" && p.anthropicKey) {
              await cfg.update("anthropicApiKey", p.anthropicKey, vscode.ConfigurationTarget.Global);
            }
            if (typeof p.gatewayUrl === "string" && p.gatewayUrl) {
              await cfg.update("gatewayUrl", p.gatewayUrl, vscode.ConfigurationTarget.Global);
            }
            this._postMessage({ type: "system", value: "✓ Settings saved" });
          }
          break;
      }
    });

    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      console.log("Initializing pipeline for project root:", projectRoot);
      this._initPipeline(projectRoot).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("Pipeline init failed:", err);
        this._postMessage({
          type: "error",
          value: `Initialization failed: ${errorMessage}`,
        });
      });
    } else {
      console.log("No workspace folder - pipeline will not initialize");
      this._postMessage({
        type: "system",
        value:
          "No workspace folder open. Create/open a folder to use Alloy AI Agent.",
      });
    }
  }

  private async _initPipeline(projectRoot: string) {
    try {
      // Clean up previous listeners
      this._disposables.forEach((d) => d.dispose());
      this._disposables = [];

      const config = loadConfig(projectRoot);
      const accountManager = await AccountManager.loadFromDisk();

      const getAuth = async () => {
        const accounts = accountManager.getAccountsSnapshot();
        if (accounts.length > 0) {
          return {
            access: accounts[0].access,
            refresh: accounts[0].parts.refreshToken,
            expires: accounts[0].expires,
          };
        }
        return null;
      };

      const client = new AlloyGatewayClient(
        accountManager,
        config,
        GOOGLE_GEMINI_PROVIDER_ID,
        getAuth,
      );

      const terminal = new VSCodeTerminalExecutor(projectRoot);
      const memory = new VSCodeSharedMemory(projectRoot);
      const toolEngine = new ToolExecutionEngine(projectRoot);

      // HITL Bridge: Tool Engine -> Webview -> User response
      toolEngine.setApprovalHandler(async (request) => {
        this._postMessage({
          type: "approvalRequired",
          content: request.action,
          id: request.id,
        });

        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this._pendingApprovals.delete(request.id);
            reject(new Error("APPROVAL_TIMEOUT"));
            this._postMessage({
              type: "error",
              value: `Approval Timeout: ${request.action}`,
            });
          }, 30000); // 30s timeout

          this._pendingApprovals.set(request.id, { resolve, reject, timer });
        });
      });

      this._pipeline = new SequentialPipeline(projectRoot, client, {
        memory,
        terminal,
        toolEngine,
      });

      // Register persistent listeners (Disposable Bridge)
      this._disposables.push(
        this._pipeline.onAgentStart((agent) => {
          this._postMessage({
            type: "agentStart",
            agent: agent.role,
            order: agent.order,
          });
        }),
      );

      this._disposables.push(
        this._pipeline.onAgentComplete((agent) => {
          this._postMessage({ type: "agentComplete", agent: agent.role });
        }),
      );

      this._disposables.push(
        this._pipeline.onRarvPhase((phase) => {
          this._postMessage({ type: "rarvPhase", phase });
        }),
      );

      this._disposables.push(
        this._pipeline.onVerify((agent, result) => {
          const level = result.passed ? "success" : "error";
          // K2 FIX: Send log as object instead of content/level fields
          this._postMessage({
            type: "log",
            log: {
              id: Date.now(),
              time: new Date().toISOString(),
              source: agent?.role ?? 'verify',
              text: `Verification: ${result.command} -> exit ${result.exitCode}`,
              type: level,
            },
          });
        }),
      );

      this._disposables.push(
        this._pipeline.onError((agent, err) => {
          this._postMessage({
            type: "error",
            value: `[${agent?.role}] ${err?.message || err}`,
          });
        }),
      );

      this._postMessage({
        type: "system",
        value: "Alloy hazır.",
      });
      
      // Update local reference to accountManager for UI queries
      this._accountManager = accountManager;
      this._sendAccounts();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._postMessage({
        type: "error",
        value: `Bridge Bootstrap Failure: ${errorMessage}`,
      });
    }
  }

  /** Extract @file mentions and prepend their content to the task. */
  private _injectFileMentions(task: string): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return task;
    const mentions = [...task.matchAll(/@([\w./\\-]+)/g)];
    if (mentions.length === 0) return task;

    const snippets: string[] = [];
    for (const m of mentions) {
      const relPath = m[1];
      const absPath = path.isAbsolute(relPath) ? relPath : path.join(workspaceRoot, relPath);
      try {
        if (!fs.existsSync(absPath)) continue;
        const content = fs.readFileSync(absPath, "utf8");
        const ext = path.extname(absPath).slice(1);
        snippets.push(`// @${relPath}\n\`\`\`${ext}\n${content}\n\`\`\``);
      } catch { /* skip unreadable files */ }
    }

    if (snippets.length === 0) return task;
    return `${snippets.join("\n\n")}\n\n---\n\n${task}`;
  }

  private async _handleUserMessage(task: string) {
    if (!this._pipeline) {
      this._postMessage({
        type: "error",
        value: "Pipeline başlatılmadı. Lütfen bir workspace klasörü açın.",
      });
      return;
    }

    this._postMessage({ type: "user", value: task });
    const enrichedTask = this._injectFileMentions(task);

    // Capture the last agent output to send as assistant response
    let lastAgentOutput = "";
    const outputCapture = this._pipeline.onAgentComplete((_agent: unknown, output: string) => {
      if (output && output.trim()) lastAgentOutput = output;
    });

    try {
      // Start pipeline — use enriched task (with @file content injected)
      await this._pipeline.start(enrichedTask);
      outputCapture.dispose();

      // Send the final agent output as an assistant message in chat
      if (lastAgentOutput) {
        this._postMessage({ type: "assistantText", content: lastAgentOutput });
      }

      this._postMessage({ type: "system", value: "✓ Tamamlandı." });

      // Push token usage to webview so TokenBudgetBar updates
      const stats = this._costTracker.getStats();
      this._postMessage({
        type: "token_update",
        payload: { prompt: 0, completion: 0, total: stats.used, budget: stats.budget },
      });
    } catch (err: unknown) {
      outputCapture.dispose();
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._postMessage({
        type: "error",
        value: `Hata: ${errorMessage}`,
      });
    }
  }

  private _extractBootFailureMessage(payload: unknown): string {
    if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    return "Unknown boot failure";
  }

  private _onWebviewBootReady(): void {
    if (this._webviewBootReady) return;
    this._webviewBootReady = true;
    this._bootMessageGate.markReady((message) => {
      this._view?.webview.postMessage(message);
    });

    if (this._bootSnapshotSent) return;
    this._bootSnapshotSent = true;
    this._postMessage({ type: "authToken", token: this._gatewayAuthToken ?? "" });
    this._sendAccounts();
    this._sendModels();
    this._postMessage({
      type: "pipeline_status",
      status: this._pipeline ? { status: "active" } : { status: "standby" },
    });
    // Restore chat history
    if (this._chatHistory.length > 0) {
      this._view?.webview.postMessage({ type: "chatHistory", messages: this._chatHistory });
    }
    this._postMessage({ type: "system", value: "" });
  }

  private _saveToHistory(role: string, content: string, isError?: boolean): void {
    if (!this._historyPath || !content.trim()) return;
    const entry: {role:string;content:string;timestamp:string;isError?:boolean} = {
      role, content, timestamp: new Date().toISOString(),
    };
    if (isError) entry.isError = true;
    this._chatHistory.push(entry);
    if (this._chatHistory.length > 200) this._chatHistory = this._chatHistory.slice(-200);
    try {
      const dir = path.dirname(this._historyPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._historyPath, JSON.stringify(this._chatHistory, null, 2), "utf8");
    } catch { /* ignore write errors */ }
  }

  private async _sendWorkspaceFiles(): Promise<void> {
    if (!this._view) return;
    try {
      const uris = await vscode.workspace.findFiles(
        "**/*.{ts,tsx,js,jsx,py,rs,go,java,cs,cpp,c,h,md,json,yaml,yml,toml,sh,env}",
        "**/node_modules/**,**/.git/**,**/dist/**,**/build/**",
        500,
      );
      const root = (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "").replace(/\\/g, "/").replace(/\/$/, "");
      const files = uris.map((u) => {
        const rel = u.fsPath.replace(/\\/g, "/");
        return root && rel.startsWith(root) ? rel.slice(root.length + 1) : rel;
      }).sort();
      // Bypass the typed ExtensionMessage — this is an informational response only
      void this._view.webview.postMessage({ type: "workspaceFiles", files });
    } catch (err) {
      console.error("[ChatViewProvider] findFiles error", err);
    }
  }

  private _postMessage(message: ExtensionMessage) {
    // Persist chat-relevant messages to history
    if (message.type === "user" && message.value) {
      this._saveToHistory("user", message.value);
    } else if (message.type === "assistantText" && message.content) {
      this._saveToHistory("assistant", message.content);
    } else if (message.type === "system" && message.value?.trim()) {
      this._saveToHistory("system", message.value);
    } else if (message.type === "error" && message.value) {
      this._saveToHistory("system", message.value, true);
    }

    if (!this._view) return;
    this._bootMessageGate.enqueue(message, (next) => {
      this._view?.webview.postMessage(next);
    });
  }

  /**
   * K2 FIX: Send accounts as { type: "accounts", payload: [...] }
   * instead of { type: "accounts", accounts: [...] }
   */
  private _sendAccounts() {
    if (this._accountManager) {
      const snap = this._accountManager.getAccountsSnapshot();
      this._postMessage({
        type: "accounts",
        payload: snap.map(acc => ({
          email: acc.email ?? 'unknown',
          expiresAt: acc.expires ?? 0,
          isValid: acc.enabled !== false,
          status: acc.enabled ? 'active' : 'error',
        }))
      });
    }
  }

  private _sendModels() {
    // Axis 4: Model Router Federation
    // Axis 4: Model Router Federation
    // Fetch directly from the engine rather than hardcoding
    const allEngineModels = getAllModels();
    
    // Map to UI shape
    const uiModels = allEngineModels.map((m: any) => ({
      id: m.id,
      name: m.name,
      provider: m.provider === "google_gemini" ? "Google" : "Anthropic",
      status: "active", // We would wire CircuitBreaker health here in the future
      tier: m.tier
    }));
    
    this._postMessage({ type: "models", payload: uiModels });
  }

  private _resolveGatewayHttpBase(): string {
    const candidate = this._cspConnectOrigins.find((origin) => origin.startsWith("http://") || origin.startsWith("https://"));
    return candidate ?? DEFAULT_GATEWAY_HTTP_BASE;
  }

  private _resolveGatewayWsBase(): string {
    const candidate = this._cspConnectOrigins.find((origin) => origin.startsWith("ws://") || origin.startsWith("wss://"));
    return candidate ?? DEFAULT_GATEWAY_WS_BASE;
  }

  /**
   * Emits a UI event to the gateway's Metro Watchdog system so the VS Code
   * metro line tracks extension activity (heartbeat).
   * Fire-and-forget: never blocks or throws on failure.
   */
  private _emitUiEvent(action: string, extra?: Record<string, unknown>): void {
    const token = this._gatewayAuthToken;
    if (!token) return; // silently skip if no token
    const baseUrl = this._resolveGatewayHttpBase();
    fetch(`${baseUrl}/api/metro/ui-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        type: "ui:log",
        source: "vscode-extension",
        action,
        ...extra,
      }),
    }).catch(() => { /* ignore — best effort */ });
  }

  private async _handleAddAccount(): Promise<void> {
    // Re-try token discovery at call time (workspace may have loaded after constructor)
    if (!this._gatewayAuthToken) {
      this._gatewayAuthToken = ChatViewProvider._readTokenFromDotEnv(this._extensionUri.fsPath) ?? null;
    }
    const token = this._gatewayAuthToken;

    if (!token) {
      this._postMessage({
        type: "error",
        value: "ALLOY_GATEWAY_TOKEN bulunamadı. gateway/.env dosyasında ALLOY_GATEWAY_TOKEN=dev-local-token satırı olmalı ve gateway çalışıyor olmalı.",
      });
      return;
    }

    try {
      const response = await fetch("http://127.0.0.1:51122/api/auth/login", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000), // 15s timeout — gateway must respond
      });

      if (!response.ok) {
        const parsed = await parseGatewayError(response);
        throw new Error(mapOAuthActionableError(parsed));
      }

      const payload = (await response.json()) as { data?: { url?: string } };
      const oauthUrl = payload.data?.url;
      if (!oauthUrl) {
        throw new Error("OAuth URL not found in gateway response");
      }

      const normalizedOAuthUrl = normalizeOAuthUrl(oauthUrl);
      await vscode.env.openExternal(vscode.Uri.parse(normalizedOAuthUrl));
      this._postMessage({ type: "system", value: "OAuth flow opened in external browser." });

      // Poll for the new account: reload AccountManager from disk every 3s for up to 45s
      const pollStart = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          const freshManager = await AccountManager.loadFromDisk();
          const freshAccounts = freshManager.getAccountsSnapshot();
          const prev = this._accountManager?.getAccountsSnapshot() ?? [];
          if (freshAccounts.length > prev.length) {
            clearInterval(pollInterval);
            this._accountManager = freshManager;
            this._sendAccounts();
          } else if (Date.now() - pollStart > 45_000) {
            clearInterval(pollInterval); // timeout after 45s
          }
        } catch { clearInterval(pollInterval); }
      }, 3000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._postMessage({ type: "error", value: `Add account failed: ${errorMessage}` });
    }
  }

  private async _handleRemoveAccount(payload: unknown): Promise<void> {
    if (!this._accountManager) return;
    const email = typeof payload === "string" ? payload : "";
    if (!email) return;

    const deleted = this._accountManager.removeAccountByEmail(email);
    if (deleted) {
      await this._accountManager.saveToDisk();
      this._sendAccounts();
      this._postMessage({ type: "system", value: `Account removed: ${email}` });
      return;
    }

    this._postMessage({ type: "error", value: `Account not found: ${email}` });
  }

  private async _handleStartAutonomy(payload: unknown): Promise<void> {
    if (!this._gatewayAuthToken) {
      this._postMessage({ type: "error", value: "Gateway auth token missing for autonomy mode." });
      return;
    }

    if (!isRecord(payload)) {
      this._postMessage({ type: "error", value: "Invalid autonomy payload." });
      return;
    }

    try {
      const requestPayload = this._injectSelectedScope(payload);
      if (!("startMode" in requestPayload)) {
        requestPayload.startMode = "queued";
      }
      const response = await fetch(`${this._resolveGatewayHttpBase()}/api/autonomy/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this._gatewayAuthToken}`,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Start autonomy failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as { data?: { id?: string } };
      const sessionId = data.data?.id;
      if (!sessionId) {
        throw new Error("Autonomy session id missing in gateway response");
      }

      this._autonomySessionId = sessionId;
      await this._connectAutonomySocket(sessionId);
      this._postMessage({
        type: "autonomyEvent",
        eventType: "started",
        sessionId,
        payload: { message: `Autonomy session started: ${sessionId}` },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._postMessage({ type: "error", value: message });
    }
  }

  private async _handlePauseAutonomy(payload: unknown): Promise<void> {
    if (!this._gatewayAuthToken) return;
    const sessionId =
      isRecord(payload) && typeof payload.sessionId === "string"
        ? payload.sessionId
        : this._autonomySessionId;
    if (!sessionId) return;

    const reason = isRecord(payload) && typeof payload.reason === "string" ? payload.reason : "Paused from extension";
    try {
      const response = await fetch(
        `${this._resolveGatewayHttpBase()}/api/autonomy/sessions/${encodeURIComponent(sessionId)}/pause`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this._gatewayAuthToken}`,
          },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Pause autonomy failed (${response.status}): ${body}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._postMessage({ type: "error", value: message });
    }
  }

  private async _handleResumeAutonomy(payload: unknown): Promise<void> {
    if (!this._gatewayAuthToken) return;
    const sessionId =
      isRecord(payload) && typeof payload.sessionId === "string"
        ? payload.sessionId
        : this._autonomySessionId;
    if (!sessionId) return;

    const reason = isRecord(payload) && typeof payload.reason === "string" ? payload.reason : "Resumed from extension";
    try {
      const response = await fetch(
        `${this._resolveGatewayHttpBase()}/api/autonomy/sessions/${encodeURIComponent(sessionId)}/resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this._gatewayAuthToken}`,
          },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resume autonomy failed (${response.status}): ${body}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._postMessage({ type: "error", value: message });
    }
  }

  private async _handleStopAutonomy(payload: unknown): Promise<void> {
    if (!this._gatewayAuthToken) {
      this._postMessage({ type: "error", value: "Gateway auth token missing for autonomy stop." });
      return;
    }

    const sessionId =
      isRecord(payload) && typeof payload.sessionId === "string"
        ? payload.sessionId
        : this._autonomySessionId;
    if (!sessionId) {
      this._postMessage({ type: "error", value: "No active autonomy session id." });
      return;
    }

    const reason = isRecord(payload) && typeof payload.reason === "string" ? payload.reason : "Stopped from extension";

    try {
      const response = await fetch(`${this._resolveGatewayHttpBase()}/api/autonomy/sessions/${encodeURIComponent(sessionId)}/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this._gatewayAuthToken}`,
        },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Stop autonomy failed (${response.status}): ${body}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._postMessage({ type: "error", value: message });
    }
  }

  private async _connectAutonomySocket(sessionId: string): Promise<void> {
    if (!this._gatewayAuthToken) return;

    if (this._autonomySocket) {
      try {
        this._autonomySocket.close();
      } catch {
        // ignore socket close error
      }
      this._autonomySocket = null;
    }

    const ticketResponse = await fetch(
      `${this._resolveGatewayHttpBase()}/api/autonomy/sessions/${encodeURIComponent(sessionId)}/ws-ticket`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this._gatewayAuthToken}`,
        },
      },
    );
    if (!ticketResponse.ok) {
      const body = await ticketResponse.text();
      throw new Error(`Autonomy WS ticket failed (${ticketResponse.status}): ${body}`);
    }

    const ticketPayload = (await ticketResponse.json()) as { data?: { ticket?: string } };
    const ticket = ticketPayload.data?.ticket;
    if (!ticket) {
      throw new Error("Autonomy WS ticket missing");
    }

    const ws = new WebSocket(
      `${this._resolveGatewayWsBase()}/ws/autonomy/${encodeURIComponent(sessionId)}?ticket=${encodeURIComponent(ticket)}`,
    );
    this._autonomySocket = ws;
    this._autonomySessionId = sessionId;

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(typeof event.data === "string" ? event.data : "{}") as ExtensionMessage;
        this._postMessage(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this._postMessage({ type: "error", value: `Autonomy WS parse error: ${message}` });
      }
    };

    ws.onerror = () => {
      this._postMessage({ type: "error", value: "Autonomy websocket connection error." });
    };

    ws.onclose = () => {
      if (this._autonomySessionId !== sessionId) return;
      setTimeout(() => {
        if (this._autonomySessionId === sessionId) {
          void this._connectAutonomySocket(sessionId);
        }
      }, 3000);
    };
  }

  private _injectSelectedScope(payload: Record<string, unknown>): Record<string, unknown> {
    const scope = isRecord(payload.scope) ? payload.scope : null;
    if (scope && Array.isArray(scope.paths) && scope.paths.length > 0) {
      return payload;
    }
    const selectedPaths = this._resolveSelectedScopePaths();
    return {
      ...payload,
      scope: {
        mode: "selected_only",
        paths: selectedPaths.length > 0 ? selectedPaths : ["src"],
      },
    };
  }

  private _resolveSelectedScopePaths(): string[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!workspaceRoot || !activeFile) return [];
    const normalizedRoot = workspaceRoot.replace(/\\/g, "/");
    const normalizedFile = activeFile.replace(/\\/g, "/");
    if (!normalizedFile.startsWith(normalizedRoot)) return [];
    const relative = normalizedFile.slice(normalizedRoot.length).replace(/^\/+/, "");
    if (!relative) return [];
    const slash = relative.lastIndexOf("/");
    if (slash < 0) return ["."];
    return [relative.slice(0, slash)];
  }

  public dispose() {
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
    this._pipeline?.dispose();
    if (this._autonomySocket) {
      this._autonomySocket.close();
      this._autonomySocket = null;
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    let distPath = vscode.Uri.joinPath(this._extensionUri, "ui", "dist");
    const parentUri = vscode.Uri.joinPath(this._extensionUri, "..");
    const siblingDistPath = vscode.Uri.joinPath(parentUri, "ui", "dist");
    if (!fs.existsSync(distPath.fsPath) && fs.existsSync(siblingDistPath.fsPath)) {
      distPath = siblingDistPath;
    }
    const assetsPath = vscode.Uri.joinPath(distPath, "assets");
    const resolvedAssets = resolveWebviewAssets(distPath.fsPath, assetsPath.fsPath);
    console.log(
      `[ChatViewProvider] Webview assets resolved: script=${resolvedAssets.scriptFileName}, style=${resolvedAssets.styleFileName}, strategy=${resolvedAssets.strategy}`,
    );
    for (const note of resolvedAssets.notes) {
      console.warn(`[ChatViewProvider] Asset resolver note: ${note}`);
    }
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, resolvedAssets.scriptFileName));
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, resolvedAssets.styleFileName));
    const nonce = crypto.randomBytes(16).toString("base64");
    return buildWebviewHtml({
      webview, scriptUri, styleUri, nonce,
      cspSource: webview.cspSource,
      extraConnectOrigins: this._cspConnectOrigins,
    });
  }
}
