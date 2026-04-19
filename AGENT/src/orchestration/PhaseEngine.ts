import type { 
  AutonomyState, 
  AutonomySession, 
  TaskNode 
} from "./autonomy-types";

/**
 * PhaseEngine: The state machine controller for autonomous mission phases.
 * 
 * It ensures that transitions between autonomy states (plan -> execute -> verify etc.)
 * follow strict business rules and that required data is present before moving forward.
 */
export class PhaseEngine {
  /**
   * Deterministic transition precedence resolver.
   * If a pause request is pending while a mission is about to complete, pause wins.
   */
  public static resolveTransition(
    currentState: AutonomyState,
    nextState: AutonomyState,
    options?: { pauseRequested?: boolean },
  ): AutonomyState {
    if (
      options?.pauseRequested &&
      nextState === "done" &&
      (currentState === "verify" || currentState === "reflect")
    ) {
      return "paused";
    }
    return nextState;
  }

  /**
   * Defines allowed transitions from a given state.
   */
  private static readonly ALLOWED_TRANSITIONS: Record<AutonomyState, AutonomyState[]> = {
    "queued": ["init", "stopped"],
    "init": ["plan", "failed", "stopped", "paused", "init"],
    "plan": ["execute", "plan", "failed", "stopped", "paused"],
    "execute": ["verify", "retry", "failed", "stopped", "paused", "plan", "execute"],
    "verify": ["reflect", "failed", "stopped", "paused", "plan", "retry", "done", "verify"],
    "reflect": ["plan", "retry", "done", "failed", "stopped", "paused", "reflect"],
    "retry": ["plan", "execute", "failed", "stopped", "paused", "retry"],
    "paused": ["plan", "execute", "verify", "reflect", "retry", "stopped", "paused"],
    "done": ["plan", "failed", "done"],
    "failed": ["plan", "retry", "failed"],
    "stopped": ["plan", "init", "stopped"]
  };

  /**
   * Validates if a transition from currentState to nextState is permitted.
   */
  public static canTransition(currentState: AutonomyState, nextState: AutonomyState): boolean {
    const allowed = this.ALLOWED_TRANSITIONS[currentState];
    return allowed.includes(nextState);
  }

  /**
   * Enforces transition guards and business logic checks.
   * Throws an error if the transition is illegal or missing requirements.
   */
  public validateTransition(
    session: AutonomySession, 
    nextState: AutonomyState, 
    task: TaskNode | null,
    options?: { pauseRequested?: boolean },
  ): AutonomyState {
    const currentState = session.state;
    const resolvedNextState = PhaseEngine.resolveTransition(currentState, nextState, options);

    // 1. Basic transition check
    if (!PhaseEngine.canTransition(currentState, resolvedNextState)) {
      throw new Error(`Illegal transition: ${currentState} -> ${resolvedNextState}`);
    }

    // 2. State-specific guards
    switch (resolvedNextState) {
      case "execute":
        if (!task) throw new Error("Transition to 'execute' requires an active task.");
        if (task.status !== "pending" && task.status !== "in_progress") {
          throw new Error(`Cannot execute task in status: ${task.status}`);
        }
        break;

      case "verify":
        if (session.touchedFiles.length === 0) {
          const noFileVerifyTask =
            task?.type === "analysis" ||
            task?.type === "finalize";
          if (!noFileVerifyTask && process.env.LOJINEXT_WARN_VERIFY_NO_TOUCHED === "1") {
            // Opt-in warning for debugging unexpected verify transitions with no file changes.
            console.warn(`[PhaseEngine] Transitioning to 'verify' without touched files in session ${session.id}`);
          }
        }
        break;

      case "done":
        if (session.taskGraph.some(t => t.status === "pending" || t.status === "in_progress")) {
          throw new Error("Cannot complete mission while tasks are still pending/in-progress.");
        }
        break;
      
      case "failed":
        if (!session.error) {
          throw new Error("Transition to 'failed' requires an error message in session.");
        }
        break;
    }

    return resolvedNextState;
  }

  /**
   * Determines the next likely state based on task outcome and session history.
   * (Used for automated loop steering in later phases).
   */
  public getNextAction(session: AutonomySession): AutonomyState {
    // Basic heuristics for now
    if (session.error) return "failed";
    if (session.consecutiveGateFailures >= 3) return "failed";
    
    const pendingTasks = session.taskGraph.filter(t => t.status === "pending");
    if (pendingTasks.length === 0) return "done";

    return "plan"; // Default to next planning cycle
  }
}

export const phaseEngine = new PhaseEngine();
