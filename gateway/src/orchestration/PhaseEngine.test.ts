import { describe, it, expect, vi } from "vitest";
import { PhaseEngine } from "./PhaseEngine";
import type { AutonomySession, TaskNode } from "./autonomy-types";

function mockSession(overrides: Partial<AutonomySession> = {}): AutonomySession {
  return {
    id: "test",
    state: "init",
    error: null,
    touchedFiles: [],
    taskGraph: [
      { id: "t1", type: "analysis", status: "completed", attempts: 0, maxAttempts: 3, updatedAt: "" },
      { id: "t2", type: "implementation", status: "completed", attempts: 0, maxAttempts: 3, updatedAt: "" },
      { id: "t3", type: "refactor", status: "skipped", attempts: 0, maxAttempts: 3, updatedAt: "" },
      { id: "t4", type: "test-fix", status: "skipped", attempts: 0, maxAttempts: 3, updatedAt: "" },
      { id: "t5", type: "verification", status: "completed", attempts: 0, maxAttempts: 3, updatedAt: "" },
      { id: "t6", type: "finalize", status: "completed", attempts: 0, maxAttempts: 3, updatedAt: "" },
    ],
    consecutiveGateFailures: 0,
    ...overrides,
  } as AutonomySession;
}

function mockTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "", ...overrides };
}

