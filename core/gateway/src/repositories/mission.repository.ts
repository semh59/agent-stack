import { randomUUID } from "node:crypto";
import type {
  MissionBudgetSnapshot,
  MissionFilter,
  MissionModel,
  MissionTimelinePage,
  MissionTimelineRecord,
  PersistedGateResult,
} from "../models/mission.model";
import type {
  AutonomyEvent,
  AutonomySession,
  AutonomyState,
  BudgetStatus,
  GateResult,
} from "../orchestration/autonomy-types";

export type MissionRepositoryErrorCode =
  | "MISSION_ALREADY_EXISTS"
  | "MISSION_NOT_FOUND"
  | "MISSION_PERSISTENCE_ERROR";

export class MissionRepositoryError extends Error {
  constructor(
    public readonly code: MissionRepositoryErrorCode,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? code, options);
    this.name = "MissionRepositoryError";
  }
}

export interface SaveMissionEventOptions {
  id?: string;
  createdAt?: string;
  eventHash?: string | null;
  type?: string;
}

export interface SaveGateResultOptions {
  id?: string;
  createdAt?: string;
  eventHash?: string | null;
  phase?: AutonomyState | null;
}

export interface SaveBudgetSnapshotOptions {
  id?: string;
  createdAt?: string;
  eventHash?: string | null;
}

export interface InitializeQuotaStateResult {
  clearedReservations: number;
}

export interface MissionRepository {
  create(mission: MissionModel): Promise<MissionModel>;
  findById(id: string): Promise<MissionModel | null>;
  update(id: string, updates: Partial<MissionModel>): Promise<MissionModel>;
  list(filter?: MissionFilter): Promise<MissionModel[]>;
  saveGateResult(
    missionId: string,
    result: GateResult,
    options?: SaveGateResultOptions,
  ): Promise<void>;
  getGateResults(missionId: string): Promise<PersistedGateResult[]>;
  saveEvent(
    missionId: string,
    event: AutonomyEvent | MissionTimelineRecord,
    options?: SaveMissionEventOptions,
  ): Promise<void>;
  getTimeline(missionId: string, cursor?: string, limit?: number): Promise<MissionTimelinePage>;
  saveBudgetSnapshot(
    missionId: string,
    budget: BudgetStatus,
    options?: SaveBudgetSnapshotOptions,
  ): Promise<void>;
  getLatestBudget(missionId: string): Promise<BudgetStatus | null>;
  saveRuntimeSnapshot(missionId: string, snapshot: AutonomySession | null): Promise<void>;
  getRuntimeSnapshot(missionId: string): Promise<AutonomySession | null>;
  findInterrupted(): Promise<MissionModel[]>;
}

function cloneMission(mission: MissionModel): MissionModel {
  return structuredClone(mission);
}

function cloneGateResult(entry: PersistedGateResult): PersistedGateResult {
  return structuredClone(entry);
}

function cloneTimelineEntry(entry: MissionTimelineRecord): MissionTimelineRecord {
  return structuredClone(entry);
}

function matchesFilter(mission: MissionModel, filter?: MissionFilter): boolean {
  if (!filter) {
    return true;
  }

  if (filter.state && mission.state !== filter.state) {
    return false;
  }

  if (filter.account && mission.account !== filter.account) {
    return false;
  }

  if (filter.reviewStatus && mission.reviewStatus !== filter.reviewStatus) {
    return false;
  }

  return true;
}

function asRepositoryError(error: unknown, fallback: string): MissionRepositoryError {
  if (error instanceof MissionRepositoryError) {
    return error;
  }

  return new MissionRepositoryError("MISSION_PERSISTENCE_ERROR", fallback, {
    cause: error instanceof Error ? error : undefined,
  });
}

function interruptedMissionStates(): ReadonlySet<MissionModel["state"]> {
  return new Set(["received", "planning", "plan_review", "coding", "verifying"]);
}

function normalizeTimelineLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(limit)));
}

