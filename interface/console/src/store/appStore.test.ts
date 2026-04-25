/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserStubs, resetAppStore, seedAppStore } from "../tests/browserTestUtils";
import { useAppStore } from "./appStore";

describe("appStore", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetAppStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetAppStore();
  });

  it("persists only safe UI preferences via partialize", () => {
    const partialize = useAppStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();

    seedAppStore({
      theme: "light",
      sidebarOpen: false,
      selectedMode: "fast_only",
      activeSessionId: "session-2",
      modelPreferences: {
        primaryModel: "gemini-3-pro-high",
        fastModel: "gemini-3-fast",
        temperature: 0.1,
        contextWindow: "256k",
        fallbackModel: "claude-opus-4-5-thinking",
        fallbackTriggers: { rateLimit: true, serverError: true, formatError: true },
      },
      gatewayToken: "should-not-persist",
      sessionsById: {
        "session-2": {
          id: "session-2",
          state: "verify",
          objective: "volatile mission",
          account: "agent@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:05:00.000Z",
          queuePosition: 1,
          branchName: null,
          baseBranch: null,
          commitHash: null,
          currentModel: "gemini-3-pro-high",
          currentGear: "elite",
          reviewStatus: "none",
          reviewUpdatedAt: null,
        },
      },
    });

    const persisted = partialize?.(useAppStore.getState());
    expect(persisted).toEqual({
      theme: "light",
      sidebarOpen: false,
      selectedMode: "fast_only",
      modelPreferences: expect.objectContaining({
        primaryModel: "gemini-3-pro-high",
        fallbackModel: "claude-opus-4-5-thinking",
      }),
      activeSessionId: "session-2",
    });
    expect(persisted).not.toHaveProperty("gatewayToken");
    expect(persisted).not.toHaveProperty("sessionsById");
  });

  it("drops stale persisted state during version migration", async () => {
    const migrate = useAppStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const migrated = await migrate?.(
      {
        theme: "light",
        sidebarOpen: false,
        activeSessionId: "legacy-session",
      },
      0,
    );

    expect(migrated).toEqual({});
  });

  it("derives selected session state from session-indexed maps", () => {
    seedAppStore({
      sessionsById: {
        "session-1": {
          id: "session-1",
          state: "plan",
          objective: "Mission one",
          account: "agent-1@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:01:00.000Z",
          queuePosition: 1,
          branchName: null,
          baseBranch: null,
          commitHash: null,
          currentModel: "gemini-3-pro-high",
          currentGear: "elite",
          reviewStatus: "none",
          reviewUpdatedAt: null,
        },
        "session-2": {
          id: "session-2",
          state: "verify",
          objective: "Mission two",
          account: "agent-2@test.dev",
          createdAt: "2026-03-11T00:02:00.000Z",
          updatedAt: "2026-03-11T00:03:00.000Z",
          queuePosition: 2,
          branchName: "feat/audit",
          baseBranch: "main",
          commitHash: "abc123",
          currentModel: "claude-opus-4-5-thinking",
          currentGear: "elite",
          reviewStatus: "plan_pending",
          reviewUpdatedAt: "2026-03-11T00:03:00.000Z",
        },
      },
      sessionOrder: ["session-1", "session-2"],
      timelineBySession: {
        "session-2": [
          {
            id: "entry-1",
            type: "decision",
            timestamp: "2026-03-11T00:03:00.000Z",
            message: "Verifier selected fallback",
          },
        ],
      },
      gateBySession: {
        "session-2": {
          passed: false,
          blockingIssues: ["Need audit"],
          impactedScopes: ["ui"],
          audit: { critical: 0, high: 1, moderate: 0, low: 0, total: 1 },
        },
      },
      budgetBySession: {
        "session-2": {
          limits: {
            maxCycles: 10,
            maxDurationMs: 60000,
            maxInputTokens: 1000,
            maxOutputTokens: 500,
            maxTPM: 1200,
            maxRPD: 20,
          },
          usage: {
            cyclesUsed: 2,
            durationMsUsed: 12000,
            inputTokensUsed: 300,
            outputTokensUsed: 120,
            currentTPM: 420,
            requestsUsed: 2,
            usdUsed: 0,
          },
          warning: true,
          warningReason: "BUDGET_WARNING: tpm 420/1200",
          exceeded: false,
          exceedReason: null,
        },
      },
      diffBySession: {
        "session-2": ["src/orchestration/GateEngine.ts"],
      },
    });

    useAppStore.getState().selectAutonomySession("session-2");
    const state = useAppStore.getState();

    expect(state.activeSessionId).toBe("session-2");
    expect(state.autonomySession?.objective).toBe("Mission two");
    expect(state.autonomyTimeline).toHaveLength(1);
    expect(state.gateStatus?.blockingIssues).toContain("Need audit");
    expect(state.budgetStatus?.usage.currentTPM).toBe(420);
    expect(state.activeDiff).toEqual(["src/orchestration/GateEngine.ts"]);
  });

  it("falls back to a noop storage when localStorage is unavailable", async () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: undefined,
    });
    vi.resetModules();

    const mod = await import("./appStore");
    const state = mod.useAppStore.getState();

    expect(state.theme).toBeDefined();

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  });
});
