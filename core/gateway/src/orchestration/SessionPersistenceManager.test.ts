import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionPersistenceManager } from "./SessionPersistenceManager";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AutonomySession, SessionOpLogEntry } from "./autonomy-types";

describe("SessionPersistenceManager", () => {
  let tempDir: string;
  let persistence: SessionPersistenceManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "persistence-test-"));
    persistence = new SessionPersistenceManager(tempDir, tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function mockSession(id = "test-session"): AutonomySession {
    return {
      id,
      objective: "test",
      touchedFiles: [],
      opLog: [],
      taskGraph: [
        { type: "analysis", status: "pending", id: "t1", attempts: 0, maxAttempts: 3, updatedAt: "" }
      ],
      createdAt: new Date().toISOString(),
    } as any;
  }

  describe("appendOpLog", () => {
    it("creates directory and writes JSON file atomically", async () => {
      const session = mockSession();
      const entry: SessionOpLogEntry = {
        operationId: "op1",
        cycle: 1,
        taskType: "analysis",
        status: "completed",
        summary: "done",
        touchedFiles: ["src/a.ts"],
        timestamp: new Date().toISOString()
      };

      await persistence.appendOpLog(session, entry);

      const logPath = path.join(tempDir, session.id, "oplog.json");
      const content = await fs.readFile(logPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].operationId).toBe("op1");
    });
  });

  describe("syncSessionFromLog", () => {
    it("syncs touchedFiles with cross-platform normalization", async () => {
      const session = mockSession();
      const logData: SessionOpLogEntry[] = [{
        operationId: "op1",
        cycle: 1,
        taskType: "analysis",
        status: "completed",
        summary: "fixed",
        touchedFiles: ["src\\b.ts", "ui/test.ts"],
        timestamp: new Date().toISOString()
      }];
      
      persistence.syncSessionFromLog(session, logData);

      expect(session.touchedFiles).toContain("src/b.ts");
      expect(session.touchedFiles).toContain("ui/test.ts");
      expect(session.taskGraph[0]?.status).toBe("completed");
    });

    it("prevents duplicate files in session.touchedFiles", async () => {
      const session = mockSession();
      session.touchedFiles = ["src/a.ts"];
      const logData: SessionOpLogEntry[] = [{
        operationId: "op1",
        cycle: 1,
        taskType: "analysis",
        status: "completed",
        summary: "done",
        touchedFiles: ["src\\a.ts", "src/a.ts"],
        timestamp: new Date().toISOString()
      }];

      persistence.syncSessionFromLog(session, logData);
      expect(session.touchedFiles.filter(f => f === "src/a.ts")).toHaveLength(1);
    });
  });

  describe("loadOpLog Integrity", () => {
    it("handles corrupted JSON gracefully", async () => {
      const session = mockSession("corrupt-session");
      const sessionDir = path.join(tempDir, session.id);
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(path.join(sessionDir, "oplog.json"), "{ invalid: json }");

      await persistence.loadOpLog(session);

      expect(session.opLog).toHaveLength(0);
      // No crash is success
    });

    it("loads valid log successfully", async () => {
      const session = mockSession("valid-session");
      const entry: SessionOpLogEntry = {
        operationId: "opok",
        cycle: 1,
        taskType: "analysis",
        status: "completed",
        summary: "ok",
        touchedFiles: ["src/ok.ts"],
        timestamp: new Date().toISOString()
      };
      
      await persistence.appendOpLog(session, entry);
      
      const newSession = mockSession("valid-session");
      await persistence.loadOpLog(newSession);
      
      expect(newSession.opLog).toHaveLength(1);
      expect(newSession.touchedFiles).toContain("src/ok.ts");
    });
  });
});
