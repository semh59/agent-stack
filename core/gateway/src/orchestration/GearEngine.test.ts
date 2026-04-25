import { describe, it, expect } from "vitest";
import { GearEngine } from "./GearEngine";
import type { AutonomySession, SessionOpLogEntry } from "./autonomy-types";

function mockSession(opLog: Partial<SessionOpLogEntry>[] = []): AutonomySession {
  return {
    id: "test",
    objective: "Build a login feature",
    opLog: opLog.map((l, i) => ({
      operationId: `op-${i}`,
      cycle: l.cycle ?? i + 1,
      taskType: l.taskType ?? "implementation",
      status: l.status ?? "completed",
      summary: l.summary ?? `Summary ${i}`,
      touchedFiles: [],
      timestamp: new Date().toISOString(),
      ...l,
    })),
    scope: { mode: "selected_only", paths: ["src"] },
    modelHistory: [],
    anchorModel: "gemini-3-pro-high",
    artifacts: { plan: "", changeSummary: "", nextActionReason: "", gateResult: null, rawResponses: [], contextPack: "" },
    cycleCount: opLog.length,
  } as unknown as AutonomySession;
}

describe("GearEngine", () => {
  const engine = new GearEngine();

  describe("buildSystemPrompt", () => {
    it("includes mission objective", () => {
      const session = mockSession();
      const prompt = engine.buildSystemPrompt({
        session,
        activeTask: { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "" },
        phase: "plan",
        gearLevel: "standard",
      });
      expect(prompt).toContain("Build a login feature");
    });

    it("elite gear includes self-reflect instruction", () => {
      const session = mockSession();
      const prompt = engine.buildSystemPrompt({
        session,
        activeTask: { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "" },
        phase: "plan",
        gearLevel: "elite",
      });
      expect(prompt).toContain("Self-reflect");
    });

    it("standard gear includes speed focus instruction", () => {
      const session = mockSession();
      const prompt = engine.buildSystemPrompt({
        session,
        activeTask: { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "" },
        phase: "plan",
        gearLevel: "standard",
      });
      expect(prompt).toContain("speed and correctness");
    });

    it("includes phase instructions", () => {
      const session = mockSession();
      const prompt = engine.buildSystemPrompt({
        session,
        activeTask: { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "" },
        phase: "execute",
        gearLevel: "standard",
      });
      expect(prompt).toContain("production-ready code");
    });
  });

  describe("squeezeHistory", () => {
    it("returns default message for empty log", () => {
      const session = mockSession([]);
      expect(engine.squeezeHistory(session)).toBe("No prior history in this mission.");
    });

    it("shows all entries when â‰¤5", () => {
      const session = mockSession([
        { cycle: 1, taskType: "analysis", status: "completed", summary: "Analyzed code" },
        { cycle: 2, taskType: "implementation", status: "completed", summary: "Wrote feature" },
      ]);
      const history = engine.squeezeHistory(session);
      expect(history).toContain("[Cycle 1]");
      expect(history).toContain("[Cycle 2]");
      expect(history).not.toContain("---");
    });

    it("shows early summary + recent detail when >5 entries", () => {
      const entries = Array.from({ length: 8 }, (_, i) => ({
        cycle: i + 1,
        taskType: "implementation" as const,
        status: i < 6 ? "completed" as const : "failed" as const,
        summary: `Step ${i + 1}`,
      }));
      const session = mockSession(entries);
      const history = engine.squeezeHistory(session);

      // Should have early summary
      expect(history).toContain("Cycles 1-3:");
      // Should have separator
      expect(history).toContain("---");
      // Should have recent detail
      expect(history).toContain("[Cycle 4]");
      expect(history).toContain("[Cycle 8]");
    });
  });

  describe("buildSkillsPrompt (via buildSystemPrompt)", () => {
    it("returns no skills section without SkillEngine", () => {
      const session = mockSession();
      const prompt = engine.buildSystemPrompt({
        session,
        activeTask: { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "" },
        phase: "plan",
        gearLevel: "standard",
      });
      expect(prompt).not.toContain("RELEVANT SKILLS");
    });
  });
});
