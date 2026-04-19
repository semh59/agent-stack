import { describe, expect, it } from "vitest";
import type { MissionModel } from "../models/mission.model";
import {
  InMemoryMissionRepository,
  MissionRepositoryError,
} from "./mission.repository";

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Implement persistence layer",
    account: "engineer@example.com",
    createdAt: "2026-03-11T12:00:00.000Z",
    updatedAt: "2026-03-11T12:00:00.000Z",
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
        maxInputTokens: 10_000,
        maxOutputTokens: 5_000,
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
    stopReason: null,
    ...overrides,
    lastProgressAt: overrides.lastProgressAt ?? "2026-03-12T10:05:00.000Z",
  };
}

describe("InMemoryMissionRepository", () => {
  it("stores missions and returns cloned records from create/findById", async () => {
    const repository = new InMemoryMissionRepository();
    const created = await repository.create(createMission());
    created.prompt = "mutated";

    const found = await repository.findById("mission-1");

    expect(found).not.toBeNull();
    expect(found?.prompt).toBe("Implement persistence layer");

    found!.scopePaths.push("ui");
    const refetched = await repository.findById("mission-1");
    expect(refetched?.scopePaths).toEqual(["src"]);
  });

  it("throws a conflict-style error when the id already exists", async () => {
    const repository = new InMemoryMissionRepository();
    await repository.create(createMission());

    await expect(repository.create(createMission())).rejects.toMatchObject({
      name: "MissionRepositoryError",
      code: "MISSION_ALREADY_EXISTS",
    } satisfies Partial<MissionRepositoryError>);
  });

  it("throws a not-found-style error when updating a missing mission", async () => {
    const repository = new InMemoryMissionRepository();

    await expect(repository.update("missing", { state: "paused" })).rejects.toMatchObject({
      name: "MissionRepositoryError",
      code: "MISSION_NOT_FOUND",
    } satisfies Partial<MissionRepositoryError>);
  });

  it("replaces nested objects and arrays on update and refreshes updatedAt", async () => {
    const repository = new InMemoryMissionRepository();
    await repository.create(
      createMission({
        gateResults: [
          {
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
            timestamp: "2026-03-11T12:00:00.000Z",
          },
        ],
        artifacts: [
          {
            id: "artifact-1",
            kind: "plan",
            createdAt: "2026-03-11T12:00:00.000Z",
            value: "old-plan",
          },
        ],
      }),
    );

    const updated = await repository.update("mission-1", {
      gateResults: [],
      artifacts: [
        {
          id: "artifact-2",
          kind: "change_summary",
          createdAt: "2026-03-11T12:05:00.000Z",
          value: "new-summary",
        },
      ],
      plan: {
        raw: "# Plan Review",
        objective: "Implement persistence layer",
        scope: ["src", "docs"],
        currentPhase: "plan",
        currentModel: "gemini-3-pro-high",
        proposedSteps: ["step-1"],
        expectedTouchPoints: ["src/models/mission.model.ts"],
        risks: ["none"],
        nextAction: "continue",
      },
    });

    expect(updated.gateResults).toEqual([]);
    expect(updated.artifacts).toEqual([
      {
        id: "artifact-2",
        kind: "change_summary",
        createdAt: "2026-03-11T12:05:00.000Z",
        value: "new-summary",
      },
    ]);
    expect(updated.plan?.scope).toEqual(["src", "docs"]);
    expect(updated.id).toBe("mission-1");
    expect(updated.createdAt).toBe("2026-03-11T12:00:00.000Z");
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse("2026-03-11T12:00:00.000Z"),
    );
  });

  it("lists missions newest-first", async () => {
    const repository = new InMemoryMissionRepository();
    await repository.create(createMission({ id: "mission-older", createdAt: "2026-03-11T10:00:00.000Z" }));
    await repository.create(createMission({ id: "mission-newest", createdAt: "2026-03-11T14:00:00.000Z" }));
    await repository.create(createMission({ id: "mission-middle", createdAt: "2026-03-11T12:00:00.000Z" }));

    const missions = await repository.list();

    expect(missions.map((mission) => mission.id)).toEqual([
      "mission-newest",
      "mission-middle",
      "mission-older",
    ]);
  });

  it("filters by state", async () => {
    const repository = new InMemoryMissionRepository();
    await repository.create(createMission({ id: "mission-a", state: "plan_review" }));
    await repository.create(createMission({ id: "mission-b", state: "completed" }));

    const missions = await repository.list({ state: "plan_review" });

    expect(missions.map((mission) => mission.id)).toEqual(["mission-a"]);
  });

  it("filters by account", async () => {
    const repository = new InMemoryMissionRepository();
    await repository.create(createMission({ id: "mission-a", account: "alpha@example.com" }));
    await repository.create(createMission({ id: "mission-b", account: "beta@example.com" }));

    const missions = await repository.list({ account: "beta@example.com" });

    expect(missions.map((mission) => mission.id)).toEqual(["mission-b"]);
  });

  it("filters by reviewStatus and returns cloned list items", async () => {
    const repository = new InMemoryMissionRepository();
    await repository.create(
      createMission({
        id: "mission-a",
        reviewStatus: "plan_pending",
        scopePaths: ["src"],
      }),
    );
    await repository.create(createMission({ id: "mission-b", reviewStatus: "approved" }));

    const missions = await repository.list({ reviewStatus: "plan_pending" });
    expect(missions.map((mission) => mission.id)).toEqual(["mission-a"]);

    missions[0]!.scopePaths.push("docs");
    const refetched = await repository.findById("mission-a");
    expect(refetched?.scopePaths).toEqual(["src"]);
  });
});
