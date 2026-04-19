import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissionModel } from "../../models/mission.model";
import type {
  AutonomySession,
  AutonomyState,
  BudgetStatus,
} from "../../orchestration/autonomy-types";
import { phaseEngine } from "../../orchestration/PhaseEngine";
import { GatewayAuthManager } from "../../gateway/gateway-auth-manager";
import {
  createApproveAuthMiddleware,
  registerFormatWrapperMiddleware,
} from "../../gateway/rest-middleware";
import { apiError } from "../../gateway/rest-response";
import { InMemoryMissionRepository } from "../../repositories/mission.repository";
import type { MissionRuntime } from "../../services/mission-runtime";
import { MissionService } from "../../services/mission.service";
import { InMemoryUnitOfWork } from "../../uow/unit-of-work";
import { registerMissionRoutes } from "./mission.router";

type RuntimeMock = {
  startMission: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  pauseMission: ReturnType<typeof vi.fn>;
  resumeMission: ReturnType<typeof vi.fn>;
  cancelMission: ReturnType<typeof vi.fn>;
} & MissionRuntime;

function createBudget(overrides: Partial<BudgetStatus> = {}): BudgetStatus {
  return {
    limits: {
      maxCycles: 12,
      maxDurationMs: 45 * 60 * 1000,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 400_000,
      maxTPM: 1_000_000,
      maxRPD: 5_000,
      maxUsd: 0,
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
    ...overrides,
  };
}

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Illegal transition probe",
    account: "engineer@example.com",
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:05:00.000Z",
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
    budget: createBudget(),
    touchedFiles: [],
    completedAt: null,
    error: null,
    stopReason: null,
    ...overrides,
    lastProgressAt: overrides.lastProgressAt ?? "2026-03-12T10:05:00.000Z",
  };
}

function mapMissionStateToAutonomyState(state: MissionModel["state"]): AutonomyState {
  switch (state) {
    case "received":
      return "init";
    case "planning":
    case "plan_review":
      return "plan";
    case "coding":
      return "execute";
    case "verifying":
      return "verify";
    case "paused":
      return "paused";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
  }
}

function toMinimalAutonomySession(mission: MissionModel): AutonomySession {
  return {
    id: mission.id,
    objective: mission.prompt,
    account: mission.account,
    anchorModel: mission.anchorModel,
    modelPolicy: "smart_multi",
    gitMode: "patch_only",
    startMode: "immediate",
    scope: { mode: "selected_only", paths: [...mission.scopePaths] },
    strictMode: mission.strictMode,
    state: mission.currentPhase ?? mapMissionStateToAutonomyState(mission.state),
    reviewAfterPlan: mission.reviewStatus === "plan_pending",
    currentModel: mission.currentModel,
    currentGear: mission.currentGear,
    reviewStatus: mission.reviewStatus,
    reviewUpdatedAt: mission.reviewUpdatedAt,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    cycleCount: mission.timeline.at(-1)?.cycle ?? 0,
    maxCycles: mission.budget.limits.maxCycles,
    maxDurationMs: mission.budget.limits.maxDurationMs,
    queuePosition: null,
    budgets: structuredClone(mission.budget),
    consecutiveGateFailures: 0,
    branchName: null,
    baseBranch: null,
    commitHash: null,
    touchedFiles: [...mission.touchedFiles],
    baselineDirtyFiles: [],
    modelHistory: [],
    timeline: mission.timeline.map((entry) => ({
      cycle: entry.cycle,
      state: entry.state,
      taskId: entry.taskId,
      note: entry.note,
      timestamp: entry.timestamp,
    })),
    opLog: [],
    taskGraph: [],
    artifacts: {
      plan: mission.plan?.raw ?? "",
      changeSummary: "",
      nextActionReason: "",
      gateResult: mission.gateResults.at(-1) ?? null,
      rawResponses: [],
      contextPack: "",
    },
    lastProgressAt: mission.updatedAt,
    error: mission.error,
    stopReason: mission.stopReason,
  };
}

