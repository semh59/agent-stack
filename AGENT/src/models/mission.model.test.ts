import { describe, expect, it } from "vitest";
import type { AutonomySession, GateResult } from "../orchestration/autonomy-types";
import { parseMissionPlan, toMissionModel } from "./mission.model";

function createGateResult(overrides: Partial<GateResult> = {}): GateResult {
  return {
    passed: true,
    strictMode: true,
    impactedScopes: ["root"],
    commands: [],
    blockingIssues: [],
    auditSummary: {
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
      total: 0,
    },
    timestamp: "2026-03-11T12:10:00.000Z",
    ...overrides,
  };
}

function createSession(overrides: Partial<AutonomySession> = {}): AutonomySession {
  return {
    id: "aut_001",
    objective: "Implement the persistence layer",
    account: "engineer@example.com",
    anchorModel: "claude-opus-4-5-thinking",
    modelPolicy: "smart_multi",
    gitMode: "patch_only",
    startMode: "immediate",
    scope: {
      mode: "selected_only",
      paths: ["src", "docs"],
    },
    strictMode: true,
    state: "plan",
    reviewAfterPlan: true,
    currentModel: "claude-opus-4-5-thinking",
    currentGear: "elite",
    reviewStatus: "plan_pending",
    reviewUpdatedAt: "2026-03-11T12:05:00.000Z",
    createdAt: "2026-03-11T12:00:00.000Z",
    updatedAt: "2026-03-11T12:15:00.000Z",
    cycleCount: 1,
    maxCycles: 5,
    maxDurationMs: 60_000,
    queuePosition: null,
    budgets: {
      limits: {
        maxCycles: 5,
        maxDurationMs: 60_000,
        maxInputTokens: 10_000,
        maxOutputTokens: 4_000,
        maxTPM: 2_000,
        maxRPD: 20,
      },
      usage: {
        cyclesUsed: 1,
        durationMsUsed: 1_200,
        inputTokensUsed: 700,
        outputTokensUsed: 300,
        currentTPM: 1_000,
        requestsUsed: 1,
        usdUsed: 0.01,
      },
      warning: false,
      warningReason: null,
      exceeded: false,
      exceedReason: null,
    },
    consecutiveGateFailures: 0,
    branchName: "feature/persistence",
    baseBranch: "main",
    commitHash: "abc123",
    touchedFiles: ["src/models/mission.model.ts"],
    baselineDirtyFiles: [],
    modelHistory: [],
    timeline: [
      {
        cycle: 1,
        state: "plan",
        taskId: "task-1",
        note: "Plan generated",
        timestamp: "2026-03-11T12:01:00.000Z",
      },
    ],
    opLog: [],
    taskGraph: [],
    artifacts: {
      plan: [
        "# Plan Review",
        "",
        "## Objective",
        "Implement the persistence layer",
        "",
        "## Scope",
        "- src",
        "- docs",
        "",
        "## Current Phase",
        "plan",
        "",
        "## Current Model",
        "claude-opus-4-5-thinking",
        "",
        "## Proposed Steps",
        "- Define the domain model",
        "- Add in-memory repository",
        "",
        "## Expected Touch Points",
        "- src/models/mission.model.ts",
        "- src/repositories/mission.repository.ts",
        "",
        "## Risks / Gate Expectations",
        "- Strict gate validation remains enabled.",
        "- Repository must stay DB-ready.",
        "",
        "## Next Action",
        "Await approval.",
      ].join("\n"),
      changeSummary: "Mission model extracted",
      nextActionReason: "Wait for approval",
      gateResult: createGateResult(),
      rawResponses: ['{"summary":"ok"}'],
      contextPack: "architecture summary",
    },
    error: null,
    lastProgressAt: new Date().toISOString(),
    stopReason: null,
    ...overrides,
  };
}

