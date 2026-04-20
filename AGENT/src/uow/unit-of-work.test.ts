import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MissionModel } from "../models/mission.model";
import { MissionDatabase } from "../persistence/database";
import { SQLiteMissionRepository } from "../persistence/SQLiteMissionRepository";
import { InMemoryMissionRepository } from "../repositories/mission.repository";
import { InMemoryUnitOfWork, SQLiteUnitOfWork } from "./unit-of-work";

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Add UnitOfWork boundary",
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

describe("UnitOfWork", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
    cleanupDirs.clear();
  });

  it("creates isolated in-memory repositories per unit of work instance", async () => {
    const first = new InMemoryUnitOfWork();
    const second = new InMemoryUnitOfWork();

    expect(first.missions).toBeInstanceOf(InMemoryMissionRepository);
    expect(second.missions).toBeInstanceOf(InMemoryMissionRepository);

    await first.missions.create(createMission({ id: "mission-a" }));

    await expect(second.missions.findById("mission-a")).resolves.toBeNull();
  });

  it("provides a SQLite-backed repository when given a database", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sovereign-uow-"));
    cleanupDirs.add(dir);

    const database = new MissionDatabase({ dbPath: path.join(dir, "missions.db") });
    const uow = new SQLiteUnitOfWork({ database });

    expect(uow.missions).toBeInstanceOf(SQLiteMissionRepository);

    await uow.missions.create(createMission({ id: "mission-sqlite" }));
    await expect(uow.missions.findById("mission-sqlite")).resolves.toMatchObject({
      id: "mission-sqlite",
    });

    database.close();
  });

  it("allows repeated complete and rollback calls for both concrete implementations", async () => {
    const memory = new InMemoryUnitOfWork();
    await expect(memory.complete()).resolves.toBeUndefined();
    await expect(memory.complete()).resolves.toBeUndefined();
    await expect(memory.rollback()).resolves.toBeUndefined();
    await expect(memory.rollback()).resolves.toBeUndefined();

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sovereign-uow-"));
    cleanupDirs.add(dir);

    const database = new MissionDatabase({ dbPath: path.join(dir, "missions.db") });
    const sqlite = new SQLiteUnitOfWork({ database });
    await expect(sqlite.complete()).resolves.toBeUndefined();
    await expect(sqlite.complete()).resolves.toBeUndefined();
    await expect(sqlite.rollback()).resolves.toBeUndefined();
    await expect(sqlite.rollback()).resolves.toBeUndefined();

    database.close();
  });
});
