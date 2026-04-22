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

export interface AccountQuotaUsageSnapshot {
  accountKey: string;
  currentTPM: number;
  requestsUsed: number;
  reservedTPM: number;
  reservedRequests: number;
  cachedInputTokensUsed: number;
}

export interface QuotaReservationRecord {
  reservationId: string;
  accountKey: string;
  sessionId: string;
  requestId: string;
  estimatedTokens: number;
  leaseExpiresAtMs: number;
  createdAtMs: number;
}

export interface ReserveQuotaParams {
  accountKey: string;
  sessionId: string;
  requestId: string;
  estimatedTokens: number;
  maxTPM: number;
  maxRPD: number;
  leaseExpiresAtMs: number;
  nowMs?: number;
}

export interface ReserveQuotaResult {
  accepted: boolean;
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot;
  reason: string | null;
}

export interface CommitQuotaParams {
  reservationId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  nowMs?: number;
}

export interface CommitQuotaResult {
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot | null;
  committedTokens: number;
  cachedInputTokens: number;
}

export interface ReleaseQuotaResult {
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot | null;
  released: boolean;
}

export interface ReleaseSessionQuotaResult {
  usageByAccount: AccountQuotaUsageSnapshot[];
  releasedReservations: number;
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
  initializeQuotaState(nowMs?: number): Promise<InitializeQuotaStateResult>;
  getQuotaUsage(accountKey: string, nowMs?: number): Promise<AccountQuotaUsageSnapshot>;
  reserveQuota(params: ReserveQuotaParams): Promise<ReserveQuotaResult>;
  commitQuota(params: CommitQuotaParams): Promise<CommitQuotaResult>;
  releaseQuota(reservationId: string, reason?: string, nowMs?: number): Promise<ReleaseQuotaResult>;
  releaseQuotaReservationsForSession(
    sessionId: string,
    reason?: string,
    nowMs?: number,
  ): Promise<ReleaseSessionQuotaResult>;
  purgeExpiredQuotaReservations(nowMs?: number): Promise<AccountQuotaUsageSnapshot[]>;
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
  private readonly quotaTokenEvents = new Map<
    string,
    Array<{ id: string; tokens: number; cachedInputTokens: number; createdAtMs: number }>
  >();
  private readonly quotaRequestEvents = new Map<string, Array<{ id: string; createdAtMs: number }>>();
  private readonly quotaReservations = new Map<string, QuotaReservationRecord>();
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

  public async initializeQuotaState(nowMs = Date.now()): Promise<InitializeQuotaStateResult> {
    try {
      this.purgeOldCommittedUsage(nowMs);
      const clearedReservations = this.quotaReservations.size;
      this.quotaReservations.clear();
      return { clearedReservations };
    } catch (error) {
      throw asRepositoryError(error, "Failed to initialize quota state");
    }
  }

  public async getQuotaUsage(
    accountKey: string,
    nowMs = Date.now(),
  ): Promise<AccountQuotaUsageSnapshot> {
    try {
      this.purgeOldCommittedUsage(nowMs);
      this.purgeExpiredReservations(nowMs);
      return this.readQuotaUsage(accountKey, nowMs);
    } catch (error) {
      throw asRepositoryError(error, `Failed to read quota usage for ${accountKey}`);
    }
  }

