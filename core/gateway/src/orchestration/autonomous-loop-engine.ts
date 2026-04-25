import * as nodeCrypto from "node:crypto";
import type {
  AutonomySession,
  AutonomyState,
  BudgetLimits,
  CreateAutonomySessionRequest,
  AutonomousClientResolver,
  AutonomousTaskExecutor,
  AutonomyEvent,
} from "./autonomy-types";
import type { AlloyGatewayClient } from "./gateway-client";
import { SmartMultiModelRouter } from "./autonomy-model-router";
import { AutonomyGitManager } from "./autonomy-git-manager";
import { GateEngine } from "./GateEngine";
import { TerminalExecutor } from "./terminal-executor";
import {
  budgetTracker as defaultBudgetTracker,
  type BudgetTracker,
} from "./BudgetTracker";
import { SkillEngine } from "./SkillEngine";
import { taskGraphManager } from "./TaskGraphManager";

// Modular Engine Components
import { AutonomyLoopOrchestrator } from "./engine/autonomy-loop-orchestrator";
import { AutonomySessionManager } from "./engine/autonomy-session-manager";
import { AutonomyGitOrchestrator } from "./engine/autonomy-git-orchestrator";
import { AutonomyInterruptHandler } from "./engine/autonomy-interrupt-handler";
import { AutonomyCycleRunner } from "./engine/autonomy-cycle-runner";

interface AutonomousLoopEngineOptions {
  projectRoot: string;
  client?: AlloyGatewayClient;
  clientResolver?: AutonomousClientResolver;
  taskExecutor?: AutonomousTaskExecutor;
  gateEngine?: GateEngine;
  modelRouter?: SmartMultiModelRouter;
  gitManager?: AutonomyGitManager;
  budgetTracker?: BudgetTracker;
  maxTaskAttempts?: number;
  opLogDir?: string;
}

const DEFAULT_MAX_CYCLES = 12;
const DEFAULT_MAX_DURATION_MS = 45 * 60 * 1000;
const DEFAULT_MAX_INPUT_TOKENS = 2_000_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 400_000;
const DEFAULT_MAX_TPM = 1_000_000;
const DEFAULT_MAX_RPD = 5_000;

export class AutonomousLoopEngine {
  private readonly runningSessions = new Set<string>();
  private readonly listeners = new Set<(event: AutonomyEvent) => void>();
  private readonly terminal: TerminalExecutor;
  private readonly skillEngine: SkillEngine;
  private readonly budgetTracker: BudgetTracker;

  // Delegated Services
  private readonly sessionManager: AutonomySessionManager;
  private readonly gitOrchestrator: AutonomyGitOrchestrator;
  private readonly interruptHandler: AutonomyInterruptHandler;
  private readonly cycleRunner: AutonomyCycleRunner;
  private readonly orchestrator: AutonomyLoopOrchestrator;

  constructor(private readonly options: AutonomousLoopEngineOptions) {
    this.terminal = new TerminalExecutor(options.projectRoot);
    this.budgetTracker = options.budgetTracker ?? defaultBudgetTracker;
    this.skillEngine = new SkillEngine(options.projectRoot);

    const emit = (type: AutonomyEvent["type"], session: AutonomySession, payload: Record<string, unknown>) => 
      this.emit(type, session, payload);

    this.sessionManager = new AutonomySessionManager({
      projectRoot: options.projectRoot,
      opLogDir: options.opLogDir,
      budgetTracker: this.budgetTracker,
      emit,
    });

    const gitManager = options.gitManager ?? new AutonomyGitManager(options.projectRoot);
    this.gitOrchestrator = new AutonomyGitOrchestrator(gitManager);

    this.interruptHandler = new AutonomyInterruptHandler({
      sessionManager: this.sessionManager,
      budgetTracker: this.budgetTracker,
      emit,
    });

    const taskExecutor = options.taskExecutor ?? (async ({ task }) => ({
      summary: `Task ${task.type} completed with default executor`,
    }));

    const gateEngine = options.gateEngine ?? GateEngine.createDefaultGateEngine(this.terminal, options.client);

    this.cycleRunner = new AutonomyCycleRunner({
      sessionManager: this.sessionManager,
      taskExecutor,
      modelRouter: options.modelRouter ?? new SmartMultiModelRouter(),
      gateEngine,
      emit,
      clientResolver: options.clientResolver,
      defaultClient: options.client,
    });

    this.orchestrator = new AutonomyLoopOrchestrator({
      sessionManager: this.sessionManager,
      cycleRunner: this.cycleRunner,
      interruptHandler: this.interruptHandler,
      gitOrchestrator: this.gitOrchestrator,
      skillEngine: this.skillEngine,
      budgetTracker: this.budgetTracker,
      projectRoot: options.projectRoot,
      emit,
      onSessionComplete: (session) => this.completeSession(session),
    });
  }

