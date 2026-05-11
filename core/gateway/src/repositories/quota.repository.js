"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryQuotaRepository = void 0;
class InMemoryQuotaRepository {
    reservations = new Map();
    tokenEvents = [];
    requestEvents = [];
    TPM_WINDOW_MS = 60_000;
    RPD_WINDOW_MS = 24 * 60 * 60 * 1000;
    async initializeQuotaState(nowMs = Date.now()) {
        const count = this.reservations.size;
        this.reservations.clear();
        this.pruneEvents(nowMs);
        return { clearedReservations: count };
    }
    async getQuotaUsage(accountKey, nowMs = Date.now()) {
        this.pruneEvents(nowMs);
        return this.readUsage(accountKey, nowMs);
    }
    async reserveQuota(params) {
        const nowMs = params.nowMs ?? Date.now();
        this.pruneEvents(nowMs);
        const usage = this.readUsage(params.accountKey, nowMs);
        const projectedTPM = usage.currentTPM + usage.reservedTPM + params.estimatedTokens;
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
        const reservation = {
            reservationId: Math.random().toString(36).substring(7),
            accountKey: params.accountKey,
            sessionId: params.sessionId,
            requestId: params.requestId,
            estimatedTokens: params.estimatedTokens,
            leaseExpiresAtMs: params.leaseExpiresAtMs,
            createdAtMs: nowMs,
        };
        this.reservations.set(reservation.reservationId, reservation);
        return {
            accepted: true,
            reservation,
            usage: this.readUsage(params.accountKey, nowMs),
            reason: null,
        };
    }
    async commitQuota(params) {
        const nowMs = params.nowMs ?? Date.now();
        const res = this.reservations.get(params.reservationId);
        if (!res) {
            return { reservation: null, usage: null, committedTokens: 0, cachedInputTokens: 0 };
        }
        const committedTokens = Math.max(0, params.inputTokens - params.cachedInputTokens) + params.outputTokens;
        this.tokenEvents.push({
            accountKey: res.accountKey,
            tokenCount: committedTokens,
            cachedInputTokens: params.cachedInputTokens,
            createdAtMs: nowMs,
        });
        this.requestEvents.push({ accountKey: res.accountKey, createdAtMs: nowMs });
        this.reservations.delete(params.reservationId);
        return {
            reservation: res,
            usage: this.readUsage(res.accountKey, nowMs),
            committedTokens,
            cachedInputTokens: params.cachedInputTokens,
        };
    }
    async releaseQuota(reservationId, _reason, nowMs = Date.now()) {
        const res = this.reservations.get(reservationId);
        if (!res)
            return { reservation: null, usage: null, released: false };
        this.reservations.delete(reservationId);
        return { reservation: res, usage: this.readUsage(res.accountKey, nowMs), released: true };
    }
    async releaseQuotaReservationsForSession(sessionId, _reason, nowMs = Date.now()) {
        const affectedAccounts = new Set();
        let releasedCount = 0;
        for (const [id, res] of this.reservations.entries()) {
            if (res.sessionId === sessionId) {
                affectedAccounts.add(res.accountKey);
                this.reservations.delete(id);
                releasedCount++;
            }
        }
        return {
            usageByAccount: Array.from(affectedAccounts).map((acc) => this.readUsage(acc, nowMs)),
            releasedReservations: releasedCount,
        };
    }
    async purgeExpiredQuotaReservations(nowMs = Date.now()) {
        const affectedAccounts = new Set();
        for (const [id, res] of this.reservations.entries()) {
            if (res.leaseExpiresAtMs <= nowMs) {
                affectedAccounts.add(res.accountKey);
                this.reservations.delete(id);
            }
        }
        return Array.from(affectedAccounts).map((acc) => this.readUsage(acc, nowMs));
    }
    pruneEvents(nowMs) {
        const tpmCutoff = nowMs - this.TPM_WINDOW_MS;
        const rpdCutoff = nowMs - this.RPD_WINDOW_MS;
        while (this.tokenEvents.length > 0 && this.tokenEvents[0].createdAtMs < tpmCutoff) {
            this.tokenEvents.shift();
        }
        while (this.requestEvents.length > 0 && this.requestEvents[0].createdAtMs < rpdCutoff) {
            this.requestEvents.shift();
        }
        for (const [id, res] of this.reservations.entries()) {
            if (res.leaseExpiresAtMs <= nowMs) {
                this.reservations.delete(id);
            }
        }
    }
    readUsage(accountKey, nowMs) {
        let currentTPM = 0;
        let cachedInputTokensUsed = 0;
        for (const event of this.tokenEvents) {
            if (event.accountKey === accountKey) {
                currentTPM += event.tokenCount;
                cachedInputTokensUsed += event.cachedInputTokens;
            }
        }
        let requestsUsed = 0;
        for (const event of this.requestEvents) {
            if (event.accountKey === accountKey) {
                requestsUsed++;
            }
        }
        let reservedTPM = 0;
        let reservedRequests = 0;
        for (const res of this.reservations.values()) {
            if (res.accountKey === accountKey && res.leaseExpiresAtMs > nowMs) {
                reservedTPM += res.estimatedTokens;
                reservedRequests++;
            }
        }
        return {
            accountKey,
            currentTPM,
            requestsUsed,
            reservedTPM,
            reservedRequests,
            cachedInputTokensUsed,
        };
    }
}
exports.InMemoryQuotaRepository = InMemoryQuotaRepository;
//# sourceMappingURL=quota.repository.js.map