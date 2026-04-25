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

export interface QuotaRepository {
  initializeQuotaState(nowMs?: number): Promise<InitializeQuotaStateResult>;
  getQuotaUsage(accountKey: string, nowMs?: number): Promise<AccountQuotaUsageSnapshot>;
  reserveQuota(params: ReserveQuotaParams): Promise<ReserveQuotaResult>;
  commitQuota(params: CommitQuotaParams): Promise<CommitQuotaResult>;
  releaseQuota(reservationId: string, reason?: string, nowMs?: number): Promise<ReleaseQuotaResult>;
  releaseQuotaReservationsForSession(
    sessionId: string,
    reason?: string,
    nowMs?: number
  ): Promise<ReleaseSessionQuotaResult>;
  purgeExpiredQuotaReservations(nowMs?: number): Promise<AccountQuotaUsageSnapshot[]>;
}

export class InMemoryQuotaRepository implements QuotaRepository {
  private readonly reservations = new Map<string, QuotaReservationRecord>();
  private readonly tokenEvents: {
    accountKey: string;
    tokenCount: number;
    cachedInputTokens: number;
    createdAtMs: number;
  }[] = [];
  private readonly requestEvents: { accountKey: string; createdAtMs: number }[] = [];
  private readonly TPM_WINDOW_MS = 60_000;
  private readonly RPD_WINDOW_MS = 24 * 60 * 60 * 1000;

  public async initializeQuotaState(nowMs = Date.now()): Promise<InitializeQuotaStateResult> {
    const count = this.reservations.size;
    this.reservations.clear();
    this.pruneEvents(nowMs);
    return { clearedReservations: count };
  }

  public async getQuotaUsage(
    accountKey: string,
    nowMs = Date.now(),
  ): Promise<AccountQuotaUsageSnapshot> {
    this.pruneEvents(nowMs);
    return this.readUsage(accountKey, nowMs);
  }

  public async reserveQuota(params: ReserveQuotaParams): Promise<ReserveQuotaResult> {
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

    const reservation: QuotaReservationRecord = {
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

  public async commitQuota(params: CommitQuotaParams): Promise<CommitQuotaResult> {
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

  public async releaseQuota(reservationId: string, _reason?: string, nowMs = Date.now()): Promise<ReleaseQuotaResult> {
    const res = this.reservations.get(reservationId);
    if (!res) return { reservation: null, usage: null, released: false };
    this.reservations.delete(reservationId);
    return { reservation: res, usage: this.readUsage(res.accountKey, nowMs), released: true };
  }

  public async releaseQuotaReservationsForSession(
    sessionId: string,
    _reason?: string,
    nowMs = Date.now()
  ): Promise<ReleaseSessionQuotaResult> {
    const affectedAccounts = new Set<string>();
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

  public async purgeExpiredQuotaReservations(nowMs = Date.now()): Promise<AccountQuotaUsageSnapshot[]> {
    const affectedAccounts = new Set<string>();
    for (const [id, res] of this.reservations.entries()) {
      if (res.leaseExpiresAtMs <= nowMs) {
        affectedAccounts.add(res.accountKey);
        this.reservations.delete(id);
      }
    }
    return Array.from(affectedAccounts).map((acc) => this.readUsage(acc, nowMs));
  }

  private pruneEvents(nowMs: number) {
    const tpmCutoff = nowMs - this.TPM_WINDOW_MS;
    const rpdCutoff = nowMs - this.RPD_WINDOW_MS;
    while (this.tokenEvents.length > 0 && this.tokenEvents[0]!.createdAtMs < tpmCutoff) {
      this.tokenEvents.shift();
    }
    while (this.requestEvents.length > 0 && this.requestEvents[0]!.createdAtMs < rpdCutoff) {
      this.requestEvents.shift();
    }
    for (const [id, res] of this.reservations.entries()) {
      if (res.leaseExpiresAtMs <= nowMs) {
        this.reservations.delete(id);
      }
    }
  }

  private readUsage(accountKey: string, nowMs: number): AccountQuotaUsageSnapshot {
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
