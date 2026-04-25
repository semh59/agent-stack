import { AppError } from "../utils/errors";
import type {
  BudgetLimits,
  BudgetStatus,
  CreateAutonomySessionRequest,
  GitMode,
  ModelPolicy,
  ScopePolicy,
  TaskNode,
} from "../orchestration/autonomy-types";
import {
  isMissionModel,
  type MissionModel,
  type CursorPage,
  type MissionArtifact,
  type MissionArtifactPage,
  type MissionPlan,
  type MissionTimelinePage,
  type PaginatedResult,
} from "../models/mission.model";
import { MissionFactory } from "../models/mission-factory";
import type { UnitOfWork } from "../uow/unit-of-work";
import type { MissionRuntime } from "./mission-runtime";

export type MissionServiceLogger = Pick<Console, "warn" | "error">;

export type MissionServiceErrorCode =
  | "MISSION_NOT_FOUND"
  | "INVALID_STATE_TRANSITION"
  | "PLAN_NOT_AVAILABLE"
  | "MISSION_RUNTIME_ERROR";

export class MissionServiceError extends AppError {
  constructor(
    public override readonly code: MissionServiceErrorCode,
    message?: string,
    statusCode: number = 400,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(code, message ?? code, statusCode, details, options);
    this.name = "MissionServiceError";
  }
}

export interface CreateMissionInput {
  account: string;
  anchorModel: string;
  objective: string;
  scope: ScopePolicy;
  gitMode: GitMode;
  modelPolicy?: ModelPolicy;
  startMode?: CreateAutonomySessionRequest["startMode"];
  reviewAfterPlan?: boolean;
  strictMode?: boolean;
  maxCycles?: number;
  maxDurationMs?: number;
  budgets?: Partial<BudgetLimits>;
  taskGraph?: TaskNode[];
}

function normalizeCreateInput(input: CreateMissionInput): CreateAutonomySessionRequest {
  return {
    account: input.account,
    anchorModel: input.anchorModel,
    objective: input.objective.trim(),
    scope: {
      mode: input.scope.mode,
      paths: [...input.scope.paths],
    },
    modelPolicy: input.modelPolicy ?? "smart_multi",
    gitMode: input.gitMode,
    startMode: input.startMode ?? "immediate",
    reviewAfterPlan: input.reviewAfterPlan ?? true,
    strictMode: input.strictMode ?? true,
    maxCycles: input.maxCycles,
    maxDurationMs: input.maxDurationMs,
    budgets: input.budgets ? structuredClone(input.budgets) : undefined,
    taskGraph: input.taskGraph ? structuredClone(input.taskGraph) : undefined,
  };
}

function normalizeCursorLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(limit)));
}