function createRuntimeMock(): RuntimeMock {
  return {
    startMission: vi.fn(),
    getSession: vi.fn().mockReturnValue(null),
    pauseMission: vi.fn().mockReturnValue(false),
    resumeMission: vi.fn().mockReturnValue(false),
    cancelMission: vi.fn().mockReturnValue(false),
  } as unknown as RuntimeMock;
}

function registerRawPhaseTransitionHarness(
  app: FastifyInstance,
  repository: InMemoryMissionRepository,
): void {
  app.post<{ Params: { id: string; nextState: string } }>(
    "/api/test/phase-transition/:id/:nextState",
    async (request, reply) => {
      const mission = await repository.findById(request.params.id);
      if (!mission) {
        return reply.status(404).send(
          apiError("Mission not found", {
            code: "MISSION_NOT_FOUND",
          }),
        );
      }

      try {
        phaseEngine.validateTransition(
          toMinimalAutonomySession(mission),
          request.params.nextState as AutonomyState,
          null,
        );
        return { ok: true };
      } catch (error) {
        return reply.status(422).send(
          apiError(error instanceof Error ? error.message : "Illegal transition", {
            code: "INVALID_STATE_TRANSITION",
          }),
        );
      }
    },
  );
}

async function createRealApp(): Promise<{
  app: FastifyInstance;
  repository: InMemoryMissionRepository;
  runtime: RuntimeMock;
}> {
  const app = fastify();
  const repository = new InMemoryMissionRepository();
  const runtime = createRuntimeMock();
  const missionService = new MissionService(
    new InMemoryUnitOfWork({ repository }),
    runtime,
  );
  const authManager = new GatewayAuthManager("approve-token");

  registerFormatWrapperMiddleware(app);
  registerMissionRoutes(app, {
    missionService,
    resolveActiveMissionAccount: async () => "engineer@example.com",
    approveAuth: createApproveAuthMiddleware(authManager),
    isQuotaStateReady: () => true,
  });
  registerRawPhaseTransitionHarness(app, repository);
  await app.ready();

  return {
    app,
    repository,
    runtime,
  };
}

let appToClose: FastifyInstance | null = null;

afterEach(async () => {
  if (appToClose) {
    await appToClose.close();
    appToClose = null;
  }
});

