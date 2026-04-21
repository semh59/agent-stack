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

  public async saveSession(session: AutonomySession): Promise<void> {
    await this.persistence.saveSession(session).catch(err => {
      console.error(`[Persistence] Failed to save state for session ${session.id}: ${err.message}`);
    });
  }

  public async transition(
    session: AutonomySession,
    state: AutonomyState,
    task: TaskNode | null,
    note: string,
  ): Promise<void> {
    let lockAttempts = 0;
    const MAX_LOCK_ATTEMPTS = 20;
    while (this.sessionLocks.has(session.id) && lockAttempts < MAX_LOCK_ATTEMPTS) {
      lockAttempts++;
      const delay = 50 * Math.pow(1.5, lockAttempts);
      await sleep(delay);
    }

    if (this.sessionLocks.has(session.id)) {
      throw new Error(`[PhaseGuard] Failed to acquire lock for session ${session.id} after ${MAX_LOCK_ATTEMPTS} attempts.`);
    }
    this.sessionLocks.add(session.id);

    try {
      if (session.state === state && state !== "failed") return;

      if (["failed", "done", "stopped"].includes(session.state)) {
        if (!["failed", "done", "stopped"].includes(state)) {
          console.warn(`[PhaseGuard] Blocked transition from terminal ${session.state} to ${state}`);
          return;
        }
      }

      phaseEngine.validateTransition(session, state, task);

      const now = new Date().toISOString();
      session.state = state;
      session.updatedAt = now;
      session.lastProgressAt = now;
      
      session.timeline.push({
        cycle: session.cycleCount,
        state,
        taskId: task?.id ?? null,
        note,
        timestamp: now,
      });

      await this.saveSession(session);

      this.options.emit("state", session, {
        state,
        taskId: task?.id ?? null,
        cycle: session.cycleCount,
        note,
      });
      this.options.emit("step", session, {
        state,
        taskId: task?.id ?? null,
        cycle: session.cycleCount,
        note,
      });
    } finally {
      this.sessionLocks.delete(session.id);
    }
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
