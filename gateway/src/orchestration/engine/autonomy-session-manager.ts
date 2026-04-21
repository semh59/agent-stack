import type { 
  AutonomySession, 
  AutonomyState, 
  TaskNode,
  AutonomyEvent
} from "../autonomy-types";
import { phaseEngine } from "../PhaseEngine";
import { SessionPersistenceManager } from "../SessionPersistenceManager";
import { BudgetTracker } from "../BudgetTracker";

interface SessionManagerOptions {
  projectRoot: string;
  opLogDir?: string;
  budgetTracker: BudgetTracker;
  emit: (type: AutonomyEvent["type"], session: AutonomySession, payload: Record<string, unknown>) => void;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class AutonomySessionManager {
  private readonly sessions = new Map<string, AutonomySession>();
  private readonly sessionLocks = new Set<string>();
  private readonly persistence: SessionPersistenceManager;

  constructor(private readonly options: SessionManagerOptions) {
    this.persistence = new SessionPersistenceManager(options.projectRoot, options.opLogDir);
  }

  public getSession(id: string): AutonomySession | null {
    const session = this.sessions.get(id);
    return session ? (global as any).structuredClone(session) : null;
  }

  public addSession(session: AutonomySession): void {
    this.sessions.set(session.id, session);
    this.options.budgetTracker.attachSession(session);
  }

  public hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  public getAllSessions(): AutonomySession[] {
    return [...this.sessions.values()].map(s => (global as any).structuredClone(s));
  }

  public async hydrateFromDisk(): Promise<void> {
    const onDisk = await this.persistence.listSessions();
    for (const snapshot of onDisk) {
      if (!this.sessions.has(snapshot.id)) {
        this.addSession(snapshot);
      }
    }
  }

  public async transition(
    session: AutonomySession,
    state: AutonomyState,
    task: TaskNode | null,
    reason: string | null = null,
  ): Promise<void> {
    let lockAttempts = 0;
    const MAX_LOCK_ATTEMPTS = 50;

    while (this.sessionLocks.has(session.id) && lockAttempts < MAX_LOCK_ATTEMPTS) {
      lockAttempts++;
      const delay = 50 * Math.pow(1.5, lockAttempts);
      await sleep(delay);
    }

    this.sessionLocks.add(session.id);
    try {
      const resolvedNextState = phaseEngine.validateTransition(
        session,
        state,
        task,
      );

      const now = new Date().toISOString();
      const previousState = session.state;
      session.state = resolvedNextState;
      session.updatedAt = now;
      session.lastProgressAt = now;

      if (reason) {
        session.timeline.push({
          cycle: session.cycleCount,
          state: resolvedNextState,
          note: reason,
          timestamp: now,
          taskId: task?.id ?? null,
        });
      }

      await this.saveSession(session);
      this.sessions.set(session.id, session);

      this.options.emit("state", session, {
        state: resolvedNextState,
        previousState,
        reason,
        cycle: session.cycleCount,
      });

      this.options.emit("step", session, {
        state: resolvedNextState,
        taskId: task?.id ?? null,
        cycle: session.cycleCount,
        note: reason ?? "",
      });
    } finally {
      this.sessionLocks.delete(session.id);
    }
  }

  public async saveSession(session: AutonomySession): Promise<void> {
    await this.persistence.saveSession(session);
  }

  public async failSession(session: AutonomySession, errorMessage: string): Promise<void> {
    if (["failed", "done", "stopped"].includes(session.state)) return;
    
    this.options.budgetTracker.detachSession(session);
    session.error = errorMessage;
    await this.transition(session, "failed", null, errorMessage);
    this.options.emit("failed", session, { error: errorMessage });
  }

  public async loadOpLog(session: AutonomySession): Promise<void> {
    await this.persistence.loadOpLog(session);
  }

  public async appendOpLog(session: AutonomySession, entry: any): Promise<void> {
    await this.persistence.appendOpLog(session, entry);
  }
}
