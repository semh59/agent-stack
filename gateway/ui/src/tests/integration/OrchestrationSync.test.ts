/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserStubs, resetAppStore, seedAppStore } from "../browserTestUtils";
import { useAppStore } from "../../store/appStore";

describe("Orchestration & Telemetry Sync", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetAppStore();
    seedAppStore({
      pipelineStatus: { status: "running", state: { pipelineStatus: "running", userTask: "sync", startedAt: "2026-03-11T00:00:00.000Z", completedAt: null } },
      sessionsById: {
        "sync-session": {
          id: "sync-session",
          state: "execute",
          objective: "Sync mission",
          account: "agent@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:00:00.000Z",
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
      sessionOrder: ["sync-session"],
      activeSessionId: "sync-session",
      autonomySessionId: "sync-session",
      timelineBySession: { "sync-session": [] },
      gateBySession: { "sync-session": null },
      budgetBySession: { "sync-session": null },
      diffBySession: { "sync-session": [] },
      planArtifactsBySession: { "sync-session": null },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetAppStore();
  });

  it("propagates decision_log events into selected session timeline and derived state", () => {
    useAppStore.getState().handleMessageData({
      type: "autonomyEvent",
      sessionId: "sync-session",
      eventType: "decision_log",
      timestamp: "2026-03-11T00:03:00.000Z",
      payload: {
        id: "decision-1",
        strategy: "RECOVERY",
        confidence: 0.85,
        reason: "Rate limit detected",
        taskId: "task-123",
        cycle: 2,
      },
    });

    const state = useAppStore.getState();
    expect(state.timelineBySession["sync-session"]).toHaveLength(1);
    expect(state.timelineBySession["sync-session"][0]?.type).toBe("decision");
    expect(state.autonomyTimeline[0]?.payload).toMatchObject({
      strategy: "RECOVERY",
      confidence: 0.85,
    });
  });

  it("synchronizes budget events across budget, analytics, and pipeline slices", () => {
    useAppStore.getState().handleMessageData({
      type: "autonomyEvent",
      sessionId: "sync-session",
      eventType: "budget",
      timestamp: "2026-03-11T00:05:00.000Z",
      payload: {
        limits: {
          maxCycles: 10,
          maxDurationMs: 60000,
          maxInputTokens: 1000,
          maxOutputTokens: 500,
          maxTPM: 1000,
          maxRPD: 10,
        },
        usage: {
          cyclesUsed: 4,
          durationMsUsed: 20000,
          inputTokensUsed: 400,
          outputTokensUsed: 150,
          currentTPM: 1000,
          requestsUsed: 10,
          usdUsed: 0,
        },
        warning: false,
        warningReason: null,
        exceeded: true,
        exceedReason: "BUDGET_EXCEEDED: tpm 1000/1000",
        tokenVelocity: 21,
        efficiencyScore: 0.74,
      },
    });

    const state = useAppStore.getState();
    expect(state.budgetBySession["sync-session"]?.exceeded).toBe(true);
    expect(state.analyticsBySession["sync-session"]).toMatchObject({
      tokenVelocity: 21,
      efficiencyScore: 0.74,
    });
    expect(state.pipelineStatus?.status).toBe("paused");
    expect(state.budgetStatus?.exceedReason).toContain("tpm 1000/1000");
  });
});
