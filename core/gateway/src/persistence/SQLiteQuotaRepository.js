"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQLiteQuotaRepository = void 0;
const node_crypto_1 = require("node:crypto");
const TPM_WINDOW_MS = 60_000;
const RPD_WINDOW_MS = 24 * 60 * 60 * 1000;
class SQLiteQuotaRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    async initializeQuotaState(nowMs = Date.now()) {
        const transaction = this.database.connection.transaction((currentNowMs) => {
            this.pruneCommittedQuotaWindows(currentNowMs);
            const clearedReservations = this.database.connection
                .prepare(`SELECT COUNT(*) AS count FROM account_quota_reservations`)
                .get();
            this.database.connection.prepare(`DELETE FROM account_quota_reservations`).run();
            return { clearedReservations: Number(clearedReservations.count ?? 0) };
        });
        return transaction(nowMs);
    }
    async getQuotaUsage(accountKey, nowMs = Date.now()) {
        const transaction = this.database.connection.transaction((resolvedAccountKey, currentNowMs) => {
            this.pruneCommittedQuotaWindows(currentNowMs);
            this.deleteExpiredReservations(currentNowMs);
            return this.readQuotaUsage(resolvedAccountKey, currentNowMs);
        });
        return transaction(accountKey, nowMs);
    }
    async reserveQuota(params) {
        const transaction = this.database.connection.transaction((input) => {
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
            const reservation = {
                reservationId: (0, node_crypto_1.randomUUID)(),
                accountKey: input.accountKey,
                sessionId: input.sessionId,
                requestId: input.requestId,
                estimatedTokens,
                leaseExpiresAtMs: Math.max(nowMs + 1, Math.floor(input.leaseExpiresAtMs)),
                createdAtMs: nowMs,
            };
            this.database.connection
                .prepare(`INSERT INTO account_quota_reservations (
              reservation_id, account_key, session_id, request_id, estimated_tokens,
              lease_expires_at_ms, created_at_ms
            ) VALUES (
              @reservation_id, @account_key, @session_id, @request_id, @estimated_tokens,
              @lease_expires_at_ms, @created_at_ms
            )`)
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
        });
        return transaction(params);
    }
    async commitQuota(params) {
        const transaction = this.database.connection.transaction((input) => {
            const nowMs = input.nowMs ?? Date.now();
            this.pruneCommittedQuotaWindows(nowMs);
            this.deleteExpiredReservations(nowMs);
            const reservation = this.database.connection
                .prepare(`SELECT reservation_id, account_key, session_id, request_id, estimated_tokens,
                    lease_expires_at_ms, created_at_ms
             FROM account_quota_reservations
             WHERE reservation_id = ?`)
                .get(input.reservationId);
            if (!reservation) {
                return {
                    reservation: null,
                    usage: null,
                    committedTokens: 0,
                    cachedInputTokens: 0,
                };
            }
            const normalizedReservation = {
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
                .prepare(`INSERT INTO account_quota_token_events (
              id, account_key, token_count, cached_input_tokens, created_at_ms
            ) VALUES (?, ?, ?, ?, ?)`)
                .run((0, node_crypto_1.randomUUID)(), normalizedReservation.accountKey, committedTokens, cachedInputTokens, nowMs);
            this.database.connection
                .prepare(`INSERT INTO account_quota_request_events (
              id, account_key, created_at_ms
            ) VALUES (?, ?, ?)`)
                .run((0, node_crypto_1.randomUUID)(), normalizedReservation.accountKey, nowMs);
            this.database.connection
                .prepare(`DELETE FROM account_quota_reservations WHERE reservation_id = ?`)
                .run(input.reservationId);
            return {
                reservation: normalizedReservation,
                usage: this.readQuotaUsage(normalizedReservation.accountKey, nowMs),
                committedTokens,
                cachedInputTokens,
            };
        });
        return transaction(params);
    }
    async releaseQuota(reservationId, _reason, nowMs = Date.now()) {
        const transaction = this.database.connection.transaction((resolvedReservationId, currentNowMs) => {
            this.pruneCommittedQuotaWindows(currentNowMs);
            this.deleteExpiredReservations(currentNowMs);
            const reservation = this.database.connection
                .prepare(`SELECT reservation_id, account_key, session_id, request_id, estimated_tokens,
                    lease_expires_at_ms, created_at_ms
             FROM account_quota_reservations
             WHERE reservation_id = ?`)
                .get(resolvedReservationId);
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
            const normalizedReservation = {
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
        });
        return transaction(reservationId, nowMs);
    }
    async releaseQuotaReservationsForSession(sessionId, _reason, nowMs = Date.now()) {
        const transaction = this.database.connection.transaction((resolvedSessionId, currentNowMs) => {
            this.pruneCommittedQuotaWindows(currentNowMs);
            this.deleteExpiredReservations(currentNowMs);
            const rows = this.database.connection
                .prepare(`SELECT DISTINCT account_key
             FROM account_quota_reservations
             WHERE session_id = ?`)
                .all(resolvedSessionId);
            const releaseResult = this.database.connection
                .prepare(`DELETE FROM account_quota_reservations WHERE session_id = ?`)
                .run(resolvedSessionId);
            return {
                usageByAccount: rows.map((row) => this.readQuotaUsage(row.account_key, currentNowMs)),
                releasedReservations: Number(releaseResult.changes ?? 0),
            };
        });
        return transaction(sessionId, nowMs);
    }
    async purgeExpiredQuotaReservations(nowMs = Date.now()) {
        const transaction = this.database.connection.transaction((currentNowMs) => {
            this.pruneCommittedQuotaWindows(currentNowMs);
            const rows = this.database.connection
                .prepare(`SELECT DISTINCT account_key
           FROM account_quota_reservations
           WHERE lease_expires_at_ms <= ?`)
                .all(currentNowMs);
            this.deleteExpiredReservations(currentNowMs);
            return rows.map((row) => this.readQuotaUsage(row.account_key, currentNowMs));
        });
        return transaction(nowMs);
    }
    pruneCommittedQuotaWindows(nowMs) {
        this.database.connection
            .prepare(`DELETE FROM account_quota_token_events WHERE created_at_ms <= ?`)
            .run(nowMs - TPM_WINDOW_MS);
        this.database.connection
            .prepare(`DELETE FROM account_quota_request_events WHERE created_at_ms <= ?`)
            .run(nowMs - RPD_WINDOW_MS);
    }
    deleteExpiredReservations(nowMs) {
        this.database.connection
            .prepare(`DELETE FROM account_quota_reservations WHERE lease_expires_at_ms <= ?`)
            .run(nowMs);
    }
    readQuotaUsage(accountKey, nowMs) {
        const tokenUsage = this.database.connection
            .prepare(`SELECT
            COALESCE(SUM(token_count), 0) AS current_tpm,
            COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens_used
         FROM account_quota_token_events
         WHERE account_key = ?
           AND created_at_ms > ?`)
            .get(accountKey, nowMs - TPM_WINDOW_MS);
        const requestUsage = this.database.connection
            .prepare(`SELECT COUNT(*) AS requests_used
         FROM account_quota_request_events
         WHERE account_key = ?
           AND created_at_ms > ?`)
            .get(accountKey, nowMs - RPD_WINDOW_MS);
        const reservationUsage = this.database.connection
            .prepare(`SELECT
            COALESCE(SUM(estimated_tokens), 0) AS reserved_tpm,
            COUNT(*) AS reserved_requests
         FROM account_quota_reservations
         WHERE account_key = ?
           AND lease_expires_at_ms > ?`)
            .get(accountKey, nowMs);
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
exports.SQLiteQuotaRepository = SQLiteQuotaRepository;
//# sourceMappingURL=SQLiteQuotaRepository.js.map