  public async reserveQuota(params: ReserveQuotaParams): Promise<ReserveQuotaResult> {
    try {
      const nowMs = params.nowMs ?? Date.now();
      const estimatedTokens = Math.max(0, Math.floor(params.estimatedTokens));
      this.purgeOldCommittedUsage(nowMs);
      this.purgeExpiredReservations(nowMs);

      const usage = this.readQuotaUsage(params.accountKey, nowMs);
      const projectedTPM = usage.currentTPM + usage.reservedTPM + estimatedTokens;
      const projectedRPD = usage.requestsUsed + usage.reservedRequests + 1;
      if (projectedTPM > params.maxTPM) {
        return {
          accepted: false,
          reservation: null,
          usage,
          reason: `BUDGET_EXCEEDED: tpm ${projectedTPM}/${params.maxTPM}`,
        };
      }
      if (projectedRPD > params.maxRPD) {
        return {
          accepted: false,
          reservation: null,
          usage,
          reason: `BUDGET_EXCEEDED: rpd ${projectedRPD}/${params.maxRPD}`,
        };
      }

      const reservation: QuotaReservationRecord = {
        reservationId: randomUUID(),
        accountKey: params.accountKey,
        sessionId: params.sessionId,
        requestId: params.requestId,
        estimatedTokens,
        leaseExpiresAtMs: Math.max(nowMs + 1, Math.floor(params.leaseExpiresAtMs)),
        createdAtMs: nowMs,
      };
      this.quotaReservations.set(reservation.reservationId, reservation);
      return {
        accepted: true,
        reservation,
        usage: this.readQuotaUsage(params.accountKey, nowMs),
        reason: null,
      };
    } catch (error) {
      throw asRepositoryError(error, `Failed to reserve quota for ${params.accountKey}`);
    }
  }

  public async commitQuota(params: CommitQuotaParams): Promise<CommitQuotaResult> {
    try {
      const nowMs = params.nowMs ?? Date.now();
      this.purgeOldCommittedUsage(nowMs);
      this.purgeExpiredReservations(nowMs);

      const reservation = this.quotaReservations.get(params.reservationId) ?? null;
      if (!reservation) {
        return {
          reservation: null,
          usage: null,
          committedTokens: 0,
          cachedInputTokens: 0,
        };
      }

      const inputTokens = Math.max(0, Math.floor(params.inputTokens));
      const outputTokens = Math.max(0, Math.floor(params.outputTokens));
      const cachedInputTokens = Math.max(0, Math.floor(params.cachedInputTokens));
      const effectiveInputTokens = Math.max(0, inputTokens - cachedInputTokens);
      const committedTokens = effectiveInputTokens + outputTokens;

      const tokenEntries = this.quotaTokenEvents.get(reservation.accountKey) ?? [];
      tokenEntries.push({
        id: randomUUID(),
        tokens: committedTokens,
        cachedInputTokens,
        createdAtMs: nowMs,
      });
      this.quotaTokenEvents.set(reservation.accountKey, tokenEntries);

      const requestEntries = this.quotaRequestEvents.get(reservation.accountKey) ?? [];
      requestEntries.push({
        id: randomUUID(),
        createdAtMs: nowMs,
      });
      this.quotaRequestEvents.set(reservation.accountKey, requestEntries);

      this.quotaReservations.delete(params.reservationId);
      return {
        reservation,
        usage: this.readQuotaUsage(reservation.accountKey, nowMs),
        committedTokens,
        cachedInputTokens,
      };
    } catch (error) {
      throw asRepositoryError(error, `Failed to commit quota reservation ${params.reservationId}`);
    }
  }

  public async releaseQuota(
    reservationId: string,
    _reason?: string,
    nowMs = Date.now(),
  ): Promise<ReleaseQuotaResult> {
    try {
      this.purgeOldCommittedUsage(nowMs);
      this.purgeExpiredReservations(nowMs);

      const reservation = this.quotaReservations.get(reservationId) ?? null;
      if (!reservation) {
        return {
          reservation: null,
          usage: null,
          released: false,
        };
      }

      this.quotaReservations.delete(reservationId);
      return {
        reservation,
        usage: this.readQuotaUsage(reservation.accountKey, nowMs),
        released: true,
      };
    } catch (error) {
      throw asRepositoryError(error, `Failed to release quota reservation ${reservationId}`);
    }
  }

  public async releaseQuotaReservationsForSession(
    sessionId: string,
    _reason?: string,
    nowMs = Date.now(),
  ): Promise<ReleaseSessionQuotaResult> {
    try {
      this.purgeOldCommittedUsage(nowMs);
      this.purgeExpiredReservations(nowMs);

      const affectedAccounts = new Set<string>();
      let releasedReservations = 0;
      for (const [reservationId, reservation] of this.quotaReservations.entries()) {
        if (reservation.sessionId !== sessionId) {
          continue;
        }
        affectedAccounts.add(reservation.accountKey);
        this.quotaReservations.delete(reservationId);
        releasedReservations += 1;
      }

      return {
        usageByAccount: Array.from(affectedAccounts).map((accountKey) =>
          this.readQuotaUsage(accountKey, nowMs),
        ),
        releasedReservations,
      };
    } catch (error) {
      throw asRepositoryError(error, `Failed to release quota reservations for session ${sessionId}`);
    }
  }

  public async purgeExpiredQuotaReservations(
    nowMs = Date.now(),
  ): Promise<AccountQuotaUsageSnapshot[]> {
    try {
      this.purgeOldCommittedUsage(nowMs);
      const affectedAccounts = this.purgeExpiredReservations(nowMs);
      return Array.from(affectedAccounts).map((accountKey) => this.readQuotaUsage(accountKey, nowMs));
    } catch (error) {
      throw asRepositoryError(error, "Failed to purge expired quota reservations");
    }
  }

  private readQuotaUsage(accountKey: string, nowMs: number): AccountQuotaUsageSnapshot {
    const tokenEvents = (this.quotaTokenEvents.get(accountKey) ?? []).filter(
      (entry) => nowMs - entry.createdAtMs < 60_000,
    );
    this.quotaTokenEvents.set(accountKey, tokenEvents);

    const requestEvents = (this.quotaRequestEvents.get(accountKey) ?? []).filter(
      (entry) => nowMs - entry.createdAtMs < 24 * 60 * 60 * 1000,
    );
    this.quotaRequestEvents.set(accountKey, requestEvents);

    const reservations = Array.from(this.quotaReservations.values()).filter(
      (reservation) => reservation.accountKey === accountKey && reservation.leaseExpiresAtMs > nowMs,
    );

    return {
      accountKey,
      currentTPM: tokenEvents.reduce((total, entry) => total + entry.tokens, 0),
      requestsUsed: requestEvents.length,
      reservedTPM: reservations.reduce((total, entry) => total + entry.estimatedTokens, 0),
      reservedRequests: reservations.length,
      cachedInputTokensUsed: tokenEvents.reduce(
        (total, entry) => total + entry.cachedInputTokens,
        0,
      ),
    };
  }

  private purgeOldCommittedUsage(nowMs: number): void {
    for (const [accountKey, entries] of this.quotaTokenEvents.entries()) {
      const filtered = entries.filter((entry) => nowMs - entry.createdAtMs < 60_000);
      if (filtered.length === 0) {
        this.quotaTokenEvents.delete(accountKey);
        continue;
      }
      this.quotaTokenEvents.set(accountKey, filtered);
    }

    for (const [accountKey, entries] of this.quotaRequestEvents.entries()) {
      const filtered = entries.filter((entry) => nowMs - entry.createdAtMs < 24 * 60 * 60 * 1000);
      if (filtered.length === 0) {
        this.quotaRequestEvents.delete(accountKey);
        continue;
      }
      this.quotaRequestEvents.set(accountKey, filtered);
    }
  }

  private purgeExpiredReservations(nowMs: number): Set<string> {
    const affectedAccounts = new Set<string>();
    for (const [reservationId, reservation] of this.quotaReservations.entries()) {
      if (reservation.leaseExpiresAtMs > nowMs) {
        continue;
      }
      affectedAccounts.add(reservation.accountKey);
      this.quotaReservations.delete(reservationId);
    }
    return affectedAccounts;
  }
}