function paginateByCursor<T extends { id: string }>(
  items: readonly T[],
  cursor?: string,
  limit?: number,
): CursorPage<T> {
  const normalizedLimit = normalizeCursorLimit(limit);
  const startIndex = cursor ? items.findIndex((item) => item.id === cursor) + 1 : 0;

  if (cursor && startIndex === 0) {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  const pageItems = items.slice(startIndex, startIndex + normalizedLimit + 1);
  const visibleItems = pageItems.slice(0, normalizedLimit).map((item) => structuredClone(item));

  return {
    items: visibleItems,
    nextCursor:
      pageItems.length > normalizedLimit ? visibleItems[visibleItems.length - 1]?.id ?? null : null,
    hasMore: pageItems.length > normalizedLimit,
  };
}

function compareArtifacts(a: MissionArtifact, b: MissionArtifact): number {
  const timestampDelta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return a.id.localeCompare(b.id);
}

function mergeLiveMission(
  persistedMission: MissionModel | null,
  runtimeMission: MissionModel | null,
): MissionModel | null {
  if (!persistedMission) {
    return runtimeMission ? structuredClone(runtimeMission) : null;
  }

  if (!runtimeMission) {
    return structuredClone(persistedMission);
  }

  return {
    ...persistedMission,
    ...runtimeMission,
    plan: runtimeMission.plan ?? persistedMission.plan,
    gateResults:
      runtimeMission.gateResults.length > 0
        ? runtimeMission.gateResults
        : persistedMission.gateResults,
    timeline: runtimeMission.timeline.length > 0 ? runtimeMission.timeline : persistedMission.timeline,
    artifacts:
      runtimeMission.artifacts.length > 0 ? runtimeMission.artifacts : persistedMission.artifacts,
    touchedFiles:
      runtimeMission.touchedFiles.length > 0
        ? runtimeMission.touchedFiles
        : persistedMission.touchedFiles,
    completedAt: runtimeMission.completedAt ?? persistedMission.completedAt,
    error: runtimeMission.error ?? persistedMission.error,
    stopReason: runtimeMission.stopReason ?? persistedMission.stopReason,
  };
}

function isTerminalState(state: MissionModel["state"]): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function missionNotFound(id: string): MissionServiceError {
  return new MissionServiceError("MISSION_NOT_FOUND", `Mission ${id} was not found`, 404);
}

function invalidTransition(id: string, message: string): MissionServiceError {
  return new MissionServiceError("INVALID_STATE_TRANSITION", `Mission ${id}: ${message}`, 422);
}

function runtimeFailure(id: string, message: string, cause?: unknown): MissionServiceError {
  return new MissionServiceError("MISSION_RUNTIME_ERROR", `Mission ${id}: ${message}`, 500, undefined, {
    cause: cause instanceof Error ? cause : undefined,
  });
}

function planNotAvailable(id: string): MissionServiceError {
  return new MissionServiceError("PLAN_NOT_AVAILABLE", `Mission ${id} has no plan output yet`, 409);
}

export class MissionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly runtime: MissionRuntime,
    private readonly logger: MissionServiceLogger = console,
  ) {}

  public async create(input: CreateMissionInput): Promise<MissionModel> {
    return this.withUnitOfWork(async () => {
      const request = normalizeCreateInput(input);
      const session = this.startRuntimeMission(request);
      const mission = MissionFactory.fromSession(session);
      let missionRowCreated = false;

      try {
        const createdMission = await this.uow.missions.create(mission);
        missionRowCreated = true;
        await this.uow.missions.saveRuntimeSnapshot(session.id, session);
        return createdMission;
      } catch (error) {
        if (missionRowCreated) {
          this.logger.warn?.(
            `[MissionService] Mission ${session.id} may be partially persisted because bootstrap failed after mission row creation.`,
          );
        }
        await this.cancelOrphanRuntimeMission(session.id);
        throw error;
      }
    });
  }

  public async getById(id: string): Promise<MissionModel> {
    return this.withUnitOfWork(async () => {
      const mission = await this.loadMission(id);
      if (!mission) {
        throw missionNotFound(id);
      }
      return mission;
    });
  }

  public async getPlan(id: string): Promise<MissionPlan> {
    return this.withUnitOfWork(async () => {
      const mission = await this.loadMissionOrThrow(id);
      if (!mission.plan) {
        throw planNotAvailable(id);
      }
      return structuredClone(mission.plan);
    });
  }

  public async approve(id: string): Promise<void> {
    return this.withUnitOfWork(async () => {
      const mission = await this.loadMissionOrThrow(id);
      if (mission.state !== "paused" || mission.reviewStatus !== "plan_pending") {
        throw invalidTransition(id, "plan approval is only valid while waiting for review");
      }

      const resumed = await this.invokeRuntimeAction(id, () =>
        this.runtime.resumeMission(id, "Plan approved from MissionService"),
      );
      if (!resumed) {
        throw runtimeFailure(id, "runtime rejected plan approval");
      }

      await this.syncMissionFromRuntimeBestEffort(id);
    });
  }

  public async pause(id: string): Promise<void> {
    return this.withUnitOfWork(async () => {
      const mission = await this.loadMissionOrThrow(id);
      if (isTerminalState(mission.state)) {
        throw invalidTransition(id, "cannot pause a terminal mission");
      }
      if (mission.state === "paused") {
        throw invalidTransition(id, "mission is already paused");
      }
      if (mission.currentPhase === "queued") {
        throw invalidTransition(id, "queued missions cannot be paused");
      }

      const paused = await this.invokeRuntimeAction(id, () =>
        this.runtime.pauseMission(id, "Paused from MissionService"),
      );
      if (!paused) {
        throw runtimeFailure(id, "runtime rejected pause request");
      }

      await this.syncMissionFromRuntimeBestEffort(id);
    });
  }

  public async resume(id: string): Promise<void> {
    return this.withUnitOfWork(async () => {
      const mission = await this.loadMissionOrThrow(id);
      if (mission.state !== "paused") {
        throw invalidTransition(id, "resume is only valid for paused missions");
      }
      if (mission.reviewStatus === "plan_pending") {
        throw invalidTransition(id, "mission is waiting for plan approval; use approve()");
      }

      const resumed = await this.invokeRuntimeAction(id, () =>
        this.runtime.resumeMission(id, "Resumed from MissionService"),
      );
      if (!resumed) {
        throw runtimeFailure(id, "runtime rejected resume request");
      }

      await this.syncMissionFromRuntimeBestEffort(id);
    });
  }

  public async cancel(id: string): Promise<void> {
    return this.withUnitOfWork(async () => {
      const mission = await this.loadMissionOrThrow(id);
      if (isTerminalState(mission.state)) {
        throw invalidTransition(id, "cannot cancel a terminal mission");
      }

      const cancelled = await this.invokeRuntimeAction(id, () =>
        this.runtime.cancelMission(id, "Cancelled from MissionService"),
      );
      if (!cancelled) {
        throw runtimeFailure(id, "runtime rejected cancel request");
      }

      await this.syncMissionFromRuntimeBestEffort(id);
    });
  }

  public async getArtifacts(id: string, cursor?: string, limit?: number): Promise<MissionArtifactPage> {
    return this.withUnitOfWork(async () => {
      const mission = await this.loadMissionOrThrow(id);
      const artifacts = [...mission.artifacts].sort(compareArtifacts);
      return {
        ...paginateByCursor(artifacts, cursor, limit),
        total: artifacts.length,
      };
    });
  }

  public async getTimeline(id: string, cursor?: string, limit?: number): Promise<MissionTimelinePage> {
    return this.withUnitOfWork(() => this.uow.missions.getTimeline(id, cursor, limit));
  }

  public async getBudget(id: string): Promise<BudgetStatus> {
    return this.withUnitOfWork(async () => {
      const liveSession = this.readRuntimeSession(id);
      if (liveSession) {
        return structuredClone(liveSession.budgets);
      }

      const latestBudget = await this.uow.missions.getLatestBudget(id);
      if (latestBudget) {
        return structuredClone(latestBudget);
      }

      const mission = await this.uow.missions.findById(id);
      if (mission) {
        return structuredClone(mission.budget);
      }

      throw missionNotFound(id);
    });
  }

  public async getMissions(page: number, limit: number): Promise<PaginatedResult<MissionModel>> {
    return this.withUnitOfWork(async () => {
      const offset = (page - 1) * limit;
      const missions = await this.uow.missions.list();
      const items = missions.slice(offset, offset + limit);

      return {
        items,
        total: missions.length,
        page,
        limit,
        hasMore: offset + limit < missions.length,
      };
    });
  }

  public async createMission(
    input: MissionModel | CreateMissionInput | CreateAutonomySessionRequest,
  ): Promise<MissionModel> {
    if (isMissionModel(input)) {
      return this.withUnitOfWork(() => this.uow.missions.create(input));
    }

    return this.create(input);
  }

  public async getMissionById(id: string): Promise<MissionModel | null> {
    try {
      return await this.getById(id);
    } catch (error) {
      if (error instanceof MissionServiceError && error.code === "MISSION_NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }

  public async changeMissionAction(
    id: string,
    action: "pause" | "resume" | "stop",
  ): Promise<boolean> {
    try {
      if (action === "pause") {
        await this.pause(id);
        return true;
      }

      if (action === "resume") {
        const mission = await this.getById(id);
        if (mission.reviewStatus === "plan_pending") {
          await this.approve(id);
        } else {
          await this.resume(id);
        }
        return true;
      }

      await this.cancel(id);
      return true;
    } catch (error) {
      if (error instanceof MissionServiceError) {
        return false;
      }
      throw error;
    }
  }

  private async loadMission(id: string): Promise<MissionModel | null> {
    const persistedMission = await this.uow.missions.findById(id);
    const runtimeSession = this.readRuntimeSession(id);
    const runtimeMission = runtimeSession ? MissionFactory.fromSession(runtimeSession) : null;
    return mergeLiveMission(persistedMission, runtimeMission);
  }

  private async loadMissionOrThrow(id: string): Promise<MissionModel> {
    const mission = await this.loadMission(id);
    if (!mission) {
      throw missionNotFound(id);
    }
    return mission;
  }

  private startRuntimeMission(input: CreateAutonomySessionRequest) {
    try {
      return this.runtime.startMission(input);
    } catch (error) {
      throw runtimeFailure("new", "failed to start mission runtime", error);
    }
  }

  private readRuntimeSession(id: string) {
    try {
      return this.runtime.getSession(id);
    } catch (error) {
      throw runtimeFailure(id, "failed to read runtime session", error);
    }
  }

  private async invokeRuntimeAction(id: string, action: () => Promise<boolean>): Promise<boolean> {
    try {
      return await action();
    } catch (error) {
      throw runtimeFailure(id, "runtime action failed", error);
    }
  }

  private async cancelOrphanRuntimeMission(id: string): Promise<void> {
    try {
      const cancelled = await this.runtime.cancelMission(id, "Persistence bootstrap failed");
      if (!cancelled) {
        this.logger.error?.(
          `[MissionService] Runtime session ${id} could not be cancelled after persistence bootstrap failure. No mission row may exist, startup recovery may not find it, and manual cleanup may be required.`,
        );
      }
    } catch (error) {
      this.logger.error?.(
        `[MissionService] Failed to cancel runtime session ${id} after persistence bootstrap failure: ${this.errorToMessage(
          error,
        )}. Manual cleanup may be required.`,
      );
    }
  }

  private async syncMissionFromRuntimeBestEffort(id: string): Promise<void> {
    try {
      const runtimeSession = this.readRuntimeSession(id);
      if (!runtimeSession) {
        return;
      }

      const runtimeMission = MissionFactory.fromSession(runtimeSession);
      const existingMission = await this.uow.missions.findById(id);

      if (existingMission) {
        await this.uow.missions.update(id, runtimeMission);
      } else {
        await this.uow.missions.create(runtimeMission);
      }

      await this.uow.missions.saveRuntimeSnapshot(id, runtimeSession);
    } catch (error) {
      this.logger.warn?.(
        `[MissionService] Failed to best-effort sync mission ${id} from runtime: ${this.errorToMessage(
          error,
        )}`,
      );
    }
  }

  private errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async withUnitOfWork<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    try {
      if (this.uow.participate) {
        await this.uow.participate();
      }
      const result = await fn(this.uow);
      await this.uow.complete();
      return result;
    } catch (error) {
      // We only log critical errors here; domain-specific errors should be handled by the caller or specialized catch blocks
      try {
        await this.uow.rollback();
      } catch (rollbackError) {
        this.logger.error(rollbackError, "[MissionService] Critical: Rollback failed");
      }
      throw error;
    }
  }
}
