import { describe, expect, it, vi } from "vitest";
import type {
  MissionArtifact,
  MissionModel,
  MissionPlan,
  MissionTimelinePage,
} from "../models/mission.model";
import { MissionFactory } from "../models/mission-factory";
import type {
  AutonomySession,
  BudgetStatus,
  CreateAutonomySessionRequest,
} from "../orchestration/autonomy-types";
import type { MissionRepository } from "../repositories/mission.repository";
import type { UnitOfWork } from "../uow/unit-of-work";
import { MissionService, MissionServiceError, type CreateMissionInput } from "./mission.service";
import type { MissionRuntime } from "./mission-runtime";

function createRuntimeSession(overrides: Partial<AutonomySession> = {}): AutonomySession {
  return {
    id: "mission-1",
    objective: "Bridge mission control through the service layer",
    account: "engineer@example.com",
    anchorModel: "gemini-3-pro-high",
    modelPolicy: "smart_multi",
    gitMode: "patch_only",
    startMode: "immediate",
    scope: { mode: "selected_only", paths: ["src"] },
    strictMode: true,
    state: "init",
    reviewAfterPlan: true,
    currentModel: "gemini-3-pro-high",
    currentGear: "standard",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:00:00.000Z",
    cycleCount: 0,
    maxCycles: 5,
    maxDurationMs: 60_000,
    queuePosition: null,
    budgets: {
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
    consecutiveGateFailures: 0,
    branchName: null,
    baseBranch: null,
    commitHash: null,
    touchedFiles: [],
    baselineDirtyFiles: [],
    modelHistory: [],
    timeline: [],
    opLog: [],
    taskGraph: [],
    artifacts: {
      plan: "",
      changeSummary: "",
      nextActionReason: "Session initialized",
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

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    ...MissionFactory.fromSession(createRuntimeSession()),
    ...overrides,
  };
}

function createCreateInput(overrides: Partial<CreateMissionInput> = {}): CreateMissionInput {
  return {
    account: "engineer@example.com",
    anchorModel: "gemini-3-pro-high",
    objective: "Bridge mission control through the service layer",
    scope: { mode: "selected_only", paths: ["src"] },
    gitMode: "patch_only",
    ...overrides,
  };
}

function createRepositoryMock(): MissionRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    saveGateResult: vi.fn(),
    getGateResults: vi.fn(),
    saveEvent: vi.fn(),
    getTimeline: vi.fn(),
    saveBudgetSnapshot: vi.fn(),
    getLatestBudget: vi.fn(),
    saveRuntimeSnapshot: vi.fn(),
    getRuntimeSnapshot: vi.fn(),
    findInterrupted: vi.fn(),
  };
}

function createQuotaRepositoryMock(): any {
  return {
    initializeQuotaState: vi.fn().mockResolvedValue({ clearedReservations: 0 }),
    getQuotaUsage: vi.fn(),
    reserveQuota: vi.fn(),
    commitQuota: vi.fn(),
    releaseQuota: vi.fn(),
    releaseQuotaReservationsForSession: vi.fn(),
    purgeExpiredQuotaReservations: vi.fn().mockResolvedValue([]),
  };
}

function createRuntimeMock(): MissionRuntime {
  return {
    startMission: vi.fn(),
    getSession: vi.fn(),
    pauseMission: vi.fn(),
    resumeMission: vi.fn(),
    cancelMission: vi.fn(),
  };
}

function createSubject() {
  const repository = createRepositoryMock();
  const quotaRepository = createQuotaRepositoryMock();
  const runtime = createRuntimeMock();
  const uow: UnitOfWork = {
    missions: repository,
    quotas: quotaRepository,
    complete: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    service: new MissionService(uow, runtime, logger),
    repository,
    runtime,
    uow,
    logger,
  };
}