describe("mission.model", () => {
  it.each([
    [{ state: "queued", reviewStatus: "none" }, "received"],
    [{ state: "init", reviewStatus: "none" }, "received"],
    [{ state: "plan", reviewStatus: "plan_pending" }, "plan_review"],
    [{ state: "plan", reviewStatus: "approved" }, "planning"],
    [{ state: "execute", reviewStatus: "none" }, "coding"],
    [{ state: "reflect", reviewStatus: "none" }, "coding"],
    [{ state: "retry", reviewStatus: "none" }, "coding"],
    [{ state: "verify", reviewStatus: "none" }, "verifying"],
    [{ state: "paused", reviewStatus: "none" }, "paused"],
    [{ state: "done", reviewStatus: "approved" }, "completed"],
    [{ state: "failed", reviewStatus: "rejected" }, "failed"],
    [{ state: "stopped", reviewStatus: "rejected" }, "cancelled"],
  ] as const)("maps session state %j to mission state %s", (overrides, expectedState) => {
    const mission = toMissionModel(createSession(overrides));
    expect(mission.state).toBe(expectedState);
    expect(mission.currentPhase).toBe(overrides.state);
  });

  it("derives plan_review from reviewStatus and keeps review metadata", () => {
    const mission = toMissionModel(
      createSession({
        state: "plan",
        reviewStatus: "plan_pending",
        reviewUpdatedAt: "2026-03-11T12:06:00.000Z",
      }),
    );

    expect(mission.state).toBe("plan_review");
    expect(mission.reviewStatus).toBe("plan_pending");
    expect(mission.reviewUpdatedAt).toBe("2026-03-11T12:06:00.000Z");
  });

  it("parses structured plan content into MissionPlan", () => {
    const mission = toMissionModel(createSession());

    expect(mission.plan).toEqual({
      raw: expect.stringContaining("# Plan Review"),
      objective: "Implement the persistence layer",
      scope: ["src", "docs"],
      currentPhase: "plan",
      currentModel: "claude-opus-4-5-thinking",
      proposedSteps: ["Define the domain model", "Add in-memory repository"],
      expectedTouchPoints: [
        "src/models/mission.model.ts",
        "src/repositories/mission.repository.ts",
      ],
      risks: [
        "Strict gate validation remains enabled.",
        "Repository must stay DB-ready.",
      ],
      nextAction: "Await approval.",
    });
  });

  it("normalizes gate results, artifacts, and timeline entries", () => {
    const gateResult = createGateResult({ blockingIssues: ["none"] });
    const mission = toMissionModel(
      createSession({
        artifacts: {
          plan: "## Objective\nFallback plan",
          changeSummary: "Summary",
          nextActionReason: "Next step",
          gateResult,
          rawResponses: ["raw-1", "raw-2"],
          contextPack: "ctx",
        },
        timeline: [
          {
            cycle: 1,
            state: "plan",
            taskId: "task-1",
            note: "Plan generated",
            timestamp: "2026-03-11T12:01:00.000Z",
          },
          {
            cycle: 2,
            state: "execute",
            taskId: "task-2",
            note: "Execution started",
            timestamp: "2026-03-11T12:02:00.000Z",
          },
        ],
      }),
    );

    expect(mission.gateResults).toEqual([gateResult]);
    expect(mission.timeline).toEqual([
      {
        id: "aut_001:timeline:0",
        cycle: 1,
        state: "plan",
        taskId: "task-1",
        note: "Plan generated",
        timestamp: "2026-03-11T12:01:00.000Z",
      },
      {
        id: "aut_001:timeline:1",
        cycle: 2,
        state: "execute",
        taskId: "task-2",
        note: "Execution started",
        timestamp: "2026-03-11T12:02:00.000Z",
      },
    ]);
    expect(mission.artifacts.map((artifact) => artifact.kind)).toEqual([
      "plan",
      "change_summary",
      "next_action_reason",
      "context_pack",
      "raw_response",
      "raw_response",
      "gate_result",
    ]);
  });

  it("returns null for empty plan payloads", () => {
    expect(parseMissionPlan("   ")).toBeNull();
  });
});
