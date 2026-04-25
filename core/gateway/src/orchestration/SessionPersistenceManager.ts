import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { 
  AutonomySession, 
  SessionOpLogEntry 
} from "./autonomy-types";

/**
 * SessionPersistenceManager: Handles saving and loading autonomy session data to/from disk.
 */
export class SessionPersistenceManager {
  private opLogDir: string;

  constructor(projectRoot: string, opLogDir?: string) {
    this.opLogDir = path.resolve(
      opLogDir ?? path.join(projectRoot, ".ai-company", "autonomy-sessions")
    );
  }

  /**
   * Loads the operation log for a session from disk and synchronizes the session state.
   */
  public async loadOpLog(session: AutonomySession): Promise<void> {
    const opLogFile = this.getOpLogFile(session.id);
    try {
      const raw = await fs.readFile(opLogFile, "utf-8");
      const parsed = JSON.parse(raw) as SessionOpLogEntry[];
      if (!Array.isArray(parsed)) return;
      
      session.opLog = parsed;
      this.syncSessionFromLog(session, parsed);
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.warn(`[Persistence] Corrupted oplog for session ${session.id}: ${err.message}. Starting fresh log.`);
      }
      // Missing or corrupted op-log starts fresh.
    }
  }

  /**
   * Saves the entire session metadata to disk.
   */
  public async saveSession(session: AutonomySession): Promise<void> {
    const sessionDir = path.join(this.opLogDir, session.id);
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, "session.json");
    await this.atomicWrite(sessionFile, JSON.stringify(session, null, 2));
  }

  /**
   * Appends an entry to the session's operation log and persists it to disk.
   */
  public async appendOpLog(session: AutonomySession, entry: SessionOpLogEntry): Promise<void> {
    session.opLog.push(entry);
    const sessionDir = path.join(this.opLogDir, session.id);
    await fs.mkdir(sessionDir, { recursive: true });
    const opLogFile = path.join(sessionDir, "oplog.json");
    await this.atomicWrite(opLogFile, JSON.stringify(session.opLog, null, 2));
  }

  /**
   * synchronizes session state from the log entries.
   */
  public syncSessionFromLog(session: AutonomySession, log: SessionOpLogEntry[]): void {
    if (!Array.isArray(log)) return;
    for (const entry of log) {
      if (entry.status === "completed") {
        const task = session.taskGraph.find((node) => node.type === entry.taskType);
        if (task && task.status !== "completed") {
          task.status = "completed";
          task.updatedAt = new Date().toISOString();
        }
        const normalized = entry.touchedFiles.map(f => f.replace(/\\/g, "/"));
        session.touchedFiles = [...new Set([...session.touchedFiles, ...normalized])];
      }
    }
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp_${Math.random().toString(36).slice(2)}`;
    try {
      await fs.writeFile(tempPath, content, "utf-8");
      
      // Bulletproof: Read-back verification
      const verifyRaw = await fs.readFile(tempPath, "utf-8");
      if (verifyRaw !== content) {
        throw new Error(`Persistence verification failed: Content mismatch for ${filePath}`);
      }
      
      // JSON integrity verify (to prevent partial writes even if strings match)
      JSON.parse(verifyRaw);

      await fs.rename(tempPath, filePath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  public async listSessions(): Promise<AutonomySession[]> {
    try {
      const entries = await fs.readdir(this.opLogDir, { withFileTypes: true });
      const sessions: AutonomySession[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionFile = path.join(this.opLogDir, entry.name, "session.json");
          try {
            const raw = await fs.readFile(sessionFile, "utf-8");
            sessions.push(JSON.parse(raw));
          } catch {
            // Skip invalid or non-existent session files
          }
        }
      }
      return sessions;
    } catch {
      return [];
    }
  }

  private getOpLogFile(sessionId: string): string {
    return path.join(this.opLogDir, sessionId, "oplog.json");
  }
}
