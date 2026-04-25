/**
 * BridgeManager — Python Optimization Bridge Lifecycle Supervisor
 *
 * Manages the Python bridge (`bridge.py`) process from within VS Code:
 *   1. Auto-detect Python interpreter (python3 / python / conda)
 *   2. Spawn bridge.py as child process with correct PYTHONPATH
 *   3. Health probe via /health every 10s (sliding-window availability score)
 *   4. Exponential backoff restart: delay = min(base * 2^attempt, max) + jitter
 *   5. Status bar integration: 🟢 Ready / 🟡 Starting / 🔴 Down
 *   6. Ring buffer of last 200 stderr lines for diagnostics
 *   7. Graceful shutdown on extension deactivate
 *
 * Usage:
 *   const manager = new BridgeManager(context);
 *   await manager.start();
 *   manager.onStatusChange((status) => updateUI(status));
 */

import * as vscode from "vscode";
import { spawn, execSync, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

import * as crypto from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BridgeStatus = "stopped" | "starting" | "healthy" | "unhealthy" | "restarting";

export interface BridgeHealthReport {
  status: BridgeStatus;
  /** Availability score 0-1 based on sliding window of last N probes */
  availabilityScore: number;
  /** Process uptime in ms (0 if not running) */
  uptimeMs: number;
  /** Last health check latency */
  lastLatencyMs: number;
  /** Total restart count since activation */
  restartCount: number;
  /** Port the bridge is running on */
  port: number;
  /** Python interpreter path used */
  pythonPath: string;
  /** Last N stderr lines for diagnostics */
  diagnostics: string[];
}

export interface BridgeManagerConfig {
  /** Port for the bridge HTTP server (default: 9100) */
  port: number;
  /** Health probe interval in ms (default: 10000) */
  healthIntervalMs: number;
  /** Base delay for exponential backoff (default: 2000ms) */
  backoffBaseMs: number;
  /** Max delay for exponential backoff (default: 60000ms) */
  backoffMaxMs: number;
  /** Jitter range ± ms (default: 500) */
  backoffJitterMs: number;
  /** Max consecutive probes in sliding window (default: 6) */
  healthWindowSize: number;
  /** Stderr ring buffer capacity (default: 200) */
  diagnosticsCapacity: number;
  /** Auto-start on construction (default: true) */
  autoStart: boolean;
}

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BridgeManagerConfig = {
  port: parseInt(process.env.ALLOY_BRIDGE_PORT ?? "9100", 10),
  healthIntervalMs: 10_000,
  backoffBaseMs: 2_000,
  backoffMaxMs: 60_000,
  backoffJitterMs: 500,
  healthWindowSize: 6,
  diagnosticsCapacity: 200,
  autoStart: true,
};

// ─── Bridge Manager ─────────────────────────────────────────────────────────

export class BridgeManager implements vscode.Disposable {
  private readonly config: BridgeManagerConfig;
  private readonly workspaceRoot: string;

  // Process state
  private process: ChildProcess | null = null;
  private pythonPath = "python";
  private startedAt = 0;
  private bridgeSecret: string = "";

  // Health probe
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private healthWindow: boolean[] = []; // sliding window of probe results
  private lastLatencyMs = 0;

  // Restart logic
  private restartCount = 0;
  private restartAttempt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyStopped = false;

  // Diagnostics ring buffer
  private readonly diagnosticsBuffer: string[] = [];

  // Status tracking
  private _status: BridgeStatus = "stopped";
  private readonly _onStatusChange = new vscode.EventEmitter<BridgeStatus>();
  public readonly onStatusChange = this._onStatusChange.event;

  // VS Code status bar
  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    configOverrides?: Partial<BridgeManagerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };

    // Resolve workspace root for bridge.py path
    const folders = vscode.workspace.workspaceFolders;
    this.workspaceRoot = folders?.[0]?.uri.fsPath ?? "";

    // Status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = "alloy.bridgeDiagnostics";
    context.subscriptions.push(this.statusBarItem);
    this.updateStatusBar();
    this.statusBarItem.show();

    // Register diagnostics command
    context.subscriptions.push(
      vscode.commands.registerCommand("alloy.bridgeDiagnostics", () => {
        this.showDiagnostics();
      }),
    );

    if (this.config.autoStart) {
      void this.start();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  get status(): BridgeStatus {
    return this._status;
  }

  /** Start the bridge process. */
  async start(): Promise<void> {
    if (this.process) return; // Already running
    this.intentionallyStopped = false;

    // Generate ephemeral secret
    this.bridgeSecret = crypto.randomBytes(32).toString('hex');
    
    // Phase 3.1 IPC Patch: Check if a bridge (from another VS Code window) is already alive
    // Note: If adopting a shared bridge, we'd need to know its secret. 
    // In forensics mode, we prefer isolation, so we'll try to check health WITHOUT secret first
    // to see if we CAN talk to it (which we shouldn't if it's hardened).
    const isAlreadyHealthy = await this.checkHealth();
    if (isAlreadyHealthy) {
      this.pushDiagnostic(`[BridgeManager] Port ${this.config.port} is already active. Adopting shared bridge.`);
      // If it responded without secret, it's unhardened. We'll use it but log warning.
      this.setStatus("healthy");
      this.startHealthProbe();
      return;
    }

    // Detect Python interpreter
    this.pythonPath = await this.detectPython();
    const bridgePath = this.resolveBridgePath();

    if (!bridgePath) {
      this.setStatus("unhealthy");
      this.pushDiagnostic("[BridgeManager] bridge.py not found in workspace");
      return;
    }

    this.setStatus("starting");
    this.pushDiagnostic(`[BridgeManager] Spawning: ${this.pythonPath} ${bridgePath} --port ${this.config.port}`);

    const env = {
      ...process.env,
      PYTHONPATH: path.dirname(bridgePath),
      ALLOY_BRIDGE_PORT: String(this.config.port),
      ALLOY_BRIDGE_SECRET: this.bridgeSecret,
    };

    try {
      this.process = spawn(this.pythonPath, [bridgePath, "--port", String(this.config.port)], {
        cwd: path.dirname(bridgePath),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.startedAt = Date.now();

      // Capture stdout
      this.process.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          this.pushDiagnostic(`[stdout] ${line}`);
        }
      });

      // Capture stderr into ring buffer
      this.process.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          this.pushDiagnostic(`[stderr] ${line}`);
        }
      });

      // Handle process exit
      this.process.on("exit", (code, signal) => {
        this.pushDiagnostic(`[BridgeManager] Process exited: code=${code}, signal=${signal}`);
        this.process = null;
        this.startedAt = 0;

        if (!this.intentionallyStopped) {
          this.setStatus("restarting");
          this.scheduleRestart();
        } else {
          this.setStatus("stopped");
        }
      });

      this.process.on("error", (err) => {
        this.pushDiagnostic(`[BridgeManager] Process error: ${err.message}`);
        this.process = null;
        this.startedAt = 0;
        this.setStatus("restarting");
        this.scheduleRestart();
      });

      // Start health probe loop
      this.startHealthProbe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.pushDiagnostic(`[BridgeManager] Spawn failed: ${msg}`);
      this.setStatus("unhealthy");
      this.scheduleRestart();
    }
  }

  /** Stop the bridge process gracefully. */
  async stop(): Promise<void> {
    this.intentionallyStopped = true;
    this.stopHealthProbe();
    this.cancelRestart();

    if (!this.process) {
      this.setStatus("stopped");
      return;
    }

    this.pushDiagnostic("[BridgeManager] Stopping gracefully...");

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        if (this.process) {
          this.pushDiagnostic("[BridgeManager] SIGKILL after timeout");
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5_000);

      this.process!.once("exit", () => {
        clearTimeout(killTimer);
        this.process = null;
        this.setStatus("stopped");
        resolve();
      });

      // Try graceful SIGINT first
      this.process!.kill("SIGINT");
    });
  }

  /** Force restart (resets backoff). */
  async restart(): Promise<void> {
    this.restartAttempt = 0;
    await this.stop();
    this.intentionallyStopped = false;
    await this.start();
  }

  /** Get full health report. */
  getHealthReport(): BridgeHealthReport {
    return {
      status: this._status,
      availabilityScore: this.computeAvailabilityScore(),
      uptimeMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      lastLatencyMs: this.lastLatencyMs,
      restartCount: this.restartCount,
      port: this.config.port,
      pythonPath: this.pythonPath,
      diagnostics: [...this.diagnosticsBuffer],
    };
  }

  /** Check bridge health (single probe). */
  async checkHealth(): Promise<boolean> {
    const start = Date.now();
    try {
      const headers: Record<string, string> = {};
      if (this.bridgeSecret) {
        headers["X-Bridge-Secret"] = this.bridgeSecret;
      }
      
      const response = await fetch(`http://127.0.0.1:${this.config.port}/health`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      this.lastLatencyMs = Date.now() - start;
      return response.ok;
    } catch {
      this.lastLatencyMs = Date.now() - start;
      return false;
    }
  }

  /** Fetch optimization stats from bridge. */
  async fetchStats(): Promise<Record<string, unknown> | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.bridgeSecret) {
        headers["X-Bridge-Secret"] = this.bridgeSecret;
      }

      const response = await fetch(`http://127.0.0.1:${this.config.port}/cache-stats`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  dispose(): void {
    void this.stop();
    this._onStatusChange.dispose();
    this.statusBarItem.dispose();
  }

  // ── Health Probe ────────────────────────────────────────────────────────

  private startHealthProbe(): void {
    this.stopHealthProbe();
    this.healthWindow = [];

    this.healthTimer = setInterval(async () => {
      const healthy = await this.checkHealth();

      // Sliding window update
      this.healthWindow.push(healthy);
      if (this.healthWindow.length > this.config.healthWindowSize) {
        this.healthWindow.shift();
      }

      const score = this.computeAvailabilityScore();

      if (healthy && this._status !== "healthy") {
        this.setStatus("healthy");
        this.restartAttempt = 0; // Reset backoff on success
      } else if (!healthy && score < 0.4 && this._status === "healthy") {
        this.setStatus("unhealthy");
        
        // Phase 3.1 IPC Patch: If we don't own the process (adopted), takeover and spawn!
        if (!this.process && !this.intentionallyStopped && !this.restartTimer) {
          this.pushDiagnostic("[BridgeManager] Shared bridge went offline. Taking over process execution.");
          this.setStatus("restarting");
          this.scheduleRestart();
        }
      }
    }, this.config.healthIntervalMs);
  }

  private stopHealthProbe(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /** Sliding window availability score (0-1). */
  private computeAvailabilityScore(): number {
    if (this.healthWindow.length === 0) return 0;
    const successes = this.healthWindow.filter(Boolean).length;
    return successes / this.healthWindow.length;
  }

  // ── Exponential Backoff Restart ─────────────────────────────────────────

  private scheduleRestart(): void {
    if (this.intentionallyStopped) return;

    // Exponential backoff with jitter
    const baseDelay = this.config.backoffBaseMs * Math.pow(2, this.restartAttempt);
    const clamped = Math.min(baseDelay, this.config.backoffMaxMs);
    const jitter = (Math.random() - 0.5) * 2 * this.config.backoffJitterMs;
    const delay = Math.max(0, clamped + jitter);

    this.restartAttempt++;
    this.restartCount++;

    this.pushDiagnostic(
      `[BridgeManager] Scheduling restart #${this.restartCount} in ${Math.round(delay)}ms (attempt ${this.restartAttempt})`,
    );

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, delay);
  }

  private cancelRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  // ── Python Detection ───────────────────────────────────────────────────

  private async detectPython(): Promise<string> {
    // Priority: conda env > python3 > python
    const candidates = ["python3", "python"];

    // Check for conda/venv in workspace
    const venvPaths = [
      path.join(this.workspaceRoot, "bridge", ".venv", "Scripts", "python.exe"),
      path.join(this.workspaceRoot, "bridge", ".venv", "bin", "python"),
      path.join(this.workspaceRoot, ".venv", "Scripts", "python.exe"),
      path.join(this.workspaceRoot, ".venv", "bin", "python"),
    ];

    for (const venvPath of venvPaths) {
      if (fs.existsSync(venvPath)) {
        this.pushDiagnostic(`[BridgeManager] Found venv Python: ${venvPath}`);
        return venvPath;
      }
    }

    // Check VS Code Python extension setting
    const pythonConfig = vscode.workspace.getConfiguration("python");
    const interpreterPath = pythonConfig.get<string>("defaultInterpreterPath");
    if (interpreterPath && fs.existsSync(interpreterPath)) {
      this.pushDiagnostic(`[BridgeManager] Using VS Code Python: ${interpreterPath}`);
      return interpreterPath;
    }

    // Fall through: try system candidates
    for (const candidate of candidates) {
      try {
        execSync(`${candidate} --version`, { stdio: "ignore" });
        return candidate;
      } catch {
        continue;
      }
    }

    return "python"; // Last resort
  }

  private resolveBridgePath(): string | null {
    // Search paths for bridge.py
    const searchPaths = [
      path.join(this.workspaceRoot, "bridge", "bridge.py"),
      path.join(this.workspaceRoot, "..", "bridge", "bridge.py"),
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) return p;
    }

    return null;
  }

  // ── Status Management ──────────────────────────────────────────────────

  private setStatus(status: BridgeStatus): void {
    if (this._status === status) return;
    this._status = status;
    this._onStatusChange.fire(status);
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const icons: Record<BridgeStatus, string> = {
      stopped: "$(circle-slash)",
      starting: "$(loading~spin)",
      healthy: "$(pass-filled)",
      unhealthy: "$(error)",
      restarting: "$(sync~spin)",
    };

    const colors: Record<BridgeStatus, string | undefined> = {
      stopped: undefined,
      starting: "statusBarItem.warningBackground",
      healthy: undefined,
      unhealthy: "statusBarItem.errorBackground",
      restarting: "statusBarItem.warningBackground",
    };

    this.statusBarItem.text = `${icons[this._status]} Bridge`;
    this.statusBarItem.tooltip = `Optimization Bridge: ${this._status} (port ${this.config.port})`;
    this.statusBarItem.backgroundColor = colors[this._status]
      ? new vscode.ThemeColor(colors[this._status]!)
      : undefined;
  }

  // ── Diagnostics ────────────────────────────────────────────────────────

  private pushDiagnostic(line: string): void {
    const timestamped = `[${new Date().toISOString().slice(11, 23)}] ${line}`;
    this.diagnosticsBuffer.push(timestamped);
    if (this.diagnosticsBuffer.length > this.config.diagnosticsCapacity) {
      this.diagnosticsBuffer.shift();
    }
  }

  private showDiagnostics(): void {
    const report = this.getHealthReport();
    const doc = [
      `# Bridge Diagnostics`,
      ``,
      `Status: ${report.status}`,
      `Availability: ${(report.availabilityScore * 100).toFixed(1)}%`,
      `Uptime: ${Math.round(report.uptimeMs / 1000)}s`,
      `Last Latency: ${report.lastLatencyMs}ms`,
      `Restart Count: ${report.restartCount}`,
      `Python: ${report.pythonPath}`,
      `Port: ${report.port}`,
      ``,
      `## Recent Logs (last ${report.diagnostics.length})`,
      ``,
      ...report.diagnostics.map((l) => `    ${l}`),
    ].join("\n");

    void vscode.workspace
      .openTextDocument({ content: doc, language: "markdown" })
      .then((d) => vscode.window.showTextDocument(d, { preview: true }));
  }
}