describe("MissionService", () => {
  it("creates a mission with immediate review defaults and persists the runtime snapshot", async () => {
    const { service, repository, runtime, uow } = createSubject();
    const input = createCreateInput();
    const session = createRuntimeSession();
    const mission = MissionFactory.fromSession(session);

    vi.mocked(runtime.startMission).mockReturnValue(session);
    vi.mocked(repository.create).mockResolvedValue(mission);
    vi.mocked(repository.saveRuntimeSnapshot).mockResolvedValue(undefined);

    await expect(service.create(input)).resolves.toEqual(mission);
    expect(runtime.startMission).toHaveBeenCalledWith({
      ...input,
      objective: input.objective,
      modelPolicy: "smart_multi",
      startMode: "immediate",
      reviewAfterPlan: true,
      strictMode: true,
      maxCycles: undefined,
      maxDurationMs: undefined,
      budgets: undefined,
      taskGraph: undefined,
    } satisfies CreateAutonomySessionRequest);
    expect(repository.create).toHaveBeenCalledWith(mission);
    expect(repository.saveRuntimeSnapshot).toHaveBeenCalledWith(session.id, session);
    expect(uow.complete).toHaveBeenCalledOnce();
    expect(uow.rollback).not.toHaveBeenCalled();
  });

  it("rolls back and rethrows the original persistence error when bootstrap create fails", async () => {
    const { service, repository, runtime, uow, logger } = createSubject();
    const session = createRuntimeSession();
    const failure = new Error("create failed");

    vi.mocked(runtime.startMission).mockReturnValue(session);
    vi.mocked(repository.create).mockRejectedValue(failure);
    vi.mocked(runtime.cancelMission).mockResolvedValue(true);

    await expect(service.create(createCreateInput())).rejects.toThrow("create failed");
    expect(runtime.cancelMission).toHaveBeenCalledWith(session.id, "Persistence bootstrap failed");
    expect(logger.error).not.toHaveBeenCalled();
    expect(uow.complete).not.toHaveBeenCalled();
    expect(uow.rollback).toHaveBeenCalledOnce();
  });

  it("logs orphan runtime sessions when bootstrap persistence fails and cancel also fails", async () => {
    const { service, repository, runtime, uow, logger } = createSubject();
    const session = createRuntimeSession();
    const failure = new Error("create failed");

    vi.mocked(runtime.startMission).mockReturnValue(session);
    vi.mocked(repository.create).mockRejectedValue(failure);
    vi.mocked(runtime.cancelMission).mockResolvedValue(false);

    await expect(service.create(createCreateInput())).rejects.toThrow("create failed");
    expect(logger.error).toHaveBeenCalledOnce();
    expect(String(vi.mocked(logger.error).mock.calls[0]?.[0] ?? "")).toContain("startup recovery may not find it");
    expect(uow.rollback).toHaveBeenCalledOnce();
  });

  it("returns the persisted mission when no live runtime snapshot exists", async () => {
    const { service, repository, runtime, uow } = createSubject();
    const mission = createMission({ state: "planning" });

    vi.mocked(repository.findById).mockResolvedValue(mission);
    vi.mocked(runtime.getSession).mockReturnValue(null);

    await expect(service.getById("mission-1")).resolves.toEqual(mission);
    expect(repository.findById).toHaveBeenCalledWith("mission-1");
    expect(uow.complete).toHaveBeenCalledOnce();
  });

  it("overlays live runtime state on top of persisted data for getById", async () => {
    const { service, repository, runtime } = createSubject();
    const persisted = createMission({ state: "planning", updatedAt: "2026-03-12T10:00:00.000Z" });
    const runtimeSession = createRuntimeSession({
      state: "paused",
      reviewStatus: "plan_pending",
      updatedAt: "2026-03-12T10:05:00.000Z",
      touchedFiles: ["src/changed.ts"],
    });

    vi.mocked(repository.findById).mockResolvedValue(persisted);
    vi.mocked(runtime.getSession).mockReturnValue(runtimeSession);

    await expect(service.getById("mission-1")).resolves.toMatchObject({
      state: "paused",
      reviewStatus: "plan_pending",
      touchedFiles: ["src/changed.ts"],
      updatedAt: "2026-03-12T10:05:00.000Z",
    });
  });

  it("returns the mission plan and throws PLAN_NOT_AVAILABLE when absent", async () => {
    const { service, repository, runtime } = createSubject();
    const plan: MissionPlan = {
      raw: "# Plan",
      objective: "Bridge mission control through the service layer",
      scope: ["src"],
      currentPhase: "plan",
      currentModel: "gemini-3-pro-high",
      proposedSteps: ["step-1"],
      expectedTouchPoints: ["src/services/mission.service.ts"],
      risks: ["none"],
      nextAction: "continue",
    };

    vi.mocked(repository.findById).mockResolvedValue(createMission({ plan }));
    vi.mocked(runtime.getSession).mockReturnValue(null);
    await expect(service.getPlan("mission-1")).resolves.toEqual(plan);

    vi.mocked(repository.findById).mockResolvedValue(createMission({ plan: null }));
    await expect(service.getPlan("mission-1")).rejects.toMatchObject({
      name: "MissionServiceError",
      code: "PLAN_NOT_AVAILABLE",
    } satisfies Partial<MissionServiceError>);
  });

  it("prefers the live runtime budget, then snapshot, then mission row budget", async () => {
    const { service, repository, runtime } = createSubject();
    const runtimeBudget: BudgetStatus = {
      ...createMission().budget,
      usage: {
        ...createMission().budget.usage,
        currentTPM: 800,
      },
    };
    vi.mocked(runtime.getSession).mockReturnValue(createRuntimeSession({ budgets: runtimeBudget }));
    await expect(service.getBudget("mission-1")).resolves.toEqual(runtimeBudget);

    vi.mocked(runtime.getSession).mockReturnValue(null);
    vi.mocked(repository.getLatestBudget).mockResolvedValue({
      ...createMission().budget,
      usage: {
        ...createMission().budget.usage,
        currentTPM: 400,
      },
    });
    await expect(service.getBudget("mission-1")).resolves.toMatchObject({
      usage: { currentTPM: 400 },
    });

    vi.mocked(repository.getLatestBudget).mockResolvedValue(null);
    vi.mocked(repository.findById).mockResolvedValue(
      createMission({
        budget: {
          ...createMission().budget,
          usage: {
            ...createMission().budget.usage,
            currentTPM: 200,
          },
        },
      }),
    );
    await expect(service.getBudget("mission-1")).resolves.toMatchObject({
      usage: { currentTPM: 200 },
    });
  });

  it("throws MISSION_NOT_FOUND when budget sources are all missing", async () => {
    const { service, repository, runtime, uow } = createSubject();
    vi.mocked(runtime.getSession).mockReturnValue(null);
    vi.mocked(repository.getLatestBudget).mockResolvedValue(null);
    vi.mocked(repository.findById).mockResolvedValue(null);

    await expect(service.getBudget("missing")).rejects.toMatchObject({
      name: "MissionServiceError",
      code: "MISSION_NOT_FOUND",
    } satisfies Partial<MissionServiceError>);
    expect(uow.rollback).toHaveBeenCalledOnce();
  });

  it("approves only paused missions waiting for plan review", async () => {
    const { service, repository, runtime, uow } = createSubject();
    const mission = createMission({
      state: "paused",
      currentPhase: "paused",
      reviewStatus: "plan_pending",
    });
    vi.mocked(repository.findById).mockResolvedValue(mission);
    vi.mocked(runtime.getSession).mockReturnValue(null);
    vi.mocked(runtime.resumeMission).mockResolvedValue(true);

    await expect(service.approve("mission-1")).resolves.toBeUndefined();
    expect(runtime.resumeMission).toHaveBeenCalledWith("mission-1", "Plan approved from MissionService");
    expect(uow.complete).toHaveBeenCalledOnce();
  });

  it("rejects resume when the mission is still waiting for plan approval", async () => {
    const { service, repository, runtime, uow } = createSubject();
    vi.mocked(repository.findById).mockResolvedValue(
      createMission({
        state: "paused",
        currentPhase: "paused",
        reviewStatus: "plan_pending",
      }),
    );
    vi.mocked(runtime.getSession).mockReturnValue(null);

    await expect(service.resume("mission-1")).rejects.toMatchObject({
      name: "MissionServiceError",
      code: "INVALID_STATE_TRANSITION",
    } satisfies Partial<MissionServiceError>);
    expect(uow.rollback).toHaveBeenCalledOnce();
  });

  it("rejects pausing queued missions", async () => {
    const { service, repository, runtime } = createSubject();
    vi.mocked(repository.findById).mockResolvedValue(
      createMission({
        state: "received",
        currentPhase: "queued",
      }),
    );
    vi.mocked(runtime.getSession).mockReturnValue(null);

    await expect(service.pause("mission-1")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    } satisfies Partial<MissionServiceError>);
  });

  it("rejects cancelling terminal missions", async () => {
    const { service, repository, runtime } = createSubject();
    vi.mocked(repository.findById).mockResolvedValue(createMission({ state: "completed" }));
    vi.mocked(runtime.getSession).mockReturnValue(null);

    await expect(service.cancel("mission-1")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    } satisfies Partial<MissionServiceError>);
  });

  it("throws MISSION_RUNTIME_ERROR when runtime actions fail after validation", async () => {
    const { service, repository, runtime, uow } = createSubject();
    vi.mocked(repository.findById).mockResolvedValue(createMission({ state: "coding" }));
    vi.mocked(runtime.getSession).mockReturnValue(null);
    vi.mocked(runtime.pauseMission).mockResolvedValue(false);

    await expect(service.pause("mission-1")).rejects.toMatchObject({
      name: "MissionServiceError",
      code: "MISSION_RUNTIME_ERROR",
    } satisfies Partial<MissionServiceError>);
    expect(uow.rollback).toHaveBeenCalledOnce();
  });

  it("pages artifacts with a cursor sorted by createdAt then id", async () => {
    const { service, repository, runtime } = createSubject();
    const artifacts: MissionArtifact[] = [
      {
        id: "artifact-2",
        kind: "change_summary",
        createdAt: "2026-03-12T10:02:00.000Z",
        value: "b",
      },
      {
        id: "artifact-1",
        kind: "plan",
        createdAt: "2026-03-12T10:01:00.000Z",
        value: "a",
      },
      {
        id: "artifact-3",
        kind: "context_pack",
        createdAt: "2026-03-12T10:02:00.000Z",
        value: "c",
      },
    ];

    vi.mocked(repository.findById).mockResolvedValue(createMission({ artifacts }));
    vi.mocked(runtime.getSession).mockReturnValue(null);

    const firstPage = await service.getArtifacts("mission-1", undefined, 2);
    expect(firstPage.items.map((item) => item.id)).toEqual(["artifact-1", "artifact-2"]);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await service.getArtifacts("mission-1", firstPage.nextCursor ?? undefined, 2);
    expect(secondPage.items.map((item) => item.id)).toEqual(["artifact-3"]);
    expect(secondPage.hasMore).toBe(false);
  });

  it("passes timeline cursor reads directly to the repository", async () => {
    const { service, repository, uow } = createSubject();
    const page: MissionTimelinePage = {
      items: [
        {
          id: "event-1",
          missionId: "mission-1",
          type: "mission.state",
          payload: { state: "plan" },
          createdAt: "2026-03-12T10:02:00.000Z",
        },
      ],
      nextCursor: null,
      hasMore: false,
    };

    vi.mocked(repository.getTimeline).mockResolvedValue(page);

    await expect(service.getTimeline("mission-1", "cursor-1", 25)).resolves.toEqual(page);
    expect(repository.getTimeline).toHaveBeenCalledWith("mission-1", "cursor-1", 25);
    expect(uow.complete).toHaveBeenCalledOnce();
  });

  it("keeps compatibility wrappers for getMissionById and changeMissionAction", async () => {
    const { service, repository, runtime } = createSubject();
    vi.mocked(repository.findById).mockResolvedValueOnce(null);
    vi.mocked(runtime.getSession).mockReturnValue(null);

    await expect(service.getMissionById("missing")).resolves.toBeNull();

    vi.mocked(repository.findById).mockResolvedValue(
      createMission({
        state: "paused",
        currentPhase: "paused",
        reviewStatus: "plan_pending",
      }),
    );
    vi.mocked(runtime.resumeMission).mockResolvedValue(true);

    vi.mocked(repository.findById).mockResolvedValue(
      createMission({
        state: "paused",
        currentPhase: "paused",
        reviewStatus: "plan_pending",
      }),
    );
    await expect(service.changeMissionAction("mission-1", "resume")).resolves.toBe(true);
    expect(runtime.resumeMission).toHaveBeenCalledWith("mission-1", "Plan approved from MissionService");
  });
});
