import { describe, expect, it, vi } from "vitest";
import { InMemoryMissionRepository } from "../repositories/mission.repository";
import type { AutonomyEvent, AutonomySession, GateResult } from "../orchestration/autonomy-types";
import { MissionPersistenceSubscriber } from "./MissionPersistenceSubscriber";

function createGateResult(overrides: Partial<GateResult> = {}): GateResult {
  return {
    passed: true,
    strictMode: true,
    impactedScopes: ["root"],
    commands: [],
    blockingIssues: [],
    auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
    timestamp: "2026-03-12T10:05:00.000Z",
    ...overrides,
  };
}

function createSession(overrides: Partial<AutonomySession> = {}): AutonomySession {
  return {
    id: "session-1",
    objective: "Persist runtime state",
    account: "dev@example.com",
    anchorModel: "gemini-3-pro-high",
    modelPolicy: "smart_multi",
    gitMode: "patch_only",
    startMode: "immediate",
    scope: { mode: "selected_only", paths: ["src"] },
    strictMode: true,
    state: "execute",
    reviewAfterPlan: false,
    currentModel: "gemini-3-pro-high",
    currentGear: "standard",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:05:00.000Z",
    cycleCount: 1,
    maxCycles: 5,
    maxDurationMs: 60_000,
    queuePosition: null,
    budgets: {
      limits: {
        maxCycles: 5,
        maxDurationMs: 60_000,
        maxInputTokens: 50_000,
        maxOutputTokens: 10_000,
        maxTPM: 2_000,
        maxRPD: 20,
      },
      usage: {
        cyclesUsed: 1,
        durationMsUsed: 1_000,
        inputTokensUsed: 300,
        outputTokensUsed: 150,
        currentTPM: 900,
        requestsUsed: 2,
        usdUsed: 0.01,
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
    touchedFiles: ["src/file.ts"],
    baselineDirtyFiles: [],
    modelHistory: [],
    timeline: [],
    opLog: [],
    taskGraph: [],
    artifacts: {
      plan: "# Plan Review",
      changeSummary: "Changed files",
      nextActionReason: "Continue",
      gateResult: createGateResult(),
      rawResponses: [],
      contextPack: "ctx",
    },
    error: null,
    lastProgressAt: new Date().toISOString(),
    stopReason: null,
    ...overrides,
  };
}

describe("MissionPersistenceSubscriber", () => {
  it("persists mission rows, runtime snapshots, timeline, gate, and budget records", async () => {
    const repository = new InMemoryMissionRepository();
    const sessions = new Map<string, AutonomySession>([["session-1", createSession()]]);
    const subscriber = new MissionPersistenceSubscriber(repository, {
      getSession: (sessionId) => sessions.get(sessionId) ?? null,
    });

    const budgetEvent: AutonomyEvent = {
      type: "budget",
      sessionId: "session-1",
      timestamp: "2026-03-12T10:05:00.000Z",
      payload: {
        warning: true,
        warningReason: "TPM near limit",
      },
    };
    const gateEvent: AutonomyEvent = {
      type: "gate_result",
      sessionId: "session-1",
      timestamp: "2026-03-12T10:06:00.000Z",
      payload: {
        passed: true,
      },
    };

    await subscriber.handleEvent(budgetEvent);
    await subscriber.handleEvent(gateEvent);

    const mission = await repository.findById("session-1");
    const timeline = await repository.getTimeline("session-1");
    const gateResults = await repository.getGateResults("session-1");
    const latestBudget = await repository.getLatestBudget("session-1");
    const runtimeSnapshot = await repository.getRuntimeSnapshot("session-1");

    expect(mission?.prompt).toBe("Persist runtime state");
    expect(timeline.items.map((item) => item.type)).toEqual(["mission.budget", "mission.gate_result"]);
    expect(gateResults).toHaveLength(1);
    expect(latestBudget?.usage.currentTPM).toBe(900);
    expect(runtimeSnapshot?.id).toBe("session-1");
  });

  it("does not duplicate persisted timeline/budget/gate records for the same event hash", async () => {
    const repository = new InMemoryMissionRepository();
    const session = createSession();
    const logger = { error: vi.fn(), warn: vi.fn() };
    const subscriber = new MissionPersistenceSubscriber(repository, {
      getSession: () => session,
      logger,
    });

    const event: AutonomyEvent = {
      type: "budget",
      sessionId: "session-1",
      timestamp: "2026-03-12T10:05:00.000Z",
      payload: {
        warning: true,
        warningReason: "TPM near limit",
      },
    };

    await subscriber.handleEvent(event);
    await subscriber.handleEvent(event);

    const timeline = await repository.getTimeline("session-1");
    const gateResults = await repository.getGateResults("session-1");

    expect(timeline.items).toHaveLength(1);
    expect(gateResults).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
