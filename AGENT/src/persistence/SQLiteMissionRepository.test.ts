import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AutonomySession, GateResult } from "../orchestration/autonomy-types";
import type { MissionModel } from "../models/mission.model";
import { MissionDatabase } from "./database";
import { SQLiteMissionRepository } from "./SQLiteMissionRepository";
import { MissionRepositoryError } from "../repositories/mission.repository";

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Persist missions to SQLite",
    account: "engineer@example.com",
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:00:00.000Z",
    state: "received",
    currentPhase: "init",
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
    touchedFiles: [],
    completedAt: null,
    error: null,
    lastProgressAt: new Date().toISOString(),
    stopReason: null,
    ...overrides,
  };
}

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
    timestamp: "2026-03-12T10:05:00.000Z",
    ...overrides,
  };
}

function createRuntimeSnapshot(overrides: Partial<AutonomySession> = {}): AutonomySession {
  return {
    id: "mission-1",
    objective: "Persist missions to SQLite",
    account: "engineer@example.com",
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
    updatedAt: "2026-03-12T10:04:00.000Z",
    cycleCount: 1,
    maxCycles: 5,
    maxDurationMs: 60_000,
    queuePosition: null,
    budgets: createMission().budget,
    consecutiveGateFailures: 0,
    branchName: null,
    baseBranch: null,
    commitHash: null,
    touchedFiles: ["src/example.ts"],
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
    lastProgressAt: new Date().toISOString(),
    stopReason: null,
    ...overrides,
  };
}

