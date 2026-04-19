import crypto from "node:crypto";
import path from "node:path";
import type {
  AutonomyEvent,
  AutonomySession,
  AutonomyState,
  BudgetLimits,
  CreateAutonomySessionRequest,
  ModelDecision,
  ModelSwitchReason,
  GateResult,
  SessionOpLogEntry,
  TaskNode,
  TaskNodeType,
  GearLevel,
} from "./autonomy-types";
import { normalizeTouchedFiles } from "./antigravity-utils";
import { SmartMultiModelRouter } from "./autonomy-model-router";
import { AutonomyGitManager } from "./autonomy-git-manager";
import { phaseEngine } from "./PhaseEngine";
import { gearEngine } from "./GearEngine";
import { GateEngine } from "./GateEngine";
import { TerminalExecutor } from "./terminal-executor";
import {
  BudgetReservationError,
  budgetTracker as defaultBudgetTracker,
  type BudgetExecutionAccounting,
  type BudgetTracker,
} from "./BudgetTracker";
import { SkillEngine } from "./SkillEngine";
import { SessionPersistenceManager } from "./SessionPersistenceManager";
import { taskGraphManager } from "./TaskGraphManager";

const DEFAULT_MAX_CYCLES = 12;
const DEFAULT_MAX_TASK_ATTEMPTS = 3;
const DEFAULT_MAX_DURATION_MS = 45 * 60 * 1000;
const DEFAULT_MAX_INPUT_TOKENS = 2_000_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 400_000;
const DEFAULT_MAX_TPM = 1_000_000;
const DEFAULT_MAX_RPD = 5_000;
const PAUSE_POLL_INTERVAL_MS = 500;

export interface AutonomousTaskExecutionContext {
  session: AutonomySession;
  task: TaskNode;
  modelDecision: ModelDecision;
  cycle: number;
  isInterrupted: () => boolean;
}

export interface AutonomousTaskExecutionResult {
  summary: string;
  touchedFiles?: string[];
  nextActionReason?: string;
  contextPack?: string;
  usageAccounting?: BudgetExecutionAccounting;
  inputTokens?: number;
  outputTokens?: number;
  estimatedUsd?: number;
}

export type AutonomousClientResolver = (session: AutonomySession) => Promise<any>;

export type AutonomousTaskExecutor = (
  context: AutonomousTaskExecutionContext,
) => Promise<AutonomousTaskExecutionResult>;

interface AutonomousLoopEngineOptions {
  projectRoot: string;
  client?: import("./antigravity-client").AntigravityClient;
  clientResolver?: AutonomousClientResolver;
  taskExecutor?: AutonomousTaskExecutor;
  gateEngine?: GateEngine;
  modelRouter?: SmartMultiModelRouter;
  gitManager?: AutonomyGitManager;
  budgetTracker?: BudgetTracker;
  maxTaskAttempts?: number;
  opLogDir?: string;
}

interface AutonomySessionSummaryPayload {
  id: string;
  state: AutonomyState;
  objective: string;
  account: string;
  createdAt: string;
  updatedAt: string;
  queuePosition: number | null;
  branchName: string | null;
  baseBranch: string | null;
  commitHash: string | null;
  currentModel: string | null;
  currentGear: GearLevel | null;
  reviewStatus: AutonomySession["reviewStatus"];
  reviewUpdatedAt: string | null;
}

/**
 * Role-less autonomy engine with deterministic loop phases and strict gate control.
 */
export class AutonomousLoopEngine {
  private readonly sessions = new Map<string, AutonomySession>();
  private readonly runningSessions = new Set<string>();
  private readonly stopRequests = new Map<string, string>();
  private readonly pauseRequests = new Map<string, string>();
  private readonly resumeRequests = new Map<string, string>();
  private readonly sessionLocks = new Set<string>();
  private readonly listeners = new Set<(event: AutonomyEvent) => void>();
  private readonly taskExecutor: AutonomousTaskExecutor;
  private readonly modelRouter: SmartMultiModelRouter;
  private readonly gitManager: AutonomyGitManager;
  private readonly gateEngine: GateEngine;
  private readonly terminal: TerminalExecutor;
  private readonly skillEngine: SkillEngine;
  private readonly persistence: SessionPersistenceManager;
  private readonly maxTaskAttempts: number;
  private readonly budgetTracker: BudgetTracker;

  constructor(private readonly options: AutonomousLoopEngineOptions) {
    this.terminal = new TerminalExecutor(options.projectRoot);
    this.modelRouter = options.modelRouter ?? new SmartMultiModelRouter();
    this.gateEngine = options.gateEngine ?? GateEngine.createDefaultGateEngine(this.terminal, options.client);
    this.gitManager = options.gitManager ?? new AutonomyGitManager(options.projectRoot);
    this.skillEngine = new SkillEngine(options.projectRoot);
    this.persistence = new SessionPersistenceManager(options.projectRoot, options.opLogDir);
    this.maxTaskAttempts = options.maxTaskAttempts ?? DEFAULT_MAX_TASK_ATTEMPTS;
    this.budgetTracker = options.budgetTracker ?? defaultBudgetTracker;

    this.taskExecutor =
      options.taskExecutor ??
      (async ({ task }) => ({
        summary: `Task ${task.type} completed with default executor`,
      }));
  }

  public onEvent(listener: (event: AutonomyEvent) => void): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  public create(request: CreateAutonomySessionRequest, initialState: AutonomyState = "init"): AutonomySession {
    const session = this.createSession(request, initialState);
    this.sessions.set(session.id, session);
    this.budgetTracker.attachSession(session);
    return session;
  }

  public hydrateSession(snapshot: AutonomySession): AutonomySession {
    if (this.sessions.has(snapshot.id)) {
      throw new Error(`Autonomy session already loaded: ${snapshot.id}`);
    }

    this.sessions.set(snapshot.id, snapshot);
    this.budgetTracker.attachSession(snapshot);
    return snapshot;
  }

  public runExistingInBackground(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (this.runningSessions.has(sessionId)) return false;
    if (session.state === "done" || session.state === "failed" || session.state === "stopped") return false;
    void this.runSession(sessionId);
    return true;
  }

