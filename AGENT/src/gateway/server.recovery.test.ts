import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayServer } from "./server";
import { InMemoryMissionRepository } from "../repositories/mission.repository";
import { NoopRecoveryNotifier } from "../persistence/recovery/RecoveryNotifier";
import type { MissionModel } from "../models/mission.model";
import type { AutonomySession } from "../orchestration/autonomy-types";

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Recover gateway mission",
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

function createSnapshot(): AutonomySession {
  return {
    id: "mission-1",
    objective: "Recover gateway mission",
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

describe("GatewayServer recovery routes", () => {
  const authToken = "test-gateway-token";
  let gateway: GatewayServer | null = null;
  let tmpDir = "";
  let port = 0;
  let repository: InMemoryMissionRepository;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lojinext-gateway-recovery-"));
    port = await getFreePort();
    repository = new InMemoryMissionRepository();
    await repository.create(createMission());
    await repository.saveRuntimeSnapshot("mission-1", createSnapshot());

    gateway = new GatewayServer({
      port,
      projectRoot: tmpDir,
      authToken,
      host: "127.0.0.1",
      missionRepository: repository,
      recoveryNotifier: new NoopRecoveryNotifier(),
    });
    await gateway.start();
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
      gateway = null;
    }
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("lists pending recoveries and allows cancel", async () => {
    const pendingResponse = await fetch(`http://127.0.0.1:${port}/api/autonomy/recovery/pending`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(pendingResponse.status).toBe(200);
    const pendingBody = (await pendingResponse.json()) as { data?: Array<{ missionId: string }> };
    expect(pendingBody.data?.[0]?.missionId).toBe("mission-1");

    const cancelResponse = await fetch(
      `http://127.0.0.1:${port}/api/autonomy/recovery/mission-1/cancel`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    expect(cancelResponse.status).toBe(200);

    const mission = await repository.findById("mission-1");
    expect(mission?.state).toBe("cancelled");
  });
});