describe("Gateway illegal transition proofs", () => {
  it("maps cancelled missions to stopped autonomy sessions for raw phase validation", () => {
    const session = toMinimalAutonomySession(
      createMission({
        state: "cancelled",
        currentPhase: null,
      }),
    );

    expect(session.state).toBe("stopped");
  });

  it.each([
    {
      label: "init -> done",
      mission: createMission({ id: "mission-init-done", state: "received", currentPhase: "init" }),
      nextState: "done",
    },
    {
      label: "plan -> verify",
      mission: createMission({
        id: "mission-plan-verify",
        state: "planning",
        currentPhase: "plan",
      }),
      nextState: "verify",
    },
    {
      label: "execute -> done",
      mission: createMission({
        id: "mission-execute-done",
        state: "coding",
        currentPhase: "execute",
      }),
      nextState: "done",
    },
    {
      label: "stopped -> execute",
      mission: createMission({
        id: "mission-stopped-execute",
        state: "cancelled",
        currentPhase: "stopped",
      }),
      nextState: "execute",
    },
    {
      label: "failed -> execute",
      mission: createMission({
        id: "mission-failed-execute",
        state: "failed",
        currentPhase: "failed",
        error: "mission failed",
      }),
      nextState: "execute",
    },
    {
      label: "cancelled -> execute",
      mission: createMission({
        id: "mission-cancelled-execute",
        state: "cancelled",
        currentPhase: null,
      }),
      nextState: "execute",
    },
  ])("rejects raw gateway transition $label with INVALID_STATE_TRANSITION", async ({
    mission,
    nextState,
  }) => {
    const { app, repository } = await createRealApp();
    appToClose = app;
    await repository.create(mission);

    const response = await app.inject({
      method: "POST",
      url: `/api/test/phase-transition/${mission.id}/${nextState}`,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
  });

  it.each([
    createMission({ id: "approve-init", state: "received", currentPhase: "init" }),
    createMission({ id: "approve-execute", state: "coding", currentPhase: "execute" }),
    createMission({
      id: "approve-failed",
      state: "failed",
      currentPhase: "failed",
      error: "mission failed",
    }),
    createMission({
      id: "approve-cancelled",
      state: "cancelled",
      currentPhase: "stopped",
    }),
  ])("rejects public approve outside plan review for mission $id", async (mission) => {
    const { app, repository, runtime } = await createRealApp();
    appToClose = app;
    await repository.create(mission);

    const response = await app.inject({
      method: "POST",
      url: `/api/missions/${mission.id}/approve`,
      headers: { authorization: "Bearer approve-token" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(runtime.resumeMission).not.toHaveBeenCalled();
  });

  it.each([
    createMission({
      id: "pause-paused",
      state: "paused",
      currentPhase: "paused",
    }),
    createMission({
      id: "pause-failed",
      state: "failed",
      currentPhase: "failed",
      error: "mission failed",
    }),
    createMission({
      id: "pause-completed",
      state: "completed",
      currentPhase: "done",
      completedAt: "2026-03-12T10:06:00.000Z",
    }),
    createMission({
      id: "pause-cancelled",
      state: "cancelled",
      currentPhase: "stopped",
    }),
  ])("rejects public pause for mission $id", async (mission) => {
    const { app, repository, runtime } = await createRealApp();
    appToClose = app;
    await repository.create(mission);

    const response = await app.inject({
      method: "POST",
      url: `/api/missions/${mission.id}/pause`,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(runtime.pauseMission).not.toHaveBeenCalled();
  });

  it.each([
    createMission({
      id: "resume-failed",
      state: "failed",
      currentPhase: "failed",
      error: "mission failed",
    }),
    createMission({
      id: "resume-cancelled",
      state: "cancelled",
      currentPhase: "stopped",
    }),
  ])("rejects public resume for mission $id", async (mission) => {
    const { app, repository, runtime } = await createRealApp();
    appToClose = app;
    await repository.create(mission);

    const response = await app.inject({
      method: "POST",
      url: `/api/missions/${mission.id}/resume`,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(runtime.resumeMission).not.toHaveBeenCalled();
  });

  it.each([
    createMission({
      id: "cancel-failed",
      state: "failed",
      currentPhase: "failed",
      error: "mission failed",
    }),
    createMission({
      id: "cancel-completed",
      state: "completed",
      currentPhase: "done",
      completedAt: "2026-03-12T10:06:00.000Z",
    }),
    createMission({
      id: "cancel-cancelled",
      state: "cancelled",
      currentPhase: "stopped",
    }),
  ])("rejects public cancel for mission $id", async (mission) => {
    const { app, repository, runtime } = await createRealApp();
    appToClose = app;
    await repository.create(mission);

    const response = await app.inject({
      method: "POST",
      url: `/api/missions/${mission.id}/cancel`,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(runtime.cancelMission).not.toHaveBeenCalled();
  });

  it("rejects every public action for cancelled missions with INVALID_STATE_TRANSITION", async () => {
    const { app, repository, runtime } = await createRealApp();
    appToClose = app;
    await repository.create(
      createMission({
        id: "cancelled-all-actions",
        state: "cancelled",
        currentPhase: "stopped",
      }),
    );

    const approve = await app.inject({
      method: "POST",
      url: "/api/missions/cancelled-all-actions/approve",
      headers: { authorization: "Bearer approve-token" },
    });
    const pause = await app.inject({
      method: "POST",
      url: "/api/missions/cancelled-all-actions/pause",
    });
    const resume = await app.inject({
      method: "POST",
      url: "/api/missions/cancelled-all-actions/resume",
    });
    const cancel = await app.inject({
      method: "POST",
      url: "/api/missions/cancelled-all-actions/cancel",
    });

    expect(approve.statusCode).toBe(422);
    expect(pause.statusCode).toBe(422);
    expect(resume.statusCode).toBe(422);
    expect(cancel.statusCode).toBe(422);
    expect(approve.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(pause.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(resume.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(cancel.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
    expect(runtime.pauseMission).not.toHaveBeenCalled();
    expect(runtime.resumeMission).not.toHaveBeenCalled();
    expect(runtime.cancelMission).not.toHaveBeenCalled();
  });
});