function toTimelineRecord(
  missionId: string,
  event: AutonomyEvent | MissionTimelineRecord,
  options?: SaveMissionEventOptions,
): MissionTimelineRecord {
  if ("missionId" in event && "payload" in event && "createdAt" in event) {
    return {
      id: options?.id ?? event.id,
      missionId,
      type: options?.type ?? event.type,
      payload: structuredClone(event.payload),
      createdAt: options?.createdAt ?? event.createdAt,
    };
  }

  return {
    id: options?.id ?? randomUUID(),
    missionId,
    type: options?.type ?? `mission.${event.type}`,
    payload: structuredClone(event.payload),
    createdAt: options?.createdAt ?? event.timestamp,
  };
}

export class InMemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, MissionModel>();
  private readonly gateResults = new Map<string, PersistedGateResult[]>();
  private readonly timeline = new Map<string, MissionTimelineRecord[]>();
  private readonly budgetSnapshots = new Map<string, MissionBudgetSnapshot[]>();
  private readonly runtimeSnapshots = new Map<string, AutonomySession | null>();
  private readonly eventHashes = {
    gate: new Set<string>(),
    timeline: new Set<string>(),
    budget: new Set<string>(),
  };

  public async create(mission: MissionModel): Promise<MissionModel> {
    try {
      if (this.missions.has(mission.id)) {
        throw new MissionRepositoryError(
          "MISSION_ALREADY_EXISTS",
          `Mission ${mission.id} already exists`,
        );
      }

      const storedMission = cloneMission(mission);
      this.missions.set(storedMission.id, storedMission);
      return cloneMission(storedMission);
    } catch (error) {
      throw asRepositoryError(error, `Failed to create mission ${mission.id}`);
    }
  }

  public async findById(id: string): Promise<MissionModel | null> {
    try {
      const mission = this.missions.get(id);
      return mission ? cloneMission(mission) : null;
    } catch (error) {
      throw asRepositoryError(error, `Failed to load mission ${id}`);
    }
  }

  public async update(id: string, updates: Partial<MissionModel>): Promise<MissionModel> {
    try {
      const currentMission = this.missions.get(id);
      if (!currentMission) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${id} was not found`);
      }

      const normalizedUpdates = structuredClone(updates);
      const updatedMission: MissionModel = {
        ...currentMission,
        ...normalizedUpdates,
        id: currentMission.id,
        createdAt: currentMission.createdAt,
        updatedAt: new Date().toISOString(),
      };

      this.missions.set(id, updatedMission);
      return cloneMission(updatedMission);
    } catch (error) {
      throw asRepositoryError(error, `Failed to update mission ${id}`);
    }
  }

  public async list(filter?: MissionFilter): Promise<MissionModel[]> {
    try {
      return Array.from(this.missions.values())
        .filter((mission) => matchesFilter(mission, filter))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map((mission) => cloneMission(mission));
    } catch (error) {
      throw asRepositoryError(error, "Failed to list missions");
    }
  }

  public async saveGateResult(
    missionId: string,
    result: GateResult,
    options?: SaveGateResultOptions,
  ): Promise<void> {
    try {
      const mission = this.missions.get(missionId);
      if (!mission) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }

      if (options?.eventHash && this.eventHashes.gate.has(options.eventHash)) {
        return;
      }

      const entry: PersistedGateResult = {
        id: options?.id ?? randomUUID(),
        missionId,
        phase: options?.phase ?? mission.currentPhase,
        result: structuredClone(result),
        createdAt: options?.createdAt ?? new Date().toISOString(),
        eventHash: options?.eventHash ?? null,
      };

      const entries = this.gateResults.get(missionId) ?? [];
      entries.push(entry);
      entries.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      this.gateResults.set(missionId, entries);
      mission.gateResults = entries.map((item) => structuredClone(item.result));
      mission.updatedAt = new Date().toISOString();
      if (options?.eventHash) {
        this.eventHashes.gate.add(options.eventHash);
      }
    } catch (error) {
      throw asRepositoryError(error, `Failed to save gate result for ${missionId}`);
    }
  }

  public async getGateResults(missionId: string): Promise<PersistedGateResult[]> {
    try {
      return (this.gateResults.get(missionId) ?? []).map((entry) => cloneGateResult(entry));
    } catch (error) {
      throw asRepositoryError(error, `Failed to load gate results for ${missionId}`);
    }
  }

  public async saveEvent(
    missionId: string,
    event: AutonomyEvent | MissionTimelineRecord,
    options?: SaveMissionEventOptions,
  ): Promise<void> {
    try {
      const mission = this.missions.get(missionId);
      if (!mission) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }

      if (options?.eventHash && this.eventHashes.timeline.has(options.eventHash)) {
        return;
      }

      const entry = toTimelineRecord(missionId, event, options);
      const entries = this.timeline.get(missionId) ?? [];
      entries.push(entry);
      entries.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      this.timeline.set(missionId, entries);
      mission.updatedAt = new Date().toISOString();
      if (options?.eventHash) {
        this.eventHashes.timeline.add(options.eventHash);
      }
    } catch (error) {
      throw asRepositoryError(error, `Failed to save timeline event for ${missionId}`);
    }
  }

  public async getTimeline(
    missionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<MissionTimelinePage> {
    try {
      const normalizedLimit = normalizeTimelineLimit(limit);
      const entries = [...(this.timeline.get(missionId) ?? [])].sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      );

      let startIndex = 0;
      if (cursor) {
        const cursorIndex = entries.findIndex((entry) => entry.id === cursor);
        startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
      }

      const slice = entries.slice(startIndex, startIndex + normalizedLimit + 1);
      const items = slice.slice(0, normalizedLimit).map((entry) => cloneTimelineEntry(entry));
      return {
        items,
        hasMore: slice.length > normalizedLimit,
        nextCursor: slice.length > normalizedLimit ? items[items.length - 1]?.id ?? null : null,
      };
    } catch (error) {
      throw asRepositoryError(error, `Failed to load timeline for ${missionId}`);
    }
  }

  public async saveBudgetSnapshot(
    missionId: string,
    budget: BudgetStatus,
    options?: SaveBudgetSnapshotOptions,
  ): Promise<void> {
    try {
      const mission = this.missions.get(missionId);
      if (!mission) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }

      if (options?.eventHash && this.eventHashes.budget.has(options.eventHash)) {
        return;
      }

      const entry: MissionBudgetSnapshot = {
        id: options?.id ?? randomUUID(),
        missionId,
        budget: structuredClone(budget),
        createdAt: options?.createdAt ?? new Date().toISOString(),
        eventHash: options?.eventHash ?? null,
      };

      const entries = this.budgetSnapshots.get(missionId) ?? [];
      entries.push(entry);
      entries.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      this.budgetSnapshots.set(missionId, entries);
      mission.budget = structuredClone(budget);
      mission.updatedAt = new Date().toISOString();
      if (options?.eventHash) {
        this.eventHashes.budget.add(options.eventHash);
      }
    } catch (error) {
      throw asRepositoryError(error, `Failed to save budget snapshot for ${missionId}`);
    }
  }

  public async getLatestBudget(missionId: string): Promise<BudgetStatus | null> {
    try {
      const entries = this.budgetSnapshots.get(missionId) ?? [];
      const latest = entries[entries.length - 1];
      return latest ? structuredClone(latest.budget) : null;
    } catch (error) {
      throw asRepositoryError(error, `Failed to load budget snapshot for ${missionId}`);
    }
  }

  public async saveRuntimeSnapshot(
    missionId: string,
    snapshot: AutonomySession | null,
  ): Promise<void> {
    try {
      if (!this.missions.has(missionId)) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }
      this.runtimeSnapshots.set(missionId, snapshot ? structuredClone(snapshot) : null);
    } catch (error) {
      throw asRepositoryError(error, `Failed to save runtime snapshot for ${missionId}`);
    }
  }

  public async getRuntimeSnapshot(missionId: string): Promise<AutonomySession | null> {
    try {
      const snapshot = this.runtimeSnapshots.get(missionId);
      return snapshot ? structuredClone(snapshot) : null;
    } catch (error) {
      throw asRepositoryError(error, `Failed to load runtime snapshot for ${missionId}`);
    }
  }

  public async findInterrupted(): Promise<MissionModel[]> {
    try {
      const allowedStates = interruptedMissionStates();
      return Array.from(this.missions.values())
        .filter((mission) => allowedStates.has(mission.state))
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map((mission) => cloneMission(mission));
    } catch (error) {
      throw asRepositoryError(error, "Failed to find interrupted missions");
    }
  }

}
