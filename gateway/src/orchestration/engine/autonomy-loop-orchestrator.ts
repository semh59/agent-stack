import type { 
  AutonomySession, 
  TaskNode, 
  AutonomyEvent, 
  ModelSwitchReason,
  ModelDecision
} from "../autonomy-types";
import type { AutonomySessionManager } from "./autonomy-session-manager";
import type { AutonomyCycleRunner } from "./autonomy-cycle-runner";
import type { AutonomyInterruptHandler } from "./autonomy-interrupt-handler";
import type { AutonomyGitOrchestrator } from "./autonomy-git-orchestrator";
import type { SkillEngine } from "../SkillEngine";
import type { BudgetTracker } from "../BudgetTracker";
import { taskGraphManager } from "../TaskGraphManager";

interface OrchestratorOptions {
  sessionManager: AutonomySessionManager;
  cycleRunner: AutonomyCycleRunner;
  interruptHandler: AutonomyInterruptHandler;
  gitOrchestrator: AutonomyGitOrchestrator;
  skillEngine: SkillEngine;
  budgetTracker: BudgetTracker;
  projectRoot: string;
  emit: (type: AutonomyEvent["type"], session: AutonomySession, payload: Record<string, unknown>) => void;
  onSessionComplete: (session: AutonomySession) => Promise<void>;
}

export class AutonomyLoopOrchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  public async runSession(sessionId: string, isRunning: (id: string) => boolean, setRunning: (id: string, active: boolean) => void): Promise<AutonomySession> {
    let session = this.options.sessionManager.getSession(sessionId);
    if (!session) {
      await this.options.sessionManager.hydrateFromDisk();
      session = this.options.sessionManager.getSession(sessionId);
    }
    if (!session) throw new Error(`Autonomy session not found: ${sessionId}`);
    
    if (isRunning(sessionId)) return session;

    setRunning(sessionId, true);
    process.stderr.write(`[AUTONOMY] Starting session ${sessionId} loop via Orchestrator.\n`);
    
    try {
      if (session.state === "queued") {
        session.queuePosition = null;
        await this.options.sessionManager.transition(session, "init", null, "Dequeued and starting");
      }
      
      await this.options.sessionManager.loadOpLog(session);
      await this.options.skillEngine.initialize();
      await this.options.gitOrchestrator.prepareGit(session, (msg) => this.options.emit("log", session!, { message: msg }));

      let nextSwitchReason: ModelSwitchReason = "INITIAL";
      let recoverToAnchorPending = false;

      while (session.cycleCount < session.maxCycles) {
        if (await this.options.interruptHandler.checkInterrupts(session)) break;
        
        if (await this.options.interruptHandler.applyPauseIfRequested(session, async () => {
             // Logic for re-validating state can be added here if needed
        })) continue;

        const task = taskGraphManager.findNextTask(session.taskGraph);
        if (!task) {
          if (await this.options.interruptHandler.checkInterrupts(session)) break;
          await this.options.onSessionComplete(session);
          break;
        }

        if (taskGraphManager.wasTaskCompleted(session.taskGraph, task.type)) {
          task.status = "completed";
          task.updatedAt = new Date().toISOString();
          continue;
        }

        session.cycleCount += 1;
        const modelDecision = await this.options.cycleRunner.prepareCycle(session, task, nextSwitchReason, recoverToAnchorPending);
        
        session.artifacts.plan = this.buildPlanArtifact(session, task, modelDecision);
        this.options.emit("artifact", session, { type: "plan", value: session.artifacts.plan });

        const reviewDecision = await this.options.interruptHandler.awaitPlanReviewDecision(session, task);
        if (reviewDecision !== "continue") break;

        const executionResult = await this.options.cycleRunner.executeCycle(session, task, modelDecision, () => this.options.interruptHandler.isStopRequested(session.id), this.options.budgetTracker);
        if (executionResult.success) {
          taskGraphManager.completeTask(session.taskGraph, task.type);
        }
        
        if (await this.options.interruptHandler.checkInterrupts(session, true)) break;
        if (!executionResult.success) {
          nextSwitchReason = executionResult.nextSwitchReason!;
          recoverToAnchorPending = true;
          if (session.state === "failed") break;
          continue;
        }

        const gateResult = await this.options.cycleRunner.verifyCycle(session, task, this.options.projectRoot);
        const reflection = await this.options.cycleRunner.reflectOnCycle(session, task, gateResult, executionResult.result!);
        if (await this.options.interruptHandler.checkInterrupts(session)) break;

        if (!reflection.passed) {
          nextSwitchReason = reflection.nextSwitchReason!;
          recoverToAnchorPending = true;
          if (session.state === "failed") break;
          continue;
        }

        // Logic for finalizeCycle is handled in completeSession/finalizeCycle in the main Engine or we can move it here.
        // For parity, let's keep it consistent.
        await this.finalizeTask(session, task, reflection.nextActionReason);
        
        nextSwitchReason = executionResult.nextSwitchReason ?? "ROUTER_POLICY";
        recoverToAnchorPending = executionResult.nextSwitchReason === undefined && modelDecision.selectedModel !== modelDecision.anchorModel;
        
        if (await this.options.interruptHandler.checkInterrupts(session)) break; 
        if (session.state === "done") break;
      }

      if (!["done", "failed", "stopped"].includes(session.state)) {
        await this.options.sessionManager.failSession(session, `Cycles budget exhausted (${session.maxCycles})`);
      }

      return session;
    } catch (err: unknown) {
      const error = err as Error;
      if (!["failed", "stopped"].includes(session!.state)) {
        await this.options.sessionManager.failSession(session!, error.message);
      }
      return session!;
    } finally {
      if (session!.state === "failed") {
        await this.options.gitOrchestrator.cleanupFailedSessionBranch(session!).catch(() => {});
      }
      setRunning(sessionId, false);
    }
  }

  private async finalizeTask(session: AutonomySession, task: TaskNode, nextActionReason?: string): Promise<void> {
    if (nextActionReason) session.artifacts.nextActionReason = nextActionReason;
    if (task.type === "analysis") taskGraphManager.setTaskStatus(session.taskGraph, "implementation", "pending");
    if (task.type === "implementation" || task.type === "test-fix") taskGraphManager.setTaskStatus(session.taskGraph, "verification", "pending");
    if (task.type === "verification") taskGraphManager.setTaskStatus(session.taskGraph, "finalize", "pending");
    if (task.type === "finalize") {
        if (await this.options.interruptHandler.applyStopIfRequested(session)) return;
        await this.options.onSessionComplete(session).catch(err => {
          process.stderr.write(`[ORCHESTRATOR] Error during onSessionComplete for ${session.id}: ${err.message}\n`);
          this.options.sessionManager.failSession(session, `Session finalization failed: ${err.message}`);
        });
    }
  }

  private buildPlanArtifact(session: AutonomySession, task: TaskNode, modelDecision: ModelDecision): string {
    return `# Plan: ${task.type}\n## Current Model\n${modelDecision.selectedModel}\n\n## Objective\n${session.objective}\n\n## Gear\n${session.currentGear}\n`;
  }
}
