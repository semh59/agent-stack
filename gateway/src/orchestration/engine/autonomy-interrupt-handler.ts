import type { AutonomySession, AutonomyEvent, TaskNode } from "../autonomy-types";
import { LoopGuard } from "../LoopGuard";
import type { AutonomySessionManager } from "./autonomy-session-manager";
import type { BudgetTracker } from "../BudgetTracker";

interface InterruptHandlerOptions {
  sessionManager: AutonomySessionManager;
  budgetTracker: BudgetTracker;
  emit: (type: AutonomyEvent["type"], session: AutonomySession, payload: Record<string, unknown>) => void;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PAUSE_POLL_INTERVAL_MS = 100;

export class AutonomyInterruptHandler {
  private readonly stopRequests = new Map<string, string>();
  private readonly pauseRequests = new Map<string, string>();
  private readonly resumeRequests = new Map<string, string>();

  constructor(private readonly options: InterruptHandlerOptions) {}

  public stop(sessionId: string, reason = "Stopped by user"): boolean {
    this.stopRequests.set(sessionId, reason);
    return true;
  }

  public isStopRequested(sessionId: string): boolean {
    return this.stopRequests.has(sessionId);
  }

  public pause(sessionId: string, reason = "Paused by user"): boolean {
    this.pauseRequests.set(sessionId, reason);
    return true;
  }

  public resume(sessionId: string, reason = "Resumed by user"): boolean {
    this.resumeRequests.set(sessionId, reason);
    return true;
  }

  public async checkInterrupts(session: AutonomySession, skipBudget = false): Promise<boolean> {
    if (session.state === "stopped" || session.state === "failed") return true;

    if (await this.applyStopIfRequested(session)) return true;
    
    if (this.isWallClockTimeout(session)) {
      await this.options.sessionManager.failSession(
        session,
        `Session wall-clock timeout reached (${Math.round(session.maxDurationMs / 60000)} minutes)`,
      );
      return true;
    }
    
    const now = Date.now();
    const lastProgress = Date.parse(session.lastProgressAt);
    const progressQuietMs = now - lastProgress;
    const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
    
    if (progressQuietMs > HEARTBEAT_TIMEOUT_MS && session.state !== "paused") {
      await this.options.sessionManager.failSession(session, `Zombie session detected: no progress for ${Math.round(progressQuietMs / 60000)} minutes`);
      return true;
    }

    if (!skipBudget && this.options.budgetTracker.checkExceeded(session)) {
       await this.options.sessionManager.failSession(session, session.budgets.exceedReason ?? "Budget exceeded");
       return true;
    }

    return false;
  }

  public async applyStopIfRequested(session: AutonomySession): Promise<boolean> {
    const stopReason = this.stopRequests.get(session.id);
    if (stopReason) {
      this.stopRequests.delete(session.id);
      session.stopReason = stopReason;
      await this.options.sessionManager.transition(session, "stopped", null, stopReason);
      this.options.emit("stopped", session, { reason: stopReason });
      return true;
    }
    return false;
  }

  public async applyPauseIfRequested(session: AutonomySession, revalidateCallback: () => Promise<void>): Promise<boolean> {
    const pauseReason = this.pauseRequests.get(session.id);
    if (!pauseReason) return false;

    this.pauseRequests.delete(session.id);
    await this.options.sessionManager.transition(session, "paused", null, pauseReason);
    this.options.emit("log", session, { reason: pauseReason, paused: true });

    const guard = new LoopGuard("PausePolling", 10000, 600000);
    while (guard.tick()) {
      if (await this.applyStopIfRequested(session)) return true;
      const resumeReason = this.resumeRequests.get(session.id);
      if (resumeReason) {
        this.resumeRequests.delete(session.id);
        await revalidateCallback();
        await this.options.sessionManager.transition(session, "retry", null, resumeReason);
        return true;
      }
      if (this.isWallClockTimeout(session)) {
        await this.options.sessionManager.failSession(
          session,
          `Session wall-clock timeout reached while paused (${Math.round(session.maxDurationMs / 60000)} minutes)`,
        );
        return true;
      }
      await sleep(PAUSE_POLL_INTERVAL_MS);
    }
    await this.options.sessionManager.failSession(session, `Pause polling exceeded guard budget for session ${session.id}`);
    return true;
  }

  public async awaitPlanReviewDecision(
    session: AutonomySession,
    task: TaskNode,
  ): Promise<"continue" | "stopped" | "failed"> {
    if (!session.reviewAfterPlan || session.reviewStatus === "approved") {
      return "continue";
    }

    session.reviewStatus = "plan_pending";
    session.reviewUpdatedAt = new Date().toISOString();
    await this.options.sessionManager.transition(session, "paused", task, "Awaiting plan approval");
    this.options.emit("log", session, {
      message: "Plan review checkpoint is waiting for approval.",
      reviewStatus: session.reviewStatus,
    });

    const reviewGuard = new LoopGuard("ReviewPolling", 10000, 600000);
    while (reviewGuard.tick()) {
      const stopReason = this.stopRequests.get(session.id);
      if (stopReason) {
        this.stopRequests.delete(session.id);
        session.reviewStatus = "rejected";
        session.reviewUpdatedAt = new Date().toISOString();
        session.stopReason = stopReason;
        await this.options.sessionManager.transition(session, "stopped", null, stopReason);
        this.options.emit("stopped", session, { reason: stopReason });
        return "stopped";
      }

      const resumeReason = this.resumeRequests.get(session.id);
      if (resumeReason) {
        this.resumeRequests.delete(session.id);
        session.reviewStatus = "approved";
        session.reviewUpdatedAt = new Date().toISOString();
        this.options.emit("log", session, {
          message: resumeReason,
          reviewStatus: session.reviewStatus,
        });
        return "continue";
      }

      if (this.isWallClockTimeout(session)) {
        await this.options.sessionManager.failSession(
          session,
          `Session wall-clock timeout reached while awaiting plan approval (${Math.round(session.maxDurationMs / 60000)} minutes)`,
        );
        return "failed";
      }

      await sleep(PAUSE_POLL_INTERVAL_MS);
    }
    
    await this.options.sessionManager.failSession(session, `Review polling exceeded guard budget for session ${session.id}`);
    return "failed";
  }

  private isWallClockTimeout(session: AutonomySession): boolean {
    const started = Date.parse(session.createdAt);
    if (!Number.isFinite(started)) return false;
    return Date.now() - started >= session.maxDurationMs;
  }
}
