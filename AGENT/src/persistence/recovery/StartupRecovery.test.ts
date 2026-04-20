import { describe, expect, it, vi } from "vitest";
import { InMemoryMissionRepository } from "../../repositories/mission.repository";
import { StartupRecoveryCoordinator } from "./StartupRecovery";
import type { MissionModel } from "../../models/mission.model";
import type { AutonomySession } from "../../orchestration/autonomy-types";

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Recover interrupted mission",
    account: "dev@example.com",
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:05:00.000Z",
    state: "coding",
    currentPhase: "execute",
    currentGear: "standard",
    currentModel: "gemini-3-pro-high",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    scopePaths: ["src"],
    strictMode: true,
    anchorModel: "gemini-3-pro-high",
    gateResults: [],
    plan: null,
    timeline: [],
    artifacts: [],
    budget: {
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
    touchedFiles: ["src/file.ts"],
    completedAt: null,
    error: null,
    stopReason: null,
    ...overrides,
    lastProgressAt: overrides.lastProgressAt ?? "2026-03-12T10:05:00.000Z",
  };
}

function createSnapshot(id = "mission-1"): AutonomySession {
  return {
    id,
    objective: "Recover interrupted mission",
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
    budgets: createMission().budget,
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
      plan: "",
      changeSummary: "",
      nextActionReason: "",
      gateResult: null,
      rawResponses: [],
      contextPack: "",
    },
    lastProgressAt: "2026-03-12T10:05:00.000Z",
    error: null,
    stopReason: null,
  };
}

describe("StartupRecoveryCoordinator", () => {
  it("returns no pending recoveries when no interrupted mission exists", async () => {
    const repository = new InMemoryMissionRepository();
    const sessions = {
      hydrateSession: vi.fn(),
      resumeRecoveredSession: vi.fn(),
    };
    const recovery = new StartupRecoveryCoordinator(repository, sessions);

    const pending = await recovery.scanInterrupted();

    expect(pending).toEqual([]);
  });

  it("scans, resumes, and cancels interrupted missions", async () => {
    const repository = new InMemoryMissionRepository();
    const sessions = {
      hydrateSession: vi.fn(),
      resumeRecoveredSession: vi.fn().mockReturnValue(true),
    };
    await repository.create(createMission());
    await repository.create(
      createMission({
        id: "mission-2",
        prompt: "Second pending mission",
        state: "planning",
        currentPhase: "plan",
        updatedAt: "2026-03-12T10:06:00.000Z",
      }),
    );
    await repository.saveRuntimeSnapshot("mission-1", createSnapshot("mission-1"));
    await repository.saveRuntimeSnapshot("mission-2", createSnapshot("mission-2"));

    const recovery = new StartupRecoveryCoordinator(repository, sessions);
    const pending = await recovery.scanInterrupted();

    expect(pending.map((entry) => entry.missionId)).toEqual(["mission-2", "mission-1"]);

    const resumed = await recovery.resumeRecovery("mission-1");
    expect(resumed).toBe(true);
    expect(sessions.hydrateSession).toHaveBeenCalledWith(expect.objectContaining({ id: "mission-1" }));
    expect(sessions.resumeRecoveredSession).toHaveBeenCalledWith("mission-1");

    const cancelled = await recovery.cancelRecovery("mission-2");
    expect(cancelled).toBe(true);

    const mission = await repository.findById("mission-2");
    expect(mission?.state).toBe("cancelled");
    expect(mission?.currentPhase).toBe("stopped");
    expect(mission?.completedAt).not.toBeNull();
  });

  it("recovers interrupted missions after process-level kill without runtime terminal event", async () => {
    const repository = new InMemoryMissionRepository();
    const sessions = {
      hydrateSession: vi.fn(),
      resumeRecoveredSession: vi.fn().mockReturnValue(true),
    };

    await repository.create(
      createMission({
        id: "mission-sigkill",
        prompt: "Simulated SIGKILL crash recovery",
        state: "coding",
        currentPhase: "execute",
      }),
    );
    await repository.saveRuntimeSnapshot("mission-sigkill", createSnapshot("mission-sigkill"));

    const recovery = new StartupRecoveryCoordinator(repository, sessions);
    const pending = await recovery.scanInterrupted();

    expect(pending.map((item) => item.missionId)).toContain("mission-sigkill");

    const resumed = await recovery.resumeRecovery("mission-sigkill");
    expect(resumed).toBe(true);
    expect(sessions.hydrateSession).toHaveBeenCalledWith(expect.objectContaining({ id: "mission-sigkill" }));
    expect(sessions.resumeRecoveredSession).toHaveBeenCalledWith("mission-sigkill");
  });
});