  public setQueuePosition(sessionId: string, queuePosition: number | null): boolean {
    const session = this.sessions.get(sessionId);
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
    const list = await this.listSessions();
    if (!list.some(s => s.id === sessionId)) {
       throw new Error(`Autonomy session not found: ${sessionId}`);
    }
    return this.runSession(sessionId);
  }

  public getSession(sessionId: string): AutonomySession | null {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : null;
  }

  public async listSessions(): Promise<AutonomySession[]> {
    const onDisk = await this.persistence.listSessions();
    for (const snapshot of onDisk) {
      if (!this.sessions.has(snapshot.id)) {
        this.hydrateSession(snapshot);
      }
    }
    return [...this.sessions.values()].map((session) => structuredClone(session));
  }

  public getArtifacts(sessionId: string): AutonomySession["artifacts"] | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return structuredClone(session.artifacts);
  }

  public stop(sessionId: string, reason = "Stopped by user"): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.stopRequests.set(sessionId, reason);
    return true;
  }

  public async stopQueued(sessionId: string, reason = "Cancelled while queued"): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (this.runningSessions.has(sessionId)) return false;
    if (session.state !== "queued") return false;
    this.budgetTracker.detachSession(session);
    session.stopReason = reason;
    await this.transition(session, "stopped", null, reason);
    this.emit("stopped", session, { reason });
    return true;
  }

  public pause(sessionId: string, reason = "Paused by user"): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.pauseRequests.set(sessionId, reason);
    return true;
  }

  public resume(sessionId: string, reason = "Resumed by user"): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.resumeRequests.set(sessionId, reason);
    return true;
  }

  private async runSession(sessionId: string): Promise<AutonomySession> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      await this.listSessions(); // Trigger hydration
      session = this.sessions.get(sessionId);
    }
    if (!session) {
      throw new Error(`Autonomy session not found: ${sessionId}`);
    }
    if (this.runningSessions.has(sessionId)) {
      return structuredClone(session);
    }

    this.runningSessions.add(sessionId);
    try {
      if (session.state === "queued") {
        session.queuePosition = null;
        await this.transition(session, "init", null, "Dequeued and starting autonomy session");
      }
      await this.loadOpLog(session);
      await this.initializeSkills();
      await this.prepareGit(session);
      if (session.touchedFiles.length > 0) {
        await this.revalidateTouchedFiles(session);
      }

      let nextSwitchReason: ModelSwitchReason = "INITIAL";
      let recoverToAnchorPending = false;
      while (session.cycleCount < session.maxCycles) {
        if (await this.checkInterrupts(session)) break;
        if (await this.applyPauseIfRequested(session)) continue;

        const task = taskGraphManager.findNextTask(session.taskGraph);
        if (!task) {
          await this.completeSession(session);
          break;
        }

        if (taskGraphManager.wasTaskCompleted(session.taskGraph, task.type)) {
          task.status = "completed";
          task.updatedAt = new Date().toISOString();
          continue;
        }

        session.cycleCount += 1;
        const modelDecision = await this.prepareCycle(session, task, nextSwitchReason, recoverToAnchorPending);
        if (
          recoverToAnchorPending &&
          nextSwitchReason === "ROUTER_POLICY" &&
          modelDecision.selectedModel === modelDecision.anchorModel
        ) {
          recoverToAnchorPending = false;
        }

        const reviewDecision = await this.awaitPlanReviewDecision(session, task);
        if (reviewDecision !== "continue") {
          break;
        }

        const executionResult = await this.executeCycle(session, task, modelDecision);
        if (executionResult.success) {
          taskGraphManager.completeTask(session.taskGraph, task.type);
        }
        
        if (await this.checkInterrupts(session, true)) break; // Skip budget check here to allow finalization
        if (!executionResult.success) {
          nextSwitchReason = executionResult.nextSwitchReason!;
          recoverToAnchorPending = true;
          if (session.state === "failed") break; // Exhausted retries
          continue;
        }

        const gateResult = await this.verifyCycle(session, task);
        const reflection = await this.reflectOnCycle(session, task, gateResult, executionResult.result!);
        if (await this.checkInterrupts(session)) break;

        if (!reflection.passed) {
          nextSwitchReason = reflection.nextSwitchReason!;
          recoverToAnchorPending = true;
          if (session.state === "failed") break;
          continue;
        }

        await this.finalizeCycle(session, task, reflection.nextActionReason);
        nextSwitchReason = executionResult.nextSwitchReason ?? "ROUTER_POLICY";
        recoverToAnchorPending =
          executionResult.nextSwitchReason === undefined &&
          modelDecision.selectedModel !== modelDecision.anchorModel;
        if (await this.checkInterrupts(session)) break; 
        if (session.state === "done") break;
      }

      if (session.state !== "done" && session.state !== "failed" && session.state !== "stopped") {
        this.failSession(session, `cycles budget exhausted (${session.maxCycles} cycles)`);
      }

      return structuredClone(session);
    } catch (error: any) {
      if (session.state !== "failed" && session.state !== "stopped") {
        this.failSession(session, this.errorToMessage(error));
      }
      return structuredClone(session);
    } finally {
      if (session.state === "failed") {
        await this.cleanupFailedGitSession(session);
      }
      this.runningSessions.delete(sessionId);
    }
  }

  private async prepareGit(session: AutonomySession): Promise<void> {
    if (session.gitMode !== "auto_branch_commit") return;
    if (session.branchName && session.baseBranch) return;

    const isRepo = await this.gitManager.isGitRepository();
    if (!isRepo) {
      this.failSession(session, "Git repository not found; auto branch/commit cannot run");
      throw new Error(session.error ?? "Git repository not found");
    }

    const dirtyFiles = await this.gitManager.getDirtyFiles();
    session.baselineDirtyFiles = dirtyFiles;
    const baseBranch = await this.gitManager.getCurrentBranch();
    if (!baseBranch) {
      this.failSession(session, "Unable to detect current base branch for autonomy session");
      throw new Error(session.error ?? "Unable to detect base branch");
    }
    session.baseBranch = baseBranch;
    if (!session.branchName) {
      session.branchName = await this.gitManager.createSessionBranch(session.id, baseBranch);
    }
    this.emit("log", session, {
      message: `Created session branch ${session.branchName} from ${baseBranch}`,
    });
  }

  private async completeSession(session: AutonomySession): Promise<void> {
    if (session.state === "done" || session.state === "failed" || session.state === "stopped") {
      return;
    }
    // Deterministic race arbitration: if a pause is pending at completion boundary, pause wins.
    const resolvedFinalState = phaseEngine.validateTransition(session, "done", null, {
      pauseRequested: this.pauseRequests.has(session.id),
    });
    if (resolvedFinalState === "paused") {
      await this.applyPauseIfRequested(session);
      return;
    }

    if (session.state === "init") {
      await this.transition(session, "done", null, "Session completed (no tasks found)");
      return;
    }

    if (session.gitMode === "auto_branch_commit") {
      const conflict = await this.findWorkspaceConflict(session);
      if (conflict.length > 0) {
        await this.failSession(
          session,
          `Workspace conflict detected before commit: ${conflict.join(", ")}`,
        );
        return;
      }

      const gateCommands = session.artifacts.gateResult
        ? session.artifacts.gateResult.commands.map((item) => item.command)
        : [];

      const commit = await this.gitManager.commitSession({
        sessionId: session.id,
        objective: session.objective,
        modelPolicy: session.modelPolicy,
        gateCommands,
        touchedFiles: session.touchedFiles,
      });

      session.commitHash = commit.commitHash;
      this.emit("log", session, {
        message: commit.commitHash
          ? `Committed session changes: ${commit.commitHash}`
          : "No commit created (no file changes)",
      });
    } else if (session.gitMode === "patch_only") {
      const gateCommands = session.artifacts.gateResult
        ? session.artifacts.gateResult.commands.map((item) => item.command)
        : [];
      
      const patch = await this.gitManager.exportPatch({
        sessionId: session.id,
        objective: session.objective,
        modelPolicy: session.modelPolicy,
        gateCommands,
        touchedFiles: session.touchedFiles,
      });

      if (patch) {
        session.artifacts.plan = `## GIT PATCH (Mode: patch_only)\n\n\`\`\`diff\n${patch}\n\`\`\`\n\n${session.artifacts.plan}`;
        this.emit("log", session, {
          message: "Generated git patch for session (patch_only mode)",
        });
      }
    }

    // Phase 4D: Skill Extraction
    await this.extractSkillFromSession(session).catch(err => {
      console.warn(`[SkillEngine] Failed to extract skill from session ${session.id}: ${err.message}`);
    });

    await this.transition(session, "done", null, "Autonomy session completed");
    this.budgetTracker.detachSession(session);
    this.emit("done", session, {
      commitHash: session.commitHash,
      branchName: session.branchName,
      baseBranch: session.baseBranch,
      touchedFiles: session.touchedFiles,
    });
  }

  private async extractSkillFromSession(session: AutonomySession): Promise<void> {
    if (!this.skillEngine || session.touchedFiles.length === 0) return;
    
    // Phase 4D: Zero-Warning Policy (Bulletproof Requirement)
    const gateResult = session.artifacts.gateResult;
    if (!gateResult || !gateResult.passed || gateResult.blockingIssues.length > 0) {
      console.warn(`[SkillEngine] Skill extraction bypassed for session ${session.id} due to non-zero gate issues.`);
      return;
    }

    // Simple extraction logic: if mission was successful, summarize it as a skill
    const successfulOps = session.opLog.filter(l => l.status === "completed" && (l.taskType === "implementation" || l.taskType === "refactor"));
    if (successfulOps.length === 0) return;

    const summary = successfulOps.map(op => op.summary).join("\n");
    const skillName = `Skill from session ${session.id.slice(0, 8)}`;
    
    await this.skillEngine.saveSkill({
      name: skillName,
      description: `Tactical skill extracted from objective: ${session.objective}`,
      content: [
        "## Tactical Summary",
        summary,
        "",
        "## Files Touched",
        ...session.touchedFiles.map(f => `- ${f}`)
      ].join("\n"),
      tags: ["autonomy-extracted", ...session.touchedFiles.map(f => path.extname(f).slice(1)).filter(Boolean)]
    });
  }

  private async findWorkspaceConflict(session: AutonomySession): Promise<string[]> {
    const currentDirty = await this.gitManager.getDirtyFiles();
    const baseline = new Set(session.baselineDirtyFiles.map(normalizeSinglePath));
    const touched = new Set(session.touchedFiles.map(normalizeSinglePath));
    const conflicts: string[] = [];

    for (const file of currentDirty.map(normalizeSinglePath)) {
      if (touched.has(file) && baseline.has(file)) {
        conflicts.push(file);
        continue;
      }
      if (!touched.has(file) && !baseline.has(file)) {
        conflicts.push(file);
      }
    }

    return [...new Set(conflicts)];
  }



  private async transition(
    session: AutonomySession,
    state: AutonomyState,
    task: TaskNode | null,
    note: string,
  ): Promise<void> {
    // 1. Lock check with retry logic to prevent concurrent transition races (Hardened Phase 1.2)
    let lockAttempts = 0;
    const MAX_LOCK_ATTEMPTS = 20; // Increased for test environment stability
    while (this.sessionLocks.has(session.id) && lockAttempts < MAX_LOCK_ATTEMPTS) {
      lockAttempts++;
      const delay = 50 * Math.pow(1.5, lockAttempts); // Higher base, slower growth for better tail recovery
      await sleep(delay);
    }

    if (this.sessionLocks.has(session.id)) {
      throw new Error(`[PhaseGuard] Critical Error: Failed to acquire transition lock for session ${session.id} after ${MAX_LOCK_ATTEMPTS} attempts.`);
    }
    this.sessionLocks.add(session.id);

    try {
      // 1.2. Double-check state after lock acquisition to prevent stale transitions
      if (session.state === state && state !== "failed") {
        return; // Already in target state, skip
      }
      
      // If we are already in a terminal state, only allow redundant terminal transitions or failing
      if (session.state === "failed" || session.state === "done" || session.state === "stopped") {
        if (state !== "failed" && state !== "done" && state !== "stopped") {
          console.warn(`[PhaseGuard] Blocked transition from terminal state ${session.state} to ${state}`);
          return;
        }
        // If we were stopped or done but now failing, allow it to capture the error
      }

      // 2. Enforce Phase Machine Rules (Phase 1.2)
      phaseEngine.validateTransition(session, state, task);

      session.state = state;
      session.updatedAt = new Date().toISOString();
      session.lastProgressAt = session.updatedAt; // Heartbeat update
      
      session.timeline.push({
        cycle: session.cycleCount,
        state,
        taskId: task?.id ?? null,
        note,
        timestamp: session.updatedAt,
      });

      // 3. Atomic State Persistence: Save to disk after every transition
      // Awaiting here is critical for "Bulletproof" status to prevent file I/O races
      await this.persistence.saveSession(session).catch(err => {
        console.error(`[Persistence] Failed to save state for session ${session.id}: ${err.message}`);
      });

      this.emit("state", session, {
        state,
        taskId: task?.id ?? null,
        cycle: session.cycleCount,
        note,
      });
      this.emit("step", session, {
        state,
        taskId: task?.id ?? null,
        cycle: session.cycleCount,
        note,
      });
    } catch (err: any) {
      console.error(`[PhaseGuard] Illegal transition attempt to ${state}: ${err.message}`);
      // Propagate error to caller (e.g. main loop) which will handle failSession outside of this lock
      throw err;
    } finally {
      this.sessionLocks.delete(session.id);
    }
  }

  private async failSession(session: AutonomySession, errorMessage: string): Promise<void> {
    // Double-check to prevent redundant failure transitions
    if (session.state === "failed" || session.state === "done" || session.state === "stopped") {
      return;
    }
    this.budgetTracker.detachSession(session);
    session.error = errorMessage;
    // Note: We don't set session.state = "failed" here anymore; transition will handle it under lock
    await this.transition(session, "failed", null, errorMessage);
    this.emit("failed", session, {
      error: errorMessage,
    });
  }



  private async applyPauseIfRequested(session: AutonomySession): Promise<boolean> {
    const pauseReason = this.pauseRequests.get(session.id);
    if (!pauseReason) return false;

    this.pauseRequests.delete(session.id);
    await this.transition(session, "paused", null, pauseReason);
    this.emit("log", session, { reason: pauseReason, paused: true });

    while (true) {
      if (await this.applyStopIfRequested(session)) return true;
      const resumeReason = this.resumeRequests.get(session.id);
      if (resumeReason) {
        this.resumeRequests.delete(session.id);
        await this.revalidateTouchedFiles(session);
        await this.transition(session, "retry", null, resumeReason);
        return true;
      }
      if (this.isWallClockTimeout(session)) {
        this.failSession(
          session,
          `Session wall-clock timeout reached while paused (${Math.round(session.maxDurationMs / 60000)} minutes)`,
        );
        return true;
      }
      await sleep(PAUSE_POLL_INTERVAL_MS);
    }
  }

  private async revalidateTouchedFiles(session: AutonomySession): Promise<void> {
    if (!session.touchedFiles || session.touchedFiles.length === 0) return;

    try {
      const currentDirty = await this.gitManager.getDirtyFiles();
      const normalizedDirty = new Set(currentDirty.map((f: string) => f.replace(/\\/g, "/")));

      const sessionTouched = session.touchedFiles.map((f: string) => f.replace(/\\/g, "/"));
      const stillTouched = sessionTouched.filter((f) => normalizedDirty.has(f));

      if (stillTouched.length !== session.touchedFiles.length) {
        const removedCount = session.touchedFiles.length - stillTouched.length;
        this.emit("log", session, {
          message: `Oturum devam ettirilirken doğrulama yapıldı: ${removedCount} dosya artık kirli değil (dirty), touchedFiles listesi güncellendi.`,
        });
        session.touchedFiles = stillTouched;
      }
    } catch (error) {
      console.warn(`[Hardening] Failed to revalidate touched files on resume: ${this.errorToMessage(error)}`);
    }
  }

  private buildPlanArtifact(session: AutonomySession, task: TaskNode, modelDecision: ModelDecision): string {
    const proposedSteps = [
      `Analyze task \`${task.type}\` against the active objective.`,
      `Apply changes only inside scoped paths: ${session.scope.paths.join(", ")}.`,
      "Run verification before advancing the mission state.",
    ];
    const expectedTouchPoints =
      session.touchedFiles.length > 0 ? session.touchedFiles : session.scope.paths;
    const riskLines = [
      session.strictMode ? "Strict gate validation remains enabled." : "Strict gate validation is bypassed.",
      `Router policy may switch away from ${session.anchorModel} when recovery triggers fire.`,
      `Budget guardrails: TPM ${session.budgets.limits.maxTPM.toLocaleString()} / RPD ${session.budgets.limits.maxRPD.toLocaleString()}.`,
    ];

    return [
      `# Plan Review`,
      ``,
      `## Objective`,
      session.objective,
      ``,
      `## Scope`,
      session.scope.paths.map((scopePath) => `- ${scopePath}`).join("\n"),
      ``,
      `## Current Phase`,
      `plan`,
      ``,
      `## Current Model`,
      `${modelDecision.selectedModel}`,
      ``,
      `## Proposed Steps`,
      proposedSteps.map((step) => `- ${step}`).join("\n"),
      ``,
      `## Expected Touch Points`,
      expectedTouchPoints.map((filePath) => `- ${filePath}`).join("\n"),
      ``,
      `## Risks / Gate Expectations`,
      riskLines.map((line) => `- ${line}`).join("\n"),
      ``,
      `## Next Action`,
      `Await approval for cycle ${session.cycleCount} before executing ${task.type}.`,
    ].join("\n");
  }

  private defaultNextActionReason(session: AutonomySession, taskType: TaskNodeType): string {
    const nextTask = taskGraphManager.findNextTask(session.taskGraph);
    if (!nextTask) return "All tasks complete";
    return `Task ${taskType} completed, proceed with ${nextTask.type}`;
  }

  private emit(type: AutonomyEvent["type"], session: AutonomySession, payload: Record<string, unknown>): void {
    const selectedSession = this.buildSelectedSessionSummary(session);
    const event: AutonomyEvent = {
      type,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      payload:
        type === "queue"
          ? payload
          : {
              ...payload,
              selectedSession,
            },
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // Listener failures should not break the orchestration loop.
        const message = this.errorToMessage(error);
        console.error(`[AutonomyEventListener] ${message}`);
      }
    }
  }

  private createSession(
    request: CreateAutonomySessionRequest,
    initialState: AutonomyState = "init",
  ): AutonomySession {
    const now = new Date().toISOString();
    const budgets = this.normalizeBudgetLimits(request);
    const initialModel = request.anchorModel.trim();
    const session: AutonomySession = {
      id: createSessionId(),
      objective: request.objective.trim(),
      account: request.account,
      anchorModel: request.anchorModel,
      modelPolicy: request.modelPolicy,
      gitMode: request.gitMode,
      startMode: request.startMode ?? "immediate",
      scope: request.scope,
      strictMode: request.strictMode ?? true,
      state: initialState,
      reviewAfterPlan: request.reviewAfterPlan ?? false,
      currentModel: initialModel,
      currentGear: this.deriveGear(initialModel),
      reviewStatus: "none",
      reviewUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
      cycleCount: 0,
      maxCycles: budgets.maxCycles,
      maxDurationMs: budgets.maxDurationMs,
      queuePosition: initialState === "queued" ? 0 : null,
      taskGraph: request.taskGraph ?? taskGraphManager.createDefaultGraph(3),
      budgets: {
        limits: budgets,
        usage: {
          cyclesUsed: 0,
          durationMsUsed: 0,
          inputTokensUsed: 0,
          outputTokensUsed: 0,
          currentTPM: 0,
          requestsUsed: 0,
          reservedTPM: 0,
          reservedRequests: 0,
          cachedInputTokensUsed: 0,
          usdUsed: 0,
        },
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
      artifacts: {
        plan: "",
        changeSummary: "",
        nextActionReason: "Session initialized",
        gateResult: null,
        rawResponses: [],
        contextPack: "",
      },
      error: null,
      stopReason: null,
      lastProgressAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private async cleanupFailedGitSession(session: AutonomySession): Promise<void> {
    if (session.gitMode !== "auto_branch_commit") return;
    if (!session.branchName || !session.baseBranch) return;
    if (session.commitHash) return;

    try {
      const result = await this.gitManager.cleanupFailedSessionBranch(
        session.branchName,
        session.baseBranch,
      );
      this.emit("log", session, {
        message: result.cleaned
          ? `Cleaned failed session branch ${session.branchName}`
          : `Skipped failed session branch cleanup: ${result.reason}`,
      });
    } catch (error) {
      this.emit("log", session, {
        message: `Failed to cleanup session branch ${session.branchName}: ${this.errorToMessage(error)}`,
      });
    }
  }

  private normalizeBudgetLimits(request: CreateAutonomySessionRequest): BudgetLimits {
    const fromPayload = request.budgets ?? {};
    const maxCycles = Math.max(
      1,
      Math.floor((fromPayload?.maxCycles ?? request.maxCycles ?? DEFAULT_MAX_CYCLES) as number),
    );
    const maxDurationMs = Math.max(
      60_000,
      Math.floor(fromPayload.maxDurationMs ?? request.maxDurationMs ?? DEFAULT_MAX_DURATION_MS),
    );
    const maxInputTokens = Math.max(
      1_000,
      Math.floor(fromPayload.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS),
    );
    const maxOutputTokens = Math.max(
      1_000,
      Math.floor(fromPayload.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
    );
    const maxTPM = Math.max(1_000, Math.floor(fromPayload.maxTPM ?? DEFAULT_MAX_TPM));
    const maxRPD = Math.max(1, Math.floor(fromPayload.maxRPD ?? DEFAULT_MAX_RPD));
    const maxUsd =
      typeof fromPayload.maxUsd === "number" ? Math.max(0, fromPayload.maxUsd) : 0;

    return {
      maxCycles,
      maxDurationMs,
      maxInputTokens,
      maxOutputTokens,
      maxTPM,
      maxRPD,
      maxUsd,
    };
  }


  private activateFixCycleTasks(session: AutonomySession): void {
    taskGraphManager.activateFixCycle(session.taskGraph);
  }

  private inferModelSwitchReason(message: string): ModelSwitchReason {
    const normalized = message.toLowerCase();
    if (normalized.includes("429") || normalized.includes("rate limit")) {
      return "RATE_LIMIT";
    }
    if (normalized.includes("timeout") || normalized.includes("timed out")) {
      return "TIMEOUT";
    }
    if (normalized.includes("format") || normalized.includes("schema")) {
      return "FORMAT_ERROR";
    }
    if (normalized.includes("budget")) {
      return "BUDGET_EXCEEDED";
    }
    return "QUALITY_FAIL_RECOVERY";
  }

  private isImmediateFailExecutionError(message: string): boolean {
    const normalized = message.toLowerCase();
    const oomPatterns = [
      /javascript heap out of memory/,
      /allocation failed - javascript heap out of memory/,
      /fatal error: reached heap limit/,
      /\bheap out of memory\b/,
      /\bout of memory\b/,
      /\benomem\b/,
      /memory limit exceeded/,
    ];
    return oomPatterns.some((pattern) => pattern.test(normalized));
  }


  private errorToMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private operationId(session: AutonomySession, task: TaskNode): string {
    return `${session.id}:${task.type}:${session.cycleCount}`;
  }

  private async loadOpLog(session: AutonomySession): Promise<void> {
    return this.persistence.loadOpLog(session);
  }

  private async appendOpLog(session: AutonomySession, entry: SessionOpLogEntry): Promise<void> {
    return this.persistence.appendOpLog(session, entry);
  }

  private async initializeSkills(): Promise<void> {
    await this.skillEngine.initialize();
    gearEngine.setSkillEngine(this.skillEngine);
  }


  private buildContextPack(session: AutonomySession): string {
    const latestModel = session.modelHistory.length
      ? session.modelHistory[session.modelHistory.length - 1]!.selectedModel
      : session.anchorModel;

    // Use tactical summary from GearEngine (Phase 1.3)
    const historySummary = gearEngine.squeezeHistory(session);

    return JSON.stringify({
      objective: session.objective,
      latestModel,
      cycle: session.cycleCount,
      scope: session.scope.paths,
      lastPlan: session.artifacts.plan,
      lastSummary: session.artifacts.changeSummary,
      tacticalHistory: historySummary,
    });
  }

  private async checkInterrupts(session: AutonomySession, skipBudget = false): Promise<boolean> {
    if (session.state === "stopped" || session.state === "failed") return true;

    if (await this.applyStopIfRequested(session)) return true;
    if (this.isWallClockTimeout(session)) {
      this.failSession(
        session,
        `Session wall-clock timeout reached (${Math.round(session.maxDurationMs / 60000)} minutes)`,
      );
      return true;
    }
    
    // Phase 4A: Zombie Session Protection
    const now = Date.now();
    const lastProgress = Date.parse(session.lastProgressAt);
    const progressQuietMs = now - lastProgress;
    const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of no state change
    
    if (progressQuietMs > HEARTBEAT_TIMEOUT_MS && session.state !== "paused") {
      this.failSession(session, `Zombie session detected: no progress for ${Math.round(progressQuietMs / 60000)} minutes`);
      return true;
    }

    if (!skipBudget && this.budgetTracker.checkExceeded(session)) {
      this.failSession(
        session,
        session.budgets.exceedReason ?? "Budget exceeded",
      );
      return true;
    }

    // Phase 4C: Predictive Budget Warning & Gear Downshift Check
    if (!skipBudget) {
      const warningReason = this.budgetTracker.checkWarning(session);
      if (warningReason) {
        this.emit("log", session, { 
          message: `Budget warning detected: ${warningReason}. Adaptive gear scaling triggered.`,
          severity: "warning" 
        });
      }
    }

    return false;
  }

  private async prepareCycle(
    session: AutonomySession,
    task: TaskNode,
    nextSwitchReason: ModelSwitchReason,
    recoverToAnchorPending: boolean,
  ): Promise<ModelDecision> {
    await this.transition(session, "plan", task, `Planning ${task.type} task`);

    const modelDecision = this.modelRouter.decide({
      taskType: task.type,
      anchorModel: session.anchorModel,
      previousModel:
        session.modelHistory.length > 0
          ? session.modelHistory[session.modelHistory.length - 1]!.selectedModel
          : null,
      reasonCode: nextSwitchReason,
      policy: session.modelPolicy,
      recoverToAnchor: recoverToAnchorPending && nextSwitchReason === "ROUTER_POLICY",
      contextPack: session.artifacts.contextPack,
      history: session.modelHistory,
    });

    session.modelHistory.push(modelDecision);
    session.currentModel = modelDecision.selectedModel;
    
    // Phase 4C: Adaptive Gear Scaling (BUG-3 / ISSUE-8)
    let gear = this.deriveGear(modelDecision.selectedModel);
    if (session.budgets.warning && gear !== "fast") {
      const downshifted = gearEngine.scaleGear(gear!, "down");
      this.emit("log", session, { 
        message: `Adaptive Gear Scaling: Downshifting from ${gear} to ${downshifted} due to budget pressure.`,
        severity: "info"
      });
      gear = downshifted;
    }
    session.currentGear = gear;

    this.emit("model_switch", session, {
      selectedModel: modelDecision.selectedModel,
      previousModel: modelDecision.previousModel,
      reasonCode: modelDecision.reasonCode,
      taskId: task.id,
    });

    session.artifacts.plan = this.buildPlanArtifact(session, task, modelDecision);
    session.artifacts.contextPack = this.buildContextPack(session);
    this.emit("artifact", session, {
      type: "plan",
      value: session.artifacts.plan,
    });
    this.emit("artifact", session, {
      type: "context_pack",
      value: session.artifacts.contextPack,
    });

    const confidence = this.calculateConfidence(session, modelDecision);
    const strategy = this.inferStrategy(modelDecision.reasonCode);
    
    this.emit("decision_log", session, {
      strategy,
      confidence,
      reason: `Selected ${modelDecision.selectedModel} due to ${modelDecision.reasonCode} policy.`,
      taskId: task.id,
      cycle: session.cycleCount
    });

    return modelDecision;
  }

  private async awaitPlanReviewDecision(
    session: AutonomySession,
    task: TaskNode,
  ): Promise<"continue" | "stopped" | "failed"> {
    if (!session.reviewAfterPlan || session.reviewStatus === "approved") {
      return "continue";
    }

    session.reviewStatus = "plan_pending";
    session.reviewUpdatedAt = new Date().toISOString();
    this.transition(session, "paused", task, "Awaiting plan approval");
    this.emit("log", session, {
      message: "Plan review checkpoint is waiting for approval.",
      reviewStatus: session.reviewStatus,
    });

    while (true) {
      const stopReason = this.stopRequests.get(session.id);
      if (stopReason) {
        this.stopRequests.delete(session.id);
        session.reviewStatus = "rejected";
        session.reviewUpdatedAt = new Date().toISOString();
        session.stopReason = stopReason;
        await this.transition(session, "stopped", null, stopReason);
        this.emit("stopped", session, { reason: stopReason });
        return "stopped";
      }

      const resumeReason = this.resumeRequests.get(session.id);
      if (resumeReason) {
        this.resumeRequests.delete(session.id);
        session.reviewStatus = "approved";
        session.reviewUpdatedAt = new Date().toISOString();
        this.emit("log", session, {
          message: resumeReason,
          reviewStatus: session.reviewStatus,
        });
        return "continue";
      }

      if (this.isWallClockTimeout(session)) {
        await this.failSession(
          session,
          `Session wall-clock timeout reached while awaiting plan approval (${Math.round(session.maxDurationMs / 60000)} minutes)`,
        );
        return "failed";
      }

      await sleep(PAUSE_POLL_INTERVAL_MS);
    }
  }

  private calculateConfidence(session: AutonomySession, decision: ModelDecision): number {
    let score = 0.95; // Base confidence

    // Penalty for retries/errors
    if (decision.reasonCode === "RATE_LIMIT" || decision.reasonCode === "TIMEOUT") {
      score -= 0.3;
    } else if (decision.reasonCode === "QUALITY_FAIL_RECOVERY") {
      score -= 0.45;
    } else if (decision.reasonCode === "FORMAT_ERROR") {
      score -= 0.25;
    }

    // Penalty for high budget usage (> 80%)
    const budgets = session.budgets;
    const usagePercent = Math.max(
      budgets.usage.cyclesUsed / budgets.limits.maxCycles,
      budgets.usage.currentTPM / budgets.limits.maxTPM,
      budgets.usage.requestsUsed / budgets.limits.maxRPD
    );
    if (usagePercent > 0.8) {
      score -= 0.2;
    }

    // Penalty for consecutive gate failures
    score -= (session.consecutiveGateFailures * 0.15);

    return Math.max(0.1, Math.min(1.0, score));
  }

  private inferStrategy(reason: ModelSwitchReason): string {
    switch (reason) {
      case "INITIAL":
      case "ROUTER_POLICY":
        return "OPTIMAL";
      case "QUALITY_FAIL_RECOVERY":
        return "RECOVERY";
      case "RATE_LIMIT":
      case "TIMEOUT":
        return "FALLBACK";
      case "BUDGET_EXCEEDED":
        return "CRITICAL";
      default:
        return "ADAPTIVE";
    }
  }

  private async executeCycle(
    session: AutonomySession,
    task: TaskNode,
    modelDecision: ModelDecision,
  ): Promise<{ success: boolean; result?: AutonomousTaskExecutionResult; nextSwitchReason?: ModelSwitchReason }> {
    this.transition(session, "execute", task, `Executing ${task.type}`);
    task.status = "in_progress";
    task.attempts += 1;
    task.updatedAt = new Date().toISOString();
    
    await this.appendOpLog(session, {
      operationId: this.operationId(session, task),
      cycle: session.cycleCount,
      taskType: task.type,
      status: "started",
      summary: `Executing ${task.type}`,
      touchedFiles: [],
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await this.taskExecutor({
        session: structuredClone(session),
        task: structuredClone(task),
        modelDecision,
        cycle: session.cycleCount,
        isInterrupted: () => this.stopRequests.has(session.id) || session.state === "stopped"
      });

      const touched = normalizeTouchedFiles(result.touchedFiles ?? []);
      session.touchedFiles = [...new Set([...session.touchedFiles, ...touched])];
      session.artifacts.changeSummary = result.summary;
      if (result.contextPack && result.contextPack.trim().length > 0) {
        session.artifacts.contextPack = result.contextPack;
      }
      
      if (result.usageAccounting) {
        this.budgetTracker.applyExecutionUsage(session, result.usageAccounting);
      } else if (
        typeof result.inputTokens === "number" ||
        typeof result.outputTokens === "number" ||
        typeof result.estimatedUsd === "number"
      ) {
        this.budgetTracker.consume(
          session,
          Math.max(0, Math.floor(result.inputTokens ?? 0)),
          Math.max(0, Math.floor(result.outputTokens ?? 0)),
          Math.max(0, result.estimatedUsd ?? 0),
        );
      }
      const warningReason = this.budgetTracker.checkWarning(session);
      const exceeded = this.budgetTracker.checkExceeded(session);

      this.emit("artifact", session, { type: "changeSummary", value: session.artifacts.changeSummary });
      this.emit("budget", session, {
        limits: session.budgets.limits,
        usage: session.budgets.usage,
        warning: warningReason !== null,
        warningReason,
        exceeded,
        exceedReason: session.budgets.exceedReason,
        tokenVelocity: this.budgetTracker.getTokenVelocity(),
      });

      if (touched.length > 0) {
        this.emit("diff_ready", session, { files: touched, taskId: task.id });
      }

      await this.appendOpLog(session, {
        operationId: this.operationId(session, task),
        cycle: session.cycleCount,
        taskType: task.type,
        status: "completed",
        summary: result.summary,
        touchedFiles: touched,
        timestamp: new Date().toISOString(),
      });
      this.emit("gear_completed", session, {
        taskId: task.id,
        selectedModel: modelDecision.selectedModel,
        gear: session.currentGear,
        summary: result.summary,
      });

      return {
        success: true,
        result,
        nextSwitchReason: warningReason ? "BUDGET_EXCEEDED" : undefined,
      };
    } catch (error) {
      if (error instanceof BudgetReservationError) {
        this.budgetTracker.applyExecutionUsage(session, {
          inputTokens: 0,
          outputTokens: 0,
          estimatedUsd: 0,
          cachedInputTokens: error.usage.cachedInputTokensUsed,
          usage: error.usage,
        });
        this.budgetTracker.checkWarning(session);
        this.budgetTracker.checkExceeded(session);
      }

      const message = this.errorToMessage(error);
      const isImmediateFail = this.isImmediateFailExecutionError(message);
      await this.appendOpLog(session, {
        operationId: this.operationId(session, task),
        cycle: session.cycleCount,
        taskType: task.type,
        status: "failed",
        summary: message,
        touchedFiles: [],
        timestamp: new Date().toISOString(),
      });
      task.lastError = message;
      task.status = isImmediateFail || task.attempts >= task.maxAttempts ? "failed" : "pending";
      session.artifacts.changeSummary = `Task execution failed: ${message}`;
      session.artifacts.nextActionReason = isImmediateFail
        ? "Execution halted due to unrecoverable runtime fault"
        : "Execution failed, retrying with recovery model";
      
      const nextSwitchReason = this.inferModelSwitchReason(message);
      
      // Phase 4B: Trip the circuit for the failing model
      SmartMultiModelRouter.recordFailure(modelDecision.selectedModel, session.id);

      this.emit("gear_failed", session, {
        taskId: task.id,
        selectedModel: modelDecision.selectedModel,
        gear: session.currentGear,
        error: message,
        nextSwitchReason,
      });

      if (isImmediateFail) {
        await this.failSession(session, `Task ${task.type} failed with unrecoverable runtime error: ${message}`);
        return { success: false };
      }

      await this.transition(session, "retry", task, message);
      
      if (task.status === "failed") {
        await this.failSession(session, `Task ${task.type} exhausted retry budget: ${message}`);
      }
      
      return { success: false, nextSwitchReason };
    }
  }

  private async verifyCycle(session: AutonomySession, task: TaskNode): Promise<GateResult> {
    const isNoFileTask = ["analysis", "finalize"].includes(task.type);
    const hasNoChanges = !session.touchedFiles || session.touchedFiles.length === 0;

    if (isNoFileTask || hasNoChanges) {
      await this.transition(session, "verify", task, `Bypassing quality gates for ${task.type} (No files changed)`);
      const bypassResult = {
        passed: true,
        strictMode: true,
        blockingIssues: [],
        auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
        impactedScopes: [],
        commands: [],
        timestamp: new Date().toISOString()
      };
      session.artifacts.gateResult = bypassResult;
      this.emit("gate_bypass", session, {
        taskId: task.id,
        reasonCode: isNoFileTask ? "TASK_TYPE_BYPASS" : "NO_FILES_CHANGED",
        passed: true,
        blockingIssues: [],
        impactedScopes: [],
        audit: bypassResult.auditSummary,
        auditSummary: bypassResult.auditSummary,
      });
      return bypassResult;
    }

    await this.transition(session, "verify", task, "Running modular quality gates");
    const client = this.options.clientResolver 
      ? await this.options.clientResolver(session) 
      : this.options.client;

    const gateResult = await this.gateEngine.run({
      sessionId: session.id,
      projectRoot: this.options.projectRoot,
      touchedFiles: session.touchedFiles,
      scopePaths: session.scope.paths,
      client,
    });
    session.artifacts.gateResult = gateResult;
    this.emit("gate_result", session, {
      passed: gateResult.passed,
      blockingIssues: gateResult.blockingIssues,
      impactedScopes: gateResult.impactedScopes,
      audit: gateResult.auditSummary,
    });
    return gateResult;
  }

  private async reflectOnCycle(
    session: AutonomySession,
    task: TaskNode,
    gateResult: any,
    executionResult: any,
  ): Promise<{ passed: boolean; nextSwitchReason?: ModelSwitchReason; nextActionReason?: string }> {
    if (!gateResult.passed) {
      this.activateFixCycleTasks(session);
      this.emit("log", session, {
        message: `Gate failure (Consecutive: ${session.consecutiveGateFailures + 1}). Fix cycle tasks activated.`,
        severity: "error",
      });
      session.consecutiveGateFailures += 1;
      task.lastError = gateResult.blockingIssues[0] ?? "Quality gate failed";
      task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
      
      // Phase 4C: Failure Recovery Matrix
      let recoveryGear: GearLevel = "standard";
      const issuesLower = gateResult.blockingIssues.join(" ").toLowerCase();
      
      if (issuesLower.includes("lint") || issuesLower.includes("type-check")) {
        recoveryGear = "fast"; // Refactor cycle for cosmetic/static errors
      } else if (issuesLower.includes("build") || issuesLower.includes("command failed")) {
        recoveryGear = "standard"; // Implementation retry for logic errors
      } else if (issuesLower.includes("test")) {
        recoveryGear = "elite"; // Test-fix cycle for functional errors
      }
      
      session.currentGear = recoveryGear;
      this.activateFixCycleTasks(session);
      
      const nextActionReason = `Gate failed (${recoveryGear} gear recovery). Issues: ${gateResult.blockingIssues.join("; ")}`;
      await this.transition(
        session,
        "retry",
        task,
        `Gate fail ${session.consecutiveGateFailures}/3: ${gateResult.blockingIssues[0]}`,
      );

      if (session.consecutiveGateFailures >= 3) {
        this.failSession(session, `Gate failed three consecutive cycles: ${gateResult.blockingIssues.join("; ")}`);
        return { passed: false };
      }
      if (task.status === "failed") {
        this.failSession(session, `Task ${task.type} exhausted retry budget after gate failures`);
        return { passed: false };
      }
      
      return { passed: false, nextSwitchReason: "QUALITY_FAIL_RECOVERY", nextActionReason };
    }

    session.consecutiveGateFailures = 0;
    task.status = "completed";
    task.lastError = undefined;
    task.updatedAt = new Date().toISOString();
    
    return { 
      passed: true, 
      nextActionReason: executionResult.nextActionReason ?? this.defaultNextActionReason(session, task.type) 
    };
  }

  private async finalizeCycle(session: AutonomySession, task: TaskNode, nextActionReason?: string): Promise<void> {
    if (nextActionReason) {
      session.artifacts.nextActionReason = nextActionReason;
    }

    if (task.type === "analysis") {
      taskGraphManager.setTaskStatus(session.taskGraph, "implementation", "pending");
    }
    if (task.type === "implementation" || task.type === "test-fix") {
      taskGraphManager.setTaskStatus(session.taskGraph, "verification", "pending");
    }
    if (task.type === "verification") {
      taskGraphManager.setTaskStatus(session.taskGraph, "finalize", "pending");
    }
    if (task.type === "finalize") {
      await this.completeSession(session);
    }
  }

  private isWallClockTimeout(session: AutonomySession): boolean {
    const started = Date.parse(session.createdAt);
    if (!Number.isFinite(started)) return false;
    return Date.now() - started >= session.maxDurationMs;
  }

  private async applyStopIfRequested(session: AutonomySession): Promise<boolean> {
    const stopReason = this.stopRequests.get(session.id);
    if (stopReason) {
      this.stopRequests.delete(session.id);
      this.budgetTracker.detachSession(session);
      session.stopReason = stopReason;
      await this.transition(session, "stopped", null, stopReason);
      this.emit("stopped", session, { reason: stopReason });
      return true;
    }
    return false;
  }

  private deriveGear(model: string | null): GearLevel | null {
    if (!model) return null;
    const normalized = model.toLowerCase();
    
    // Base derivation logic
    if (normalized.includes("flash") || normalized.includes("8b") || normalized.includes("mini")) return "fast";
    if (normalized.includes("opus") || normalized.includes("thinking") || normalized.includes("pro") || normalized.includes("elite")) {
      return "elite";
    }
    return "standard";
  }

  private buildSelectedSessionSummary(session: AutonomySession): AutonomySessionSummaryPayload {
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
}

function createSessionId(): string {
  const date = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = crypto.randomBytes(3).toString("hex");
  return `aut_${date}_${random}`;
}

function normalizeSinglePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
