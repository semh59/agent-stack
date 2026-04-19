import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BudgetTracker } from "./BudgetTracker";
import type { AutonomySession } from "./autonomy-types";

function createMockSession(overrides: Partial<AutonomySession> = {}): AutonomySession {
  return {
    id: "test-session",
    objective: "test",
    account: "test@test.com",
    anchorModel: "gemini-3-pro-high",
    modelPolicy: "smart_multi",
    gitMode: "patch_only",
    startMode: "immediate",
    scope: { mode: "selected_only", paths: ["src"] },
    strictMode: true,
    state: "execute",
    reviewAfterPlan: false,
    currentModel: "gemini-3-pro-high",
    currentGear: "elite",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cycleCount: 0,
    maxCycles: 12,
    maxDurationMs: 2_700_000,
    queuePosition: null,
    budgets: {
      limits: {
        maxCycles: 12,
        maxDurationMs: 2_700_000,
        maxInputTokens: 2_000_000,
        maxOutputTokens: 400_000,
        maxTPM: 120_000,
        maxRPD: 1_000,
        maxUsd: 20,
      },
      usage: {
        cyclesUsed: 0,
        durationMsUsed: 0,
        inputTokensUsed: 0,
        outputTokensUsed: 0,
        currentTPM: 0,
        requestsUsed: 0,
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
    taskGraph: [],
    artifacts: {
      plan: "",
      changeSummary: "",
      nextActionReason: "",
      gateResult: null,
      rawResponses: [],
      contextPack: "",
    },
    error: null,
    stopReason: null,
    ...overrides,
  } as AutonomySession;
}

describe("BudgetTracker", () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("consume", () => {
    it("updates token, TPM, RPD, and USD usage", () => {
      const session = createMockSession();
      tracker.consume(session, 1000, 500, 0.05);

      expect(session.budgets.usage.inputTokensUsed).toBe(1000);
      expect(session.budgets.usage.outputTokensUsed).toBe(500);
      expect(session.budgets.usage.currentTPM).toBe(1500);
      expect(session.budgets.usage.requestsUsed).toBe(1);
      expect(session.budgets.usage.usdUsed).toBeCloseTo(0.05);
    });

    it("accumulates across multiple calls", () => {
      const session = createMockSession();
      tracker.consume(session, 1000, 500, 0.05);
      tracker.consume(session, 2000, 300, 0.03);

      expect(session.budgets.usage.inputTokensUsed).toBe(3000);
      expect(session.budgets.usage.outputTokensUsed).toBe(800);
      expect(session.budgets.usage.currentTPM).toBe(3800);
      expect(session.budgets.usage.requestsUsed).toBe(2);
      expect(session.budgets.usage.usdUsed).toBeCloseTo(0.08);
    });

    it("clamps negative values to 0", () => {
      const session = createMockSession();
      tracker.consume(session, -100, -50, -1);

      expect(session.budgets.usage.inputTokensUsed).toBe(0);
      expect(session.budgets.usage.outputTokensUsed).toBe(0);
      expect(session.budgets.usage.usdUsed).toBe(0);
    });
  });

  describe("checkExceeded", () => {
    it("returns false when under all limits", () => {
      const session = createMockSession();
      session.cycleCount = 5;
      expect(tracker.checkExceeded(session)).toBe(false);
      expect(session.budgets.exceeded).toBe(false);
    });

    it("returns true when cycles at limit", () => {
      const session = createMockSession();
      session.cycleCount = 12;
      expect(tracker.checkExceeded(session)).toBe(true);
      expect(session.budgets.exceeded).toBe(true);
      expect(session.budgets.exceedReason).toContain("cycles");
    });

    it("returns false when TPM is still under the hard stop", () => {
      const session = createMockSession({
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 1,
            durationMsUsed: 1_000,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 950,
            requestsUsed: 1,
            usdUsed: 0,
          },
          warning: true,
          warningReason: "BUDGET_WARNING: tpm 950/1000",
          exceeded: false,
          exceedReason: null,
        },
      });

      expect(tracker.checkExceeded(session)).toBe(false);
      expect(session.budgets.exceeded).toBe(false);
    });

    it("returns true when TPM reaches the hard stop", () => {
      const session = createMockSession({
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 0,
            durationMsUsed: 0,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });

      tracker.consume(session, 1_000, 0, 0);
      expect(tracker.checkExceeded(session)).toBe(true);
      expect(session.budgets.exceedReason).toContain("tpm");
    });

    it("returns true when RPD reaches the hard stop", () => {
      const session = createMockSession({
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 3,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 0,
            durationMsUsed: 0,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        tracker.consume(session, 10, 0, 0);
      }
      expect(tracker.checkExceeded(session)).toBe(true);
      expect(session.budgets.exceedReason).toContain("rpd");
    });

    it("resets exceeded to false when back under limit", () => {
      const session = createMockSession();
      session.budgets.exceeded = true;
      session.budgets.exceedReason = "old reason";
      session.cycleCount = 1;
      expect(tracker.checkExceeded(session)).toBe(false);
      expect(session.budgets.exceeded).toBe(false);
      expect(session.budgets.exceedReason).toBeNull();
    });
  });

  describe("checkWarning", () => {
    it("returns a warning when TPM reaches 90 percent of the quota", () => {
      const session = createMockSession({
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 1_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 1,
            durationMsUsed: 1_000,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });

      tracker.consume(session, 950, 0, 0);

      expect(tracker.checkWarning(session)).toContain("tpm 950/1000");
      expect(tracker.checkExceeded(session)).toBe(false);
    });

    it("returns a warning when RPD reaches 90 percent of the quota", () => {
      const session = createMockSession({
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 1_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 1,
            durationMsUsed: 1_000,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });

      for (let attempt = 0; attempt < 9; attempt += 1) {
        tracker.consume(session, 10, 0, 0);
      }

      expect(tracker.checkWarning(session)).toContain("rpd 9/10");
      expect(tracker.checkExceeded(session)).toBe(false);
    });

    it("returns null when TPM and RPD stay comfortably within limits", () => {
      const session = createMockSession({
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 1_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 1,
            durationMsUsed: 1_000,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });

      tracker.consume(session, 100, 0, 0);

      expect(tracker.checkWarning(session)).toBeNull();
      expect(tracker.checkExceeded(session)).toBe(false);
    });

    it("clears TPM warning after the 60 second rolling window expires", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-11T00:00:00.000Z"));

      const session = createMockSession({
        createdAt: new Date("2026-03-11T00:00:00.000Z").toISOString(),
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 1_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 1,
            durationMsUsed: 0,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });

      tracker.consume(session, 900, 0, 0);
      expect(tracker.checkWarning(session)).toContain("tpm 900/1000");

      vi.advanceTimersByTime(60_001);

      expect(tracker.checkWarning(session)).toBeNull();
      expect(session.budgets.warning).toBe(false);
      expect(session.budgets.usage.currentTPM).toBe(0);
    });

    it("tracks TPM and RPD windows independently per session", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-11T00:00:00.000Z"));

      const sessionA = createMockSession({
        id: "session-a",
        createdAt: new Date("2026-03-11T00:00:00.000Z").toISOString(),
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 0,
            durationMsUsed: 0,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });
      const sessionB = createMockSession({
        id: "session-b",
        createdAt: new Date("2026-03-11T00:00:00.000Z").toISOString(),
        budgets: {
          limits: {
            maxCycles: 12,
            maxDurationMs: 2_700_000,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 400_000,
            maxTPM: 1_000,
            maxRPD: 10,
            maxUsd: 20,
          },
          usage: {
            cyclesUsed: 0,
            durationMsUsed: 0,
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      });

      tracker.consume(sessionA, 950, 0, 0);
      tracker.consume(sessionB, 100, 0, 0);

      expect(tracker.checkWarning(sessionA)).toContain("tpm 950/1000");
      expect(tracker.checkWarning(sessionB)).toBeNull();

      for (let attempt = 0; attempt < 9; attempt += 1) {
        tracker.consume(sessionA, 1, 0, 0);
      }
      expect(sessionA.budgets.usage.requestsUsed).toBe(10);
      expect(sessionB.budgets.usage.requestsUsed).toBe(1);
    });
  });

  describe("getUsagePercentage", () => {
    it("returns correct percentage", () => {
      const session = createMockSession();
      session.cycleCount = 6;
      session.budgets.usage.cyclesUsed = 6;
      expect(tracker.getUsagePercentage(session, "maxCycles")).toBe(50);
    });

    it("returns 0 for zero limit", () => {
      const session = createMockSession();
      session.budgets.limits.maxCycles = 0;
      expect(tracker.getUsagePercentage(session, "maxCycles")).toBe(0);
    });
  });

  describe("getTokenVelocity", () => {
    it("calculates average tokens per second over the rolling window", () => {
      const freshTracker = new BudgetTracker();
      const session = createMockSession();
      
      // Window is 300s. 3000 tokens total = 10 tokens/sec
      freshTracker.consume(session, 1500, 1500, 0.1);
      
      expect(freshTracker.getTokenVelocity()).toBe(10);
    });

    it("returns 0 when no tokens consumed", () => {
      const freshTracker = new BudgetTracker();
      expect(freshTracker.getTokenVelocity()).toBe(0);
    });

    it("drops old token samples outside the 5 minute velocity window", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-11T00:00:00.000Z"));

      const freshTracker = new BudgetTracker();
      const session = createMockSession({
        createdAt: new Date("2026-03-11T00:00:00.000Z").toISOString(),
      });

      freshTracker.consume(session, 1500, 1500, 0.1);
      expect(freshTracker.getTokenVelocity()).toBe(10);

      vi.advanceTimersByTime(300_001);

      freshTracker.consume(session, 0, 0, 0);
      expect(freshTracker.getTokenVelocity()).toBe(0);
    });
  });

  describe("reservation lifecycle", () => {
    it("admits only one concurrent reservation when projected TPM exceeds the limit", async () => {
      const session = createMockSession({
        budgets: {
          ...createMockSession().budgets,
          limits: {
            ...createMockSession().budgets.limits,
            maxTPM: 150,
            maxRPD: 10,
          },
        },
      });

      const [first, second] = await Promise.all([
        tracker.reserve(session, {
          requestId: "req-1",
          estimatedTokens: 100,
          leaseExpiresAtMs: Date.now() + 5_000,
        }),
        tracker.reserve(session, {
          requestId: "req-2",
          estimatedTokens: 100,
          leaseExpiresAtMs: Date.now() + 5_000,
        }),
      ]);

      const acceptedCount = [first, second].filter((result) => result.accepted).length;
      expect(acceptedCount).toBe(1);
      expect([first.reason, second.reason].filter(Boolean)[0]).toContain("BUDGET_EXCEEDED");
    });

    it("releases stale reservations after lease expiry and counts cached tokens out of effective TPM", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-11T00:00:00.000Z"));

      const session = createMockSession({
        budgets: {
          ...createMockSession().budgets,
          limits: {
            ...createMockSession().budgets.limits,
            maxTPM: 150,
            maxRPD: 10,
          },
        },
      });

      const reservation = await tracker.reserve(session, {
        requestId: "req-expire",
        estimatedTokens: 100,
        leaseExpiresAtMs: Date.now() + 500,
      });
      expect(reservation.accepted).toBe(true);

      await vi.advanceTimersByTimeAsync(1_001);

      const nextReservation = await tracker.reserve(session, {
        requestId: "req-after-expire",
        estimatedTokens: 100,
        leaseExpiresAtMs: Date.now() + 5_000,
      });
      expect(nextReservation.accepted).toBe(true);

      const commitResult = await tracker.commit(
        nextReservation.reservation!.reservationId,
        {
          inputTokens: 100,
          outputTokens: 10,
          estimatedUsd: 0.01,
          cachedInputTokens: 60,
        },
      );

      expect(commitResult.usage?.currentTPM).toBe(50);
      expect(commitResult.usage?.cachedInputTokensUsed).toBe(60);
    });
  });
});