describe("PhaseEngine", () => {
  const engine = new PhaseEngine();

  describe("canTransition (static)", () => {
    it("init â†’ plan is allowed", () => {
      expect(PhaseEngine.canTransition("init", "plan")).toBe(true);
    });

    it("init â†’ execute is NOT allowed", () => {
      expect(PhaseEngine.canTransition("init", "execute")).toBe(false);
    });

    it("done â†’ any is NOT allowed (terminal state)", () => {
      expect(PhaseEngine.canTransition("done", "plan")).toBe(false);
      expect(PhaseEngine.canTransition("done", "failed")).toBe(false);
    });

    it("failed â†’ any is NOT allowed (terminal state)", () => {
      expect(PhaseEngine.canTransition("failed", "plan")).toBe(false);
    });

    it("paused â†’ retry is allowed", () => {
      expect(PhaseEngine.canTransition("paused", "retry")).toBe(true);
    });

    it("paused â†’ stopped is allowed", () => {
      expect(PhaseEngine.canTransition("paused", "stopped")).toBe(true);
    });

    it("reflect â†’ done is allowed", () => {
      expect(PhaseEngine.canTransition("reflect", "done")).toBe(true);
    });
  });

  describe("resolveTransition (deterministic arbitration)", () => {
    it("prefers paused over done when pause is pending at completion boundary", () => {
      expect(
        PhaseEngine.resolveTransition("verify", "done", { pauseRequested: true }),
      ).toBe("paused");
    });

    it("keeps original transition when pause is not pending", () => {
      expect(
        PhaseEngine.resolveTransition("verify", "done", { pauseRequested: false }),
      ).toBe("done");
    });
  });

  describe("validateTransition", () => {
    it("throws on illegal transition", () => {
      const session = mockSession({ state: "init" });
      expect(() => engine.validateTransition(session, "execute", null)).toThrow("Illegal transition");
    });

    it("execute without task throws", () => {
      const session = mockSession({ state: "plan" });
      expect(() => engine.validateTransition(session, "execute", null)).toThrow("requires an active task");
    });

    it("execute with skipped task throws", () => {
      const session = mockSession({ state: "plan" });
      const task = mockTask({ status: "skipped" });
      expect(() => engine.validateTransition(session, "execute", task)).toThrow("Cannot execute task in status");
    });

    it("execute with pending task passes", () => {
      const session = mockSession({ state: "plan" });
      const task = mockTask({ status: "pending" });
      expect(() => engine.validateTransition(session, "execute", task)).not.toThrow();
    });

    it("done with pending tasks throws", () => {
      const session = mockSession({
        state: "reflect",
        taskGraph: [
          { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "" },
        ],
      });
      expect(() => engine.validateTransition(session, "done", null)).toThrow("tasks are still pending");
    });

    it("done with all completed/skipped passes", () => {
      const session = mockSession({ state: "reflect" });
      expect(() => engine.validateTransition(session, "done", null)).not.toThrow();
    });

    it("failed without error throws", () => {
      const session = mockSession({ state: "init", error: null });
      expect(() => engine.validateTransition(session, "failed", null)).toThrow("requires an error message");
    });

    it("failed with error passes", () => {
      const session = mockSession({ state: "init", error: "Something went wrong" });
      expect(() => engine.validateTransition(session, "failed", null)).not.toThrow();
    });

    it("verify with no touched files passes without warning by default", () => {
      const session = mockSession({ state: "execute", touchedFiles: [] });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const previous = process.env.ALLOY_WARN_VERIFY_NO_TOUCHED;
      delete process.env.ALLOY_WARN_VERIFY_NO_TOUCHED;

      try {
        expect(() => engine.validateTransition(session, "verify", mockTask({ type: "implementation" }))).not.toThrow();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) {
          delete process.env.ALLOY_WARN_VERIFY_NO_TOUCHED;
        } else {
          process.env.ALLOY_WARN_VERIFY_NO_TOUCHED = previous;
        }
        warn.mockRestore();
      }
    });

    it("verify with no touched files warns for implementation tasks when opt-in flag is enabled", () => {
      const session = mockSession({ state: "execute", touchedFiles: [] });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const previous = process.env.ALLOY_WARN_VERIFY_NO_TOUCHED;
      process.env.ALLOY_WARN_VERIFY_NO_TOUCHED = "1";

      try {
        expect(() => engine.validateTransition(session, "verify", mockTask({ type: "implementation" }))).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("without touched files"));
      } finally {
        if (previous === undefined) {
          delete process.env.ALLOY_WARN_VERIFY_NO_TOUCHED;
        } else {
          process.env.ALLOY_WARN_VERIFY_NO_TOUCHED = previous;
        }
        warn.mockRestore();
      }
    });

    it("verify with no touched files does not warn for no-file task types", () => {
      const session = mockSession({ state: "execute", touchedFiles: [] });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const previous = process.env.ALLOY_WARN_VERIFY_NO_TOUCHED;
      process.env.ALLOY_WARN_VERIFY_NO_TOUCHED = "1";

      try {
        expect(() => engine.validateTransition(session, "verify", mockTask({ type: "analysis" }))).not.toThrow();
        expect(() => engine.validateTransition(session, "verify", mockTask({ type: "finalize" }))).not.toThrow();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) {
          delete process.env.ALLOY_WARN_VERIFY_NO_TOUCHED;
        } else {
          process.env.ALLOY_WARN_VERIFY_NO_TOUCHED = previous;
        }
        warn.mockRestore();
      }
    });

    it("resolves verify -> done to paused when pause is pending", () => {
      const session = mockSession({ state: "verify" });
      const resolved = engine.validateTransition(session, "done", null, { pauseRequested: true });
      expect(resolved).toBe("paused");
    });

    it("keeps verify -> done illegal when no pause is pending", () => {
      const session = mockSession({ state: "verify" });
      expect(() => engine.validateTransition(session, "done", null)).toThrow("Illegal transition");
    });
  });

  describe("getNextAction", () => {
    it("returns failed when session has error", () => {
      const session = mockSession({ error: "fatal" });
      expect(engine.getNextAction(session)).toBe("failed");
    });

    it("returns failed when 3+ consecutive gate failures", () => {
      const session = mockSession({ consecutiveGateFailures: 3 });
      expect(engine.getNextAction(session)).toBe("failed");
    });

    it("returns done when no pending tasks", () => {
      const session = mockSession();
      expect(engine.getNextAction(session)).toBe("done");
    });

    it("returns plan when pending tasks exist", () => {
      const session = mockSession({
        taskGraph: [
          { id: "t1", type: "analysis", status: "pending", attempts: 0, maxAttempts: 3, updatedAt: "" },
        ],
      });
      expect(engine.getNextAction(session)).toBe("plan");
    });
  });
});