  public onEvent(listener: (event: AutonomyEvent) => void): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public create(request: CreateAutonomySessionRequest, initialState: AutonomyState = "init"): AutonomySession {
    const session = this.createSessionObject(request, initialState);
    this.sessionManager.addSession(session);
    return session;
  }

  public hydrateSession(snapshot: AutonomySession): AutonomySession {
    if (this.sessionManager.hasSession(snapshot.id)) {
      throw new Error(`Autonomy session already loaded: ${snapshot.id}`);
    }
    this.sessionManager.addSession(snapshot);
    return snapshot;
  }

  public runExistingInBackground(sessionId: string): boolean {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      process.stderr.write(`[AUTONOMY] runExistingInBackground ${sessionId} failed: session not found\n`);
      return false;
    }
    if (this.runningSessions.has(sessionId)) {
      process.stderr.write(`[AUTONOMY] runExistingInBackground ${sessionId} failed: already running\n`);
      return false;
    }
    if (["done", "failed", "stopped"].includes(session.state)) {
      process.stderr.write(`[AUTONOMY] runExistingInBackground ${sessionId} failed: terminal state ${session.state}\n`);
      return false;
    }
    process.stderr.write(`[AUTONOMY] runExistingInBackground ${sessionId} starting runSession\n`);
    void this.runSession(sessionId);
    return true;
  }

  public setQueuePosition(sessionId: string, queuePosition: number | null): boolean {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return false;
    session.queuePosition = queuePosition;
    session.updatedAt = new Date().toISOString();
    return true;
  }

  public startInBackground(request: CreateAutonomySessionRequest): AutonomySession {
    const session = this.create(request, request.startMode === "queued" ? "queued" : "init");
    this.runExistingInBackground(session.id);
    return session;
  }

  public async start(request: CreateAutonomySessionRequest): Promise<AutonomySession> {
    const session = this.create(request, request.startMode === "queued" ? "queued" : "init");
    return this.runSession(session.id);
  }

  public async startExisting(sessionId: string): Promise<AutonomySession> {
    await this.sessionManager.hydrateFromDisk();
    return this.runSession(sessionId);
  }

  public getSession(sessionId: string): AutonomySession | null {
    return this.sessionManager.getSession(sessionId);
  }

  public async listSessions(): Promise<AutonomySession[]> {
    await this.sessionManager.hydrateFromDisk();
    return this.sessionManager.getAllSessions();
  }

  public getArtifacts(sessionId: string): AutonomySession["artifacts"] | null {
    const session = this.sessionManager.getSession(sessionId);
    return session ? structuredClone(session.artifacts) : null;
  }

  public stop(sessionId: string, reason = "Stopped by user"): boolean {
    return this.interruptHandler.stop(sessionId, reason);
  }

  public async stopQueued(sessionId: string, reason = "Cancelled while queued"): Promise<boolean> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session || this.runningSessions.has(sessionId) || session.state !== "queued") return false;
    
    // StopQueued means the session will never run, so detachment is correct here.
    // However, if we ever allow "unstopping", we need to re-attach.
    this.budgetTracker.detachSession(session);
    session.stopReason = reason;
    await this.sessionManager.transition(session, "stopped", null, reason);
    this.emit("stopped", session, { reason });
    return true;
  }

  public pause(sessionId: string, reason = "Paused by user"): boolean {
    return this.interruptHandler.pause(sessionId, reason);
  }

  public resume(sessionId: string, reason = "Resumed by user"): boolean {
    return this.interruptHandler.resume(sessionId, reason);
  }

  private async runSession(sessionId: string): Promise<AutonomySession> {
    return this.orchestrator.runSession(
      sessionId,
      (id) => this.runningSessions.has(id),
      (id, active) => {
        if (active) this.runningSessions.add(id);
        else this.runningSessions.delete(id);
      }
    );
  }

  private async completeSession(session: AutonomySession): Promise<void> {
    if (["done", "failed", "stopped"].includes(session.state)) return;
    if (this.interruptHandler.isStopRequested(session.id)) {
        await this.interruptHandler.applyStopIfRequested(session);
        return;
    }

    if (session.state === "init") {
      if (await this.interruptHandler.applyStopIfRequested(session)) return;
      await this.sessionManager.transition(session, "done", null, "Session completed (no tasks)");
      return;
    }

    if (session.gitMode === "auto_branch_commit") {
      const conflict = await this.gitOrchestrator.findWorkspaceConflict(session);
      if (conflict.length > 0) {
        await this.sessionManager.failSession(session, `Workspace conflict: ${conflict.join(", ")}`);
        return;
      }
      const commit = await this.gitOrchestrator.commitSession(session);
      this.emit("log", session, { message: commit.message });
    } else if (session.gitMode === "patch_only") {
      const patch = await this.gitOrchestrator.exportPatch(session);
      if (patch) {
        session.artifacts.plan = `## GIT PATCH\n\n\`\`\`diff\n${patch}\n\`\`\`\n\n${session.artifacts.plan}`;
      }
    }

    if (await this.interruptHandler.applyStopIfRequested(session)) return;
    await this.sessionManager.transition(session, "done", null, "Autonomy completed");
    this.budgetTracker.detachSession(session);
    this.emit("done", session, {
      commitHash: session.commitHash,
      branchName: session.branchName,
      touchedFiles: session.touchedFiles,
    });
  }


  private emit(type: AutonomyEvent["type"], session: AutonomySession, payload: Record<string, unknown>): void {
    const event: AutonomyEvent = {
        type,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        payload: { ...payload, selectedSession: this.buildSummary(session) }
    };
    for (const listener of this.listeners) {
      try { listener(event); } catch (e) { console.error("[AutonomyEvent] Listener failed", e); }
    }
  }

  private createSessionObject(request: CreateAutonomySessionRequest, state: AutonomyState): AutonomySession {
    const now = new Date().toISOString();
    const budgets = this.normalizeBudgets(request);
    return {
      id: `aut_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${nodeCrypto.randomBytes(3).toString("hex")}`,
      objective: request.objective.trim(),
      account: request.account,
      anchorModel: request.anchorModel,
      modelPolicy: request.modelPolicy,
      gitMode: request.gitMode,
      startMode: request.startMode ?? "immediate",
      scope: request.scope,
      strictMode: request.strictMode ?? true,
      state: state,
      reviewAfterPlan: request.reviewAfterPlan ?? false,
      currentModel: request.anchorModel,
      currentGear: "standard",
      reviewStatus: "none",
      reviewUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
      cycleCount: 0,
      maxCycles: budgets.maxCycles,
      maxDurationMs: budgets.maxDurationMs,
      queuePosition: state === "queued" ? 0 : null,
      taskGraph: request.taskGraph ?? taskGraphManager.createDefaultGraph(3),
      budgets: {
        limits: budgets,
        usage: { cyclesUsed: 0, durationMsUsed: 0, inputTokensUsed: 0, outputTokensUsed: 0, currentTPM: 0, requestsUsed: 0, usdUsed: 0 },
        warning: false,
        warningReason: null,
        exceeded: false,
        exceedReason: null,
      },
      consecutiveGateFailures: 0,
      branchName: null,
      baseBranch: null,
      commitHash: null,
      touchedFiles: [],
      baselineDirtyFiles: [],
      modelHistory: [],
      timeline: [],
      opLog: [],
      artifacts: { plan: "", changeSummary: "", nextActionReason: "Initialized", gateResult: null, rawResponses: [], contextPack: "" },
      error: null,
      stopReason: null,
      lastProgressAt: now,
    };
  }

  private normalizeBudgets(request: CreateAutonomySessionRequest): BudgetLimits {
    const b = request.budgets ?? {};
    return {
      maxCycles: b.maxCycles ?? DEFAULT_MAX_CYCLES,
      maxDurationMs: b.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
      maxInputTokens: b.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
      maxOutputTokens: b.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      maxTPM: b.maxTPM ?? DEFAULT_MAX_TPM,
      maxRPD: b.maxRPD ?? DEFAULT_MAX_RPD,
      maxUsd: b.maxUsd ?? 0,
    };
  }

  private buildSummary(session: AutonomySession): { id: string; state: AutonomyState; objective: string; account: string } {
    return { id: session.id, state: session.state, objective: session.objective, account: session.account };
  }


  /**
   * Internal method for testing: prunes touched files against git status
   */
  private async revalidateTouchedFiles(session: AutonomySession): Promise<void> {
    const gitManager = this.options.gitManager ?? new AutonomyGitManager(this.options.projectRoot);
    const dirty = await gitManager.getDirtyFiles();
    const normalizedDirty = dirty.map((f: string) => f.replace(/\\/g, "/"));
    session.touchedFiles = session.touchedFiles
      .filter((f: string) => normalizedDirty.includes(f.replace(/\\/g, "/")))
      .map((f: string) => f.replace(/\\/g, "/")); // Normalize the stored paths too
    session.updatedAt = new Date().toISOString();
  }
}