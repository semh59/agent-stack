import { randomUUID } from "node:crypto";
import type {
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
import { MissionDatabase, getMissionDatabase } from "./database";
import {
  type AccountQuotaUsageSnapshot,
  type CommitQuotaParams,
  type CommitQuotaResult,
  type InitializeQuotaStateResult,
  MissionRepositoryError,
  type MissionRepository,
  type QuotaReservationRecord,
  type ReleaseQuotaResult,
  type ReleaseSessionQuotaResult,
  type ReserveQuotaParams,
  type ReserveQuotaResult,
  type SaveBudgetSnapshotOptions,
  type SaveGateResultOptions,
  type SaveMissionEventOptions,
} from "../repositories/mission.repository";

const TPM_WINDOW_MS = 60_000;
const RPD_WINDOW_MS = 24 * 60 * 60 * 1000;

interface MissionRow {
  id: string;
  prompt: string;
  account: string;
  state: string;
  current_phase: string | null;
  current_gear: string | null;
  current_model: string | null;
  review_status: string;
  review_updated_at: string | null;
  anchor_model: string;
  scope_paths_json: string;
  strict_mode: number;
  plan_json: string | null;
  artifacts_json: string;
  touched_files_json: string;
  timeline_json: string;
  gate_results_json: string;
  budget_json: string;
  error: string | null;
  stop_reason: string | null;
  last_progress_at: string | null;
  runtime_snapshot_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return structuredClone(fallback);
  }
  return JSON.parse(value) as T;
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function nowIso(): string {
  return new Date().toISOString();
}

function interruptedStates(): string[] {
  return ["received", "planning", "plan_review", "coding", "verifying"];
}

function normalizeMissionRow(row: MissionRow): MissionModel {
  return {
    id: row.id,
    prompt: row.prompt,
    account: row.account,
    state: row.state as MissionModel["state"],
    currentPhase: row.current_phase as MissionModel["currentPhase"],
    currentGear: row.current_gear as MissionModel["currentGear"],
    currentModel: row.current_model,
    reviewStatus: row.review_status as MissionModel["reviewStatus"],
    reviewUpdatedAt: row.review_updated_at,
    anchorModel: row.anchor_model,
    scopePaths: parseJson(row.scope_paths_json, [] as string[]),
    strictMode: row.strict_mode === 1,
    plan: parseJson(row.plan_json, null as MissionModel["plan"]),
    artifacts: parseJson(row.artifacts_json, [] as MissionModel["artifacts"]),
    touchedFiles: parseJson(row.touched_files_json, [] as string[]),
    timeline: parseJson(row.timeline_json, [] as MissionModel["timeline"]),
    gateResults: parseJson(row.gate_results_json, [] as MissionModel["gateResults"]),
    budget: parseJson(row.budget_json, null as never),
    error: row.error,
    stopReason: row.stop_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    lastProgressAt: row.last_progress_at ?? row.updated_at,
  };
}

function toMissionRow(mission: MissionModel): Record<string, unknown> {
  return {
    id: mission.id,
    prompt: mission.prompt,
    account: mission.account,
    state: mission.state,
    current_phase: mission.currentPhase,
    current_gear: mission.currentGear,
    current_model: mission.currentModel,
    review_status: mission.reviewStatus,
    review_updated_at: mission.reviewUpdatedAt,
    anchor_model: mission.anchorModel,
    scope_paths_json: serializeJson(mission.scopePaths),
    strict_mode: mission.strictMode ? 1 : 0,
    plan_json: mission.plan ? serializeJson(mission.plan) : null,
    artifacts_json: serializeJson(mission.artifacts),
    touched_files_json: serializeJson(mission.touchedFiles),
    timeline_json: serializeJson(mission.timeline),
    gate_results_json: serializeJson(mission.gateResults),
    budget_json: serializeJson(mission.budget),
    error: mission.error,
    stop_reason: mission.stopReason,
    last_progress_at: mission.lastProgressAt,
    created_at: mission.createdAt,
    updated_at: mission.updatedAt,
    completed_at: mission.completedAt,
  };
}

function toRepositoryError(message: string, error: unknown): MissionRepositoryError {
  if (error instanceof MissionRepositoryError) {
    return error;
  }

  return new MissionRepositoryError("MISSION_PERSISTENCE_ERROR", message, {
    cause: error instanceof Error ? error : undefined,
  });
}

function normalizeTimelineRecord(
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

export class SQLiteMissionRepository implements MissionRepository {
  constructor(private readonly database: MissionDatabase = getMissionDatabase()) {}

  public async create(mission: MissionModel): Promise<MissionModel> {
    try {
      const existing = this.findMissionRow(mission.id);
      if (existing) {
        throw new MissionRepositoryError(
          "MISSION_ALREADY_EXISTS",
          `Mission ${mission.id} already exists`,
        );
      }

      const row = toMissionRow(mission);
      this.database.connection
        .prepare(
          `INSERT INTO missions (
            id, prompt, account, state, current_phase, current_gear, current_model,
            review_status, review_updated_at, anchor_model, scope_paths_json, strict_mode,
            plan_json, artifacts_json, touched_files_json, timeline_json, gate_results_json,
            budget_json, error, stop_reason, runtime_snapshot_json, created_at, updated_at, completed_at
          ) VALUES (
            @id, @prompt, @account, @state, @current_phase, @current_gear, @current_model,
            @review_status, @review_updated_at, @anchor_model, @scope_paths_json, @strict_mode,
            @plan_json, @artifacts_json, @touched_files_json, @timeline_json, @gate_results_json,
            @budget_json, @error, @stop_reason, NULL, @created_at, @updated_at, @completed_at
          )`,
        )
        .run(row);

      return structuredClone(mission);
    } catch (error) {
      throw toRepositoryError(`Failed to create mission ${mission.id}`, error);
    }
  }

  public async findById(id: string): Promise<MissionModel | null> {
    try {
      const row = this.findMissionRow(id);
      return row ? normalizeMissionRow(row) : null;
    } catch (error) {
      throw toRepositoryError(`Failed to load mission ${id}`, error);
    }
  }

  public async update(id: string, updates: Partial<MissionModel>): Promise<MissionModel> {
    try {
      const current = this.findMissionRow(id);
      if (!current) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${id} was not found`);
      }

      const merged: MissionModel = {
        ...normalizeMissionRow(current),
        ...structuredClone(updates),
        id,
        createdAt: current.created_at,
        updatedAt: nowIso(),
      };

      const row = toMissionRow(merged);
      this.database.connection
        .prepare(
          `UPDATE missions SET
            prompt = @prompt,
            account = @account,
            state = @state,
            current_phase = @current_phase,
            current_gear = @current_gear,
            current_model = @current_model,
            review_status = @review_status,
            review_updated_at = @review_updated_at,
            anchor_model = @anchor_model,
            scope_paths_json = @scope_paths_json,
            strict_mode = @strict_mode,
            plan_json = @plan_json,
            artifacts_json = @artifacts_json,
            touched_files_json = @touched_files_json,
            timeline_json = @timeline_json,
            gate_results_json = @gate_results_json,
            budget_json = @budget_json,
            error = @error,
            stop_reason = @stop_reason,
            updated_at = @updated_at,
            completed_at = @completed_at
          WHERE id = @id`,
        )
        .run(row);

      return merged;
    } catch (error) {
      throw toRepositoryError(`Failed to update mission ${id}`, error);
    }
  }

  public async list(filter?: MissionFilter): Promise<MissionModel[]> {
    try {
      const whereParts: string[] = [];
      const params: Record<string, unknown> = {};

      if (filter?.state) {
        whereParts.push("state = @state");
        params["state"] = filter.state;
      }
      if (filter?.account) {
        whereParts.push("account = @account");
        params["account"] = filter.account;
      }
      if (filter?.reviewStatus) {
        whereParts.push("review_status = @review_status");
        params["review_status"] = filter.reviewStatus;
      }

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      const rows = this.database.connection
        .prepare(`SELECT * FROM missions ${whereClause} ORDER BY created_at DESC`)
        .all(params) as MissionRow[];

      return rows.map((row) => normalizeMissionRow(row));
    } catch (error) {
      throw toRepositoryError("Failed to list missions", error);
    }
  }

  public async saveGateResult(
    missionId: string,
    result: GateResult,
    options?: SaveGateResultOptions,
  ): Promise<void> {
    try {
      const mission = await this.findById(missionId);
      if (!mission) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }

      const createdAt = options?.createdAt ?? nowIso();
      this.database.connection
        .prepare(
          `INSERT OR IGNORE INTO mission_gate_results (
            id, mission_id, phase, passed, strict_mode, impacted_scopes_json, commands_json,
            blocking_issues_json, audit_summary_json, raw_json, event_hash, created_at
          ) VALUES (
            @id, @mission_id, @phase, @passed, @strict_mode, @impacted_scopes_json, @commands_json,
            @blocking_issues_json, @audit_summary_json, @raw_json, @event_hash, @created_at
          )`,
        )
        .run({
          id: options?.id ?? randomUUID(),
          mission_id: missionId,
          phase: options?.phase ?? mission.currentPhase,
          passed: result.passed ? 1 : 0,
          strict_mode: result.strictMode ? 1 : 0,
          impacted_scopes_json: serializeJson(result.impactedScopes),
          commands_json: serializeJson(result.commands),
          blocking_issues_json: serializeJson(result.blockingIssues),
          audit_summary_json: serializeJson(result.auditSummary),
          raw_json: serializeJson(result),
          event_hash: options?.eventHash ?? null,
          created_at: createdAt,
        });

      const gateResults = await this.getGateResults(missionId);
      await this.update(missionId, {
        gateResults: gateResults.map((entry) => entry.result),
      });
    } catch (error) {
      throw toRepositoryError(`Failed to save gate result for ${missionId}`, error);
    }
  }

  public async getGateResults(missionId: string): Promise<PersistedGateResult[]> {
    try {
      const rows = this.database.connection
        .prepare(
          `SELECT id, mission_id, phase, raw_json, created_at, event_hash
           FROM mission_gate_results
           WHERE mission_id = ?
           ORDER BY created_at ASC`,
        )
        .all(missionId) as Array<{
        id: string;
        mission_id: string;
        phase: string | null;
        raw_json: string;
        created_at: string;
        event_hash: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        missionId: row.mission_id,
        phase: row.phase as AutonomyState | null,
        result: parseJson(row.raw_json, null as never),
        createdAt: row.created_at,
        eventHash: row.event_hash,
      }));
    } catch (error) {
      throw toRepositoryError(`Failed to load gate results for ${missionId}`, error);
    }
  }

  public async saveEvent(
    missionId: string,
    event: AutonomyEvent | MissionTimelineRecord,
    options?: SaveMissionEventOptions,
  ): Promise<void> {
    try {
      const mission = this.findMissionRow(missionId);
      if (!mission) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }

      const record = normalizeTimelineRecord(missionId, event, options);
      this.database.connection
        .prepare(
          `INSERT OR IGNORE INTO mission_timeline (
            id, mission_id, type, payload_json, event_hash, created_at
          ) VALUES (
            @id, @mission_id, @type, @payload_json, @event_hash, @created_at
          )`,
        )
        .run({
          id: record.id,
          mission_id: missionId,
          type: record.type,
          payload_json: serializeJson(record.payload),
          event_hash: options?.eventHash ?? null,
          created_at: record.createdAt,
        });
    } catch (error) {
      throw toRepositoryError(`Failed to save mission event for ${missionId}`, error);
    }
  }

  public async getTimeline(
    missionId: string,
    cursor?: string,
    limit = 50,
  ): Promise<MissionTimelinePage> {
    try {
      const normalizedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
      let rows: Array<{
        id: string;
        mission_id: string;
        type: string;
        payload_json: string;
        created_at: string;
      }>;

      if (cursor) {
        const cursorRow = this.database.connection
          .prepare(`SELECT created_at, id FROM mission_timeline WHERE id = ? AND mission_id = ?`)
          .get(cursor, missionId) as { created_at: string; id: string } | undefined;

        if (cursorRow) {
          rows = this.database.connection
            .prepare(
              `SELECT id, mission_id, type, payload_json, created_at
               FROM mission_timeline
               WHERE mission_id = @mission_id
                 AND (created_at > @created_at OR (created_at = @created_at AND id > @cursor_id))
               ORDER BY created_at ASC, id ASC
               LIMIT @limit`,
            )
            .all({
              mission_id: missionId,
              created_at: cursorRow.created_at,
              cursor_id: cursorRow.id,
              limit: normalizedLimit + 1,
            }) as typeof rows;
        } else {
          rows = [];
        }
      } else {
        rows = this.database.connection
          .prepare(
            `SELECT id, mission_id, type, payload_json, created_at
             FROM mission_timeline
             WHERE mission_id = ?
             ORDER BY created_at ASC, id ASC
             LIMIT ?`,
          )
          .all(missionId, normalizedLimit + 1) as typeof rows;
      }

      const pageItems = rows.slice(0, normalizedLimit).map((row) => ({
        id: row.id,
        missionId: row.mission_id,
        type: row.type,
        payload: parseJson(row.payload_json, {} as Record<string, unknown>),
        createdAt: row.created_at,
      }));

      return {
        items: pageItems,
        hasMore: rows.length > normalizedLimit,
        nextCursor: rows.length > normalizedLimit ? pageItems[pageItems.length - 1]?.id ?? null : null,
      };
    } catch (error) {
      throw toRepositoryError(`Failed to load timeline for ${missionId}`, error);
    }
  }

  public async saveBudgetSnapshot(
    missionId: string,
    budget: BudgetStatus,
    options?: SaveBudgetSnapshotOptions,
  ): Promise<void> {
    try {
      const mission = await this.findById(missionId);
      if (!mission) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }

      const cyclesLimit = budget.limits.maxCycles || 1;
      const efficiency =
        budget.usage.cyclesUsed > 0
          ? Math.max(0, Math.min(1, 1 - budget.usage.cyclesUsed / cyclesLimit))
          : 0;

      this.database.connection
        .prepare(
          `INSERT OR IGNORE INTO mission_budget_snapshots (
            id, mission_id, tpm_used, tpm_limit, rpd_used, rpd_limit,
            cycles_used, cycles_limit, efficiency, warning_active, raw_json, event_hash, created_at
          ) VALUES (
            @id, @mission_id, @tpm_used, @tpm_limit, @rpd_used, @rpd_limit,
            @cycles_used, @cycles_limit, @efficiency, @warning_active, @raw_json, @event_hash, @created_at
          )`,
        )
        .run({
          id: options?.id ?? randomUUID(),
          mission_id: missionId,
          tpm_used: budget.usage.currentTPM,
          tpm_limit: budget.limits.maxTPM,
          rpd_used: budget.usage.requestsUsed,
          rpd_limit: budget.limits.maxRPD,
          cycles_used: budget.usage.cyclesUsed,
          cycles_limit: budget.limits.maxCycles,
          efficiency,
          warning_active: budget.warning ? 1 : 0,
          raw_json: serializeJson(budget),
          event_hash: options?.eventHash ?? null,
          created_at: options?.createdAt ?? nowIso(),
        });

      await this.update(missionId, { budget: structuredClone(budget) });
    } catch (error) {
      throw toRepositoryError(`Failed to save budget snapshot for ${missionId}`, error);
    }
  }

  public async getLatestBudget(missionId: string): Promise<BudgetStatus | null> {
    try {
      const row = this.database.connection
        .prepare(
          `SELECT raw_json FROM mission_budget_snapshots
           WHERE mission_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(missionId) as { raw_json: string } | undefined;

      return row ? parseJson(row.raw_json, null as never) : null;
    } catch (error) {
      throw toRepositoryError(`Failed to load latest budget for ${missionId}`, error);
    }
  }

  public async saveRuntimeSnapshot(
    missionId: string,
    snapshot: AutonomySession | null,
  ): Promise<void> {
    try {
      const updated = this.database.connection
        .prepare(
          `UPDATE missions SET runtime_snapshot_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(snapshot ? serializeJson(snapshot) : null, nowIso(), missionId);

      if (updated.changes === 0) {
        throw new MissionRepositoryError("MISSION_NOT_FOUND", `Mission ${missionId} was not found`);
      }
    } catch (error) {
      throw toRepositoryError(`Failed to save runtime snapshot for ${missionId}`, error);
    }
  }

  public async getRuntimeSnapshot(missionId: string): Promise<AutonomySession | null> {
    try {
      const row = this.database.connection
        .prepare(`SELECT runtime_snapshot_json FROM missions WHERE id = ?`)
        .get(missionId) as { runtime_snapshot_json: string | null } | undefined;

      return row?.runtime_snapshot_json
        ? parseJson(row.runtime_snapshot_json, null as never)
        : null;
    } catch (error) {
      throw toRepositoryError(`Failed to load runtime snapshot for ${missionId}`, error);
    }
  }

  public async findInterrupted(): Promise<MissionModel[]> {
    try {
      const placeholders = interruptedStates().map(() => "?").join(", ");
      const rows = this.database.connection
        .prepare(
          `SELECT * FROM missions
           WHERE state IN (${placeholders})
           ORDER BY updated_at DESC`,
        )
        .all(...interruptedStates()) as MissionRow[];

      return rows.map((row) => normalizeMissionRow(row));
    } catch (error) {
      throw toRepositoryError("Failed to find interrupted missions", error);
    }
  }

  public async initializeQuotaState(nowMs = Date.now()): Promise<InitializeQuotaStateResult> {
    try {
      const transaction = this.database.connection.transaction((currentNowMs: number) => {
        this.pruneCommittedQuotaWindows(currentNowMs);
        const clearedReservations = this.database.connection
          .prepare(`SELECT COUNT(*) AS count FROM account_quota_reservations`)
          .get() as { count: number };
        this.database.connection.prepare(`DELETE FROM account_quota_reservations`).run();
        return { clearedReservations: Number(clearedReservations.count ?? 0) };
      });

      return transaction(nowMs);
    } catch (error) {
      throw toRepositoryError("Failed to initialize quota state", error);
    }
  }

  public async getQuotaUsage(
    accountKey: string,
    nowMs = Date.now(),
  ): Promise<AccountQuotaUsageSnapshot> {
    try {
      const transaction = this.database.connection.transaction(
        (resolvedAccountKey: string, currentNowMs: number) => {
          this.pruneCommittedQuotaWindows(currentNowMs);
          this.deleteExpiredReservations(currentNowMs);
          return this.readQuotaUsage(resolvedAccountKey, currentNowMs);
        },
      );
      return transaction(accountKey, nowMs);
    } catch (error) {
      throw toRepositoryError(`Failed to read quota usage for ${accountKey}`, error);
    }
  }

  public async reserveQuota(params: ReserveQuotaParams): Promise<ReserveQuotaResult> {
    try {
      const transaction = this.database.connection.transaction(
        (input: ReserveQuotaParams): ReserveQuotaResult => {
          const nowMs = input.nowMs ?? Date.now();
          const estimatedTokens = Math.max(0, Math.floor(input.estimatedTokens));
          this.pruneCommittedQuotaWindows(nowMs);
          this.deleteExpiredReservations(nowMs);

          const usage = this.readQuotaUsage(input.accountKey, nowMs);
          const projectedTPM = usage.currentTPM + usage.reservedTPM + estimatedTokens;
          const projectedRPD = usage.requestsUsed + usage.reservedRequests + 1;
          if (projectedTPM > input.maxTPM) {
            return {
              accepted: false,
              reservation: null,
              usage,
              reason: `BUDGET_EXCEEDED: tpm ${projectedTPM}/${input.maxTPM}`,
            };
          }
          if (projectedRPD > input.maxRPD) {
            return {
              accepted: false,
              reservation: null,
              usage,
              reason: `BUDGET_EXCEEDED: rpd ${projectedRPD}/${input.maxRPD}`,
            };
          }

          const reservation: QuotaReservationRecord = {
            reservationId: randomUUID(),
            accountKey: input.accountKey,
            sessionId: input.sessionId,
            requestId: input.requestId,
            estimatedTokens,
            leaseExpiresAtMs: Math.max(nowMs + 1, Math.floor(input.leaseExpiresAtMs)),
            createdAtMs: nowMs,
          };

          this.database.connection
            .prepare(
              `INSERT INTO account_quota_reservations (
                reservation_id, account_key, session_id, request_id, estimated_tokens,
                lease_expires_at_ms, created_at_ms
              ) VALUES (
                @reservation_id, @account_key, @session_id, @request_id, @estimated_tokens,
                @lease_expires_at_ms, @created_at_ms
              )`,
            )
            .run({
              reservation_id: reservation.reservationId,
              account_key: reservation.accountKey,
              session_id: reservation.sessionId,
              request_id: reservation.requestId,
              estimated_tokens: reservation.estimatedTokens,
              lease_expires_at_ms: reservation.leaseExpiresAtMs,
              created_at_ms: reservation.createdAtMs,
            });

          return {
            accepted: true,
            reservation,
            usage: this.readQuotaUsage(input.accountKey, nowMs),
            reason: null,
          };
        },
      );

      return transaction(params);
    } catch (error) {
      throw toRepositoryError(`Failed to reserve quota for ${params.accountKey}`, error);
    }
  }

  public async commitQuota(params: CommitQuotaParams): Promise<CommitQuotaResult> {
    try {
      const transaction = this.database.connection.transaction(
        (input: CommitQuotaParams): CommitQuotaResult => {
          const nowMs = input.nowMs ?? Date.now();
          this.pruneCommittedQuotaWindows(nowMs);
          this.deleteExpiredReservations(nowMs);

          const reservation = this.database.connection
            .prepare(
              `SELECT reservation_id, account_key, session_id, request_id, estimated_tokens,
                      lease_expires_at_ms, created_at_ms
               FROM account_quota_reservations
               WHERE reservation_id = ?`,
            )
            .get(input.reservationId) as
            | {
                reservation_id: string;
                account_key: string;
                session_id: string;
                request_id: string;
                estimated_tokens: number;
                lease_expires_at_ms: number;
                created_at_ms: number;
              }
            | undefined;

          if (!reservation) {
            return {
              reservation: null,
              usage: null,
              committedTokens: 0,
              cachedInputTokens: 0,
            };
          }

          const normalizedReservation: QuotaReservationRecord = {
            reservationId: reservation.reservation_id,
            accountKey: reservation.account_key,
            sessionId: reservation.session_id,
            requestId: reservation.request_id,
            estimatedTokens: Number(reservation.estimated_tokens ?? 0),
            leaseExpiresAtMs: Number(reservation.lease_expires_at_ms ?? 0),
            createdAtMs: Number(reservation.created_at_ms ?? 0),
          };

          const inputTokens = Math.max(0, Math.floor(input.inputTokens));
          const outputTokens = Math.max(0, Math.floor(input.outputTokens));
          const cachedInputTokens = Math.max(0, Math.floor(input.cachedInputTokens));
          const effectiveInputTokens = Math.max(0, inputTokens - cachedInputTokens);
          const committedTokens = effectiveInputTokens + outputTokens;

          this.database.connection
            .prepare(
              `INSERT INTO account_quota_token_events (
                id, account_key, token_count, cached_input_tokens, created_at_ms
              ) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              normalizedReservation.accountKey,
              committedTokens,
              cachedInputTokens,
              nowMs,
            );

          this.database.connection
            .prepare(
              `INSERT INTO account_quota_request_events (
                id, account_key, created_at_ms
              ) VALUES (?, ?, ?)`,
            )
            .run(randomUUID(), normalizedReservation.accountKey, nowMs);

          this.database.connection
            .prepare(`DELETE FROM account_quota_reservations WHERE reservation_id = ?`)
            .run(input.reservationId);

          return {
            reservation: normalizedReservation,
            usage: this.readQuotaUsage(normalizedReservation.accountKey, nowMs),
            committedTokens,
            cachedInputTokens,
          };
        },
      );

      return transaction(params);
    } catch (error) {
      throw toRepositoryError(`Failed to commit quota reservation ${params.reservationId}`, error);
    }
  }

  public async releaseQuota(
    reservationId: string,
    _reason?: string,
    nowMs = Date.now(),
  ): Promise<ReleaseQuotaResult> {
    try {
      const transaction = this.database.connection.transaction(
        (resolvedReservationId: string, currentNowMs: number): ReleaseQuotaResult => {
          this.pruneCommittedQuotaWindows(currentNowMs);
          this.deleteExpiredReservations(currentNowMs);

          const reservation = this.database.connection
            .prepare(
              `SELECT reservation_id, account_key, session_id, request_id, estimated_tokens,
                      lease_expires_at_ms, created_at_ms
               FROM account_quota_reservations
               WHERE reservation_id = ?`,
            )
            .get(resolvedReservationId) as
            | {
                reservation_id: string;
                account_key: string;
                session_id: string;
                request_id: string;
                estimated_tokens: number;
                lease_expires_at_ms: number;
                created_at_ms: number;
              }
            | undefined;

          if (!reservation) {
            return {
              reservation: null,
              usage: null,
              released: false,
            };
          }

          this.database.connection
            .prepare(`DELETE FROM account_quota_reservations WHERE reservation_id = ?`)
            .run(resolvedReservationId);

          const normalizedReservation: QuotaReservationRecord = {
            reservationId: reservation.reservation_id,
            accountKey: reservation.account_key,
            sessionId: reservation.session_id,
            requestId: reservation.request_id,
            estimatedTokens: Number(reservation.estimated_tokens ?? 0),
            leaseExpiresAtMs: Number(reservation.lease_expires_at_ms ?? 0),
            createdAtMs: Number(reservation.created_at_ms ?? 0),
          };

          return {
            reservation: normalizedReservation,
            usage: this.readQuotaUsage(normalizedReservation.accountKey, currentNowMs),
            released: true,
          };
        },
      );

      return transaction(reservationId, nowMs);
    } catch (error) {
      throw toRepositoryError(`Failed to release quota reservation ${reservationId}`, error);
    }
  }

  public async releaseQuotaReservationsForSession(
    sessionId: string,
    _reason?: string,
    nowMs = Date.now(),
  ): Promise<ReleaseSessionQuotaResult> {
    try {
      const transaction = this.database.connection.transaction(
        (resolvedSessionId: string, currentNowMs: number): ReleaseSessionQuotaResult => {
          this.pruneCommittedQuotaWindows(currentNowMs);
          this.deleteExpiredReservations(currentNowMs);

          const rows = this.database.connection
            .prepare(
              `SELECT DISTINCT account_key
               FROM account_quota_reservations
               WHERE session_id = ?`,
            )
            .all(resolvedSessionId) as Array<{ account_key: string }>;

          const releaseResult = this.database.connection
            .prepare(`DELETE FROM account_quota_reservations WHERE session_id = ?`)
            .run(resolvedSessionId);

          return {
            usageByAccount: rows.map((row) => this.readQuotaUsage(row.account_key, currentNowMs)),
            releasedReservations: Number(releaseResult.changes ?? 0),
          };
        },
      );

      return transaction(sessionId, nowMs);
    } catch (error) {
      throw toRepositoryError(`Failed to release quota reservations for session ${sessionId}`, error);
    }
  }

  public async purgeExpiredQuotaReservations(
    nowMs = Date.now(),
  ): Promise<AccountQuotaUsageSnapshot[]> {
    try {
      const transaction = this.database.connection.transaction((currentNowMs: number) => {
        this.pruneCommittedQuotaWindows(currentNowMs);
        const rows = this.database.connection
          .prepare(
            `SELECT DISTINCT account_key
             FROM account_quota_reservations
             WHERE lease_expires_at_ms <= ?`,
          )
          .all(currentNowMs) as Array<{ account_key: string }>;
        this.deleteExpiredReservations(currentNowMs);
        return rows.map((row) => this.readQuotaUsage(row.account_key, currentNowMs));
      });

      return transaction(nowMs);
    } catch (error) {
      throw toRepositoryError("Failed to purge expired quota reservations", error);
    }
  }

  private findMissionRow(id: string): MissionRow | undefined {
    return this.database.connection
      .prepare(`SELECT * FROM missions WHERE id = ?`)
      .get(id) as MissionRow | undefined;
  }

  private pruneCommittedQuotaWindows(nowMs: number): void {
    this.database.connection
      .prepare(`DELETE FROM account_quota_token_events WHERE created_at_ms <= ?`)
      .run(nowMs - TPM_WINDOW_MS);
    this.database.connection
      .prepare(`DELETE FROM account_quota_request_events WHERE created_at_ms <= ?`)
      .run(nowMs - RPD_WINDOW_MS);
  }

  private deleteExpiredReservations(nowMs: number): void {
    this.database.connection
      .prepare(`DELETE FROM account_quota_reservations WHERE lease_expires_at_ms <= ?`)
      .run(nowMs);
  }

  private readQuotaUsage(accountKey: string, nowMs: number): AccountQuotaUsageSnapshot {
    const tokenUsage = this.database.connection
      .prepare(
        `SELECT
            COALESCE(SUM(token_count), 0) AS current_tpm,
            COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens_used
         FROM account_quota_token_events
         WHERE account_key = ?
           AND created_at_ms > ?`,
      )
      .get(accountKey, nowMs - TPM_WINDOW_MS) as {
      current_tpm: number;
      cached_input_tokens_used: number;
    };

    const requestUsage = this.database.connection
      .prepare(
        `SELECT COUNT(*) AS requests_used
         FROM account_quota_request_events
         WHERE account_key = ?
           AND created_at_ms > ?`,
      )
      .get(accountKey, nowMs - RPD_WINDOW_MS) as { requests_used: number };

    const reservationUsage = this.database.connection
      .prepare(
        `SELECT
            COALESCE(SUM(estimated_tokens), 0) AS reserved_tpm,
            COUNT(*) AS reserved_requests
         FROM account_quota_reservations
         WHERE account_key = ?
           AND lease_expires_at_ms > ?`,
      )
      .get(accountKey, nowMs) as {
      reserved_tpm: number;
      reserved_requests: number;
    };

    return {
      accountKey,
      currentTPM: Number(tokenUsage.current_tpm ?? 0),
      requestsUsed: Number(requestUsage.requests_used ?? 0),
      reservedTPM: Number(reservationUsage.reserved_tpm ?? 0),
      reservedRequests: Number(reservationUsage.reserved_requests ?? 0),
      cachedInputTokensUsed: Number(tokenUsage.cached_input_tokens_used ?? 0),
    };
  }
}
