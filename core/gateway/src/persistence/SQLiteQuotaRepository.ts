import { randomUUID } from "node:crypto";
import type { MissionDatabase } from "./database";
import type { QuotaRepository } from "../repositories/quota.repository";
import {
  type AccountQuotaUsageSnapshot,
  type CommitQuotaParams,
  type CommitQuotaResult,
  type InitializeQuotaStateResult,
  type QuotaReservationRecord,
  type ReleaseQuotaResult,
  type ReleaseSessionQuotaResult,
  type ReserveQuotaParams,
  type ReserveQuotaResult,
} from "../orchestration/autonomy-types";

const TPM_WINDOW_MS = 60_000;
const RPD_WINDOW_MS = 24 * 60 * 60 * 1000;

export class SQLiteQuotaRepository implements QuotaRepository {
  constructor(private readonly database: MissionDatabase) {}

  public async initializeQuotaState(nowMs = Date.now()): Promise<InitializeQuotaStateResult> {
    const transaction = this.database.connection.transaction((currentNowMs: number) => {
      this.pruneCommittedQuotaWindows(currentNowMs);
      const clearedReservations = this.database.connection
        .prepare(`SELECT COUNT(*) AS count FROM account_quota_reservations`)
        .get() as { count: number };
      this.database.connection.prepare(`DELETE FROM account_quota_reservations`).run();
      return { clearedReservations: Number(clearedReservations.count ?? 0) };
    });

    return transaction(nowMs);
  }

  public async getQuotaUsage(
    accountKey: string,
    nowMs = Date.now(),
  ): Promise<AccountQuotaUsageSnapshot> {
    const transaction = this.database.connection.transaction(
      (resolvedAccountKey: string, currentNowMs: number) => {
        this.pruneCommittedQuotaWindows(currentNowMs);
        this.deleteExpiredReservations(currentNowMs);
        return this.readQuotaUsage(resolvedAccountKey, currentNowMs);
      },
    );
    return transaction(accountKey, nowMs);
  }

  public async reserveQuota(params: ReserveQuotaParams): Promise<ReserveQuotaResult> {
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
  }

  public async commitQuota(params: CommitQuotaParams): Promise<CommitQuotaResult> {
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
  }

  public async releaseQuota(
    reservationId: string,
    _reason?: string,
    nowMs = Date.now(),
  ): Promise<ReleaseQuotaResult> {
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
  }

  public async releaseQuotaReservationsForSession(
    sessionId: string,
    _reason?: string,
    nowMs = Date.now(),
  ): Promise<ReleaseSessionQuotaResult> {
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
  }

  public async purgeExpiredQuotaReservations(
    nowMs = Date.now(),
  ): Promise<AccountQuotaUsageSnapshot[]> {
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