describe("SQLiteMissionRepository", () => {
  const cleanupPaths = new Set<string>();

  afterEach(async () => {
    for (const dbPath of cleanupPaths) {
      try {
        await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
    cleanupPaths.clear();
  });

  async function createSubject() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sovereign-sqlite-repo-"));
    const dbPath = path.join(dir, "missions.db");
    cleanupPaths.add(dbPath);
    const database = new MissionDatabase({ dbPath });
    return {
      database,
      repository: new SQLiteMissionRepository(database),
    };
  }

  it("persists create -> findById round-trip", async () => {
    const { database, repository } = await createSubject();
    await repository.create(createMission());

    const mission = await repository.findById("mission-1");
    expect(mission?.prompt).toBe("Persist missions to SQLite");
    expect(mission?.scopePaths).toEqual(["src"]);
    database.close();
  });

  it("updates only the provided fields and refreshes updatedAt", async () => {
    const { database, repository } = await createSubject();
    await repository.create(createMission());

    const updated = await repository.update("mission-1", {
      state: "coding",
      touchedFiles: ["src/runtime.ts"],
      budget: {
        ...createMission().budget,
        warning: true,
        warningReason: "TPM nearing limit",
      },
    });

    expect(updated.state).toBe("coding");
    expect(updated.touchedFiles).toEqual(["src/runtime.ts"]);
    expect(updated.budget.warning).toBe(true);
    expect(updated.updatedAt).not.toBe("2026-03-12T10:00:00.000Z");
    database.close();
  });

  it("finds only interrupted non-terminal missions ordered by updatedAt desc", async () => {
    const { database, repository } = await createSubject();
    await repository.create(createMission({ id: "m-1", state: "completed", updatedAt: "2026-03-12T10:00:00.000Z" }));
    await repository.create(createMission({ id: "m-2", state: "coding", updatedAt: "2026-03-12T11:00:00.000Z" }));
    await repository.create(createMission({ id: "m-3", state: "planning", updatedAt: "2026-03-12T12:00:00.000Z" }));

    const interrupted = await repository.findInterrupted();
    expect(interrupted.map((mission) => mission.id)).toEqual(["m-3", "m-2"]);
    database.close();
  });

  it("stores timeline events with cursor pagination", async () => {
    const { database, repository } = await createSubject();
    await repository.create(createMission());

    await repository.saveEvent("mission-1", {
      type: "state",
      sessionId: "mission-1",
      timestamp: "2026-03-12T10:01:00.000Z",
      payload: { state: "plan" },
    });
    await repository.saveEvent("mission-1", {
      type: "budget",
      sessionId: "mission-1",
      timestamp: "2026-03-12T10:02:00.000Z",
      payload: { warning: true },
    });
    await repository.saveEvent("mission-1", {
      type: "artifact",
      sessionId: "mission-1",
      timestamp: "2026-03-12T10:03:00.000Z",
      payload: { type: "plan" },
    });

    const firstPage = await repository.getTimeline("mission-1", undefined, 2);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await repository.getTimeline("mission-1", firstPage.nextCursor ?? undefined, 2);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.type).toBe("mission.artifact");
    database.close();
  });

  it("stores gate results, budget snapshots, and runtime snapshots", async () => {
    const { database, repository } = await createSubject();
    await repository.create(createMission());

    await repository.saveGateResult("mission-1", createGateResult(), {
      eventHash: "gate-hash",
      phase: "verify",
    });
    await repository.saveBudgetSnapshot(
      "mission-1",
      {
        ...createMission().budget,
        usage: {
          ...createMission().budget.usage,
          currentTPM: 1200,
          requestsUsed: 5,
        },
      },
      { eventHash: "budget-hash" },
    );
    await repository.saveRuntimeSnapshot("mission-1", createRuntimeSnapshot());

    const gateResults = await repository.getGateResults("mission-1");
    const latestBudget = await repository.getLatestBudget("mission-1");
    const snapshot = await repository.getRuntimeSnapshot("mission-1");

    expect(gateResults).toHaveLength(1);
    expect(gateResults[0]?.phase).toBe("verify");
    expect(latestBudget?.usage.currentTPM).toBe(1200);
    expect(snapshot?.touchedFiles).toEqual(["src/example.ts"]);
    database.close();
  });

  it("ignores duplicate event hashes for event persistence", async () => {
    const { database, repository } = await createSubject();
    await repository.create(createMission());

    const event = {
      type: "state" as const,
      sessionId: "mission-1",
      timestamp: "2026-03-12T10:01:00.000Z",
      payload: { state: "plan" },
    };

    await repository.saveEvent("mission-1", event, { eventHash: "dup-hash" });
    await repository.saveEvent("mission-1", event, { eventHash: "dup-hash" });

    const timeline = await repository.getTimeline("mission-1");
    expect(timeline.items).toHaveLength(1);
    database.close();
  });

  it("wraps sync driver failures into MissionRepositoryError for every public method", async () => {
    const { database, repository } = await createSubject();
    database.close();

    const cases: Array<{
      name: string;
      run: () => Promise<unknown>;
    }> = [
      {
        name: "create",
        run: () => repository.create(createMission({ id: "mission-create" })),
      },
      {
        name: "findById",
        run: () => repository.findById("mission-1"),
      },
      {
        name: "update",
        run: () => repository.update("mission-1", { state: "coding" }),
      },
      {
        name: "list",
        run: () => repository.list(),
      },
      {
        name: "saveGateResult",
        run: () =>
          repository.saveGateResult("mission-1", createGateResult(), {
            eventHash: "gate-closed-db",
            phase: "verify",
          }),
      },
      {
        name: "getGateResults",
        run: () => repository.getGateResults("mission-1"),
      },
      {
        name: "saveEvent",
        run: () =>
          repository.saveEvent("mission-1", {
            type: "state",
            sessionId: "mission-1",
            timestamp: "2026-03-12T10:01:00.000Z",
            payload: { state: "plan" },
          }),
      },
      {
        name: "getTimeline",
        run: () => repository.getTimeline("mission-1"),
      },
      {
        name: "saveBudgetSnapshot",
        run: () =>
          repository.saveBudgetSnapshot("mission-1", createMission().budget, {
            eventHash: "budget-closed-db",
          }),
      },
      {
        name: "getLatestBudget",
        run: () => repository.getLatestBudget("mission-1"),
      },
      {
        name: "saveRuntimeSnapshot",
        run: () => repository.saveRuntimeSnapshot("mission-1", createRuntimeSnapshot()),
      },
      {
        name: "getRuntimeSnapshot",
        run: () => repository.getRuntimeSnapshot("mission-1"),
      },
      {
        name: "findInterrupted",
        run: () => repository.findInterrupted(),
      },
    ];

    for (const testCase of cases) {
      await expect(testCase.run(), testCase.name).rejects.toMatchObject({
        name: "MissionRepositoryError",
        code: "MISSION_PERSISTENCE_ERROR",
        cause: expect.any(Error),
      } satisfies Partial<MissionRepositoryError>);
    }
  });
});
