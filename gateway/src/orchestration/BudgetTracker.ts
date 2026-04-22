import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AutonomySession, BudgetLimits, BudgetUsage } from "./autonomy-types";
import {
  InMemoryMissionRepository,
  type AccountQuotaUsageSnapshot,
  type MissionRepository,
  type QuotaReservationRecord,
} from "../repositories/mission.repository";

const TPM_WARNING_RATIO = 0.90;
const RPD_WARNING_RATIO = 0.90;
const SESSION_TPM_WINDOW_MS = 60_000;
const SESSION_RPD_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEPER_INTERVAL_MS = 1_000;

type QuotaMetric = "tpm" | "rpd";

export interface BudgetReservationRequest {
  requestId: string;
  estimatedTokens: number;
  leaseExpiresAtMs: number;
}

export interface BudgetReservationDecision {
  accepted: boolean;
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot;
  reason: string | null;
}

export interface BudgetCommitUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  cachedInputTokens: number;
}

export interface BudgetCommitResult {
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot | null;
  committedTokens: number;
  cachedInputTokens: number;
}

export interface BudgetExecutionAccounting {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  cachedInputTokens: number;
  usage: AccountQuotaUsageSnapshot;
}

export interface TransactionRecord {
  id: string;
  sessionId: string;
  agentRole: string;
  modelId: string;
  tokens: { input: number; output: number; cached: number };
  costUsd: number;
  timestamp: number;
}

export class BudgetReservationError extends Error {
  constructor(
    message: string,
    public readonly usage: AccountQuotaUsageSnapshot,
  ) {
    super(message);
    this.name = "BudgetReservationError";
  }
}

interface BudgetTrackerOptions {
  repository?: MissionRepository;
  sweeperIntervalMs?: number;
}

/**
 * BudgetTracker coordinates account-wide quota admission while still updating
 * per-session budget views for the runtime and UI.
 */
export class BudgetTracker {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalUsd = 0;
  private readonly startTime = Date.now();
  private tokenHistory: { timestamp: number; input: number; output: number }[] = [];
  private sessionTokenWindows = new Map<string, { timestamp: number; tokens: number }[]>();
  private sessionRequestWindows = new Map<string, number[]>();
  private readonly accountSessions = new Map<string, Set<AutonomySession>>();
  private readonly repository: MissionRepository;
  private readonly sweeperInterval: ReturnType<typeof setInterval>;
  private readonly ROLLING_WINDOW_MS = 300_000;
  private readonly projectRoot: string;
  private readonly ledgerFile: string;

  constructor(options: BudgetTrackerOptions & { projectRoot?: string } = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.ledgerFile = path.join(this.projectRoot, '.ai-company', 'ledger.jsonl');
    this.repository = options.repository ?? new InMemoryMissionRepository();
    const sweeperIntervalMs =
      typeof options.sweeperIntervalMs === "number" && options.sweeperIntervalMs > 0
        ? Math.floor(options.sweeperIntervalMs)
        : DEFAULT_SWEEPER_INTERVAL_MS;
    this.sweeperInterval = setInterval(() => {
      void this.purgeExpiredReservations();
    }, sweeperIntervalMs);
    this.sweeperInterval.unref?.();
  }

  public async initialize(nowMs = Date.now()): Promise<void> {
    await this.repository.initializeQuotaState(nowMs);
  }

  public dispose(): void {
    clearInterval(this.sweeperInterval);
  }

  public attachSession(session: AutonomySession): void {
    const sessions = this.accountSessions.get(session.account) ?? new Set<AutonomySession>();
    sessions.add(session);
    this.accountSessions.set(session.account, sessions);
  }

  public detachSession(session: Pick<AutonomySession, "id" | "account">): void {
    const sessions = this.accountSessions.get(session.account);
    if (!sessions) {
      return;
    }
    for (const current of sessions) {
      if (current.id === session.id) {
        sessions.delete(current);
      }
    }
    if (sessions.size === 0) {
      this.accountSessions.delete(session.account);
    }
  }

  public async reserve(
    session: AutonomySession,
    request: BudgetReservationRequest,
  ): Promise<BudgetReservationDecision> {
    this.attachSession(session);
    const result = await this.repository.reserveQuota({
      accountKey: session.account,
      sessionId: session.id,
      requestId: request.requestId,
      estimatedTokens: Math.max(0, Math.floor(request.estimatedTokens)),
      maxTPM: session.budgets.limits.maxTPM,
      maxRPD: session.budgets.limits.maxRPD,
      leaseExpiresAtMs: request.leaseExpiresAtMs,
    });
    this.applyUsageToAccount(result.usage);
    return result;
  }

  public async commit(
    reservationId: string,
    usage: BudgetCommitUsage,
  ): Promise<BudgetCommitResult> {
    const result = await this.repository.commitQuota({
      reservationId,
      inputTokens: Math.max(0, Math.floor(usage.inputTokens)),
      outputTokens: Math.max(0, Math.floor(usage.outputTokens)),
      cachedInputTokens: Math.max(0, Math.floor(usage.cachedInputTokens)),
    });
    if (result.usage && result.reservation) {
      this.applyUsageToAccount(result.usage);
      this.totalInputTokens += Math.max(0, Math.floor(usage.inputTokens));
      this.totalOutputTokens += Math.max(0, Math.floor(usage.outputTokens));
      this.totalUsd += Math.max(0, usage.estimatedUsd);
      this.tokenHistory.push({
        timestamp: Date.now(),
        input: Math.max(0, Math.floor(usage.inputTokens)),
        output: Math.max(0, Math.floor(usage.outputTokens)),
      });
      this.cleanupHistory();
      
      // Advanced: Transactional Ledger
      void this.recordTransaction({
        id: Math.random().toString(36).slice(2, 11),
        sessionId: reservationId.split('_')[1] || 'unknown',
        agentRole: 'unknown', // Role would need to be passed in for full precision
        modelId: 'active_model',
        tokens: { 
          input: Math.max(0, Math.floor(usage.inputTokens)), 
          output: Math.max(0, Math.floor(usage.outputTokens)), 
          cached: Math.max(0, Math.floor(usage.cachedInputTokens)) 
        },
        costUsd: Math.max(0, usage.estimatedUsd),
        timestamp: Date.now()
      });
    }
    return result;
  }

  private async recordTransaction(record: TransactionRecord): Promise<void> {
    try {
      const line = JSON.stringify(record) + '\n';
      await fs.mkdir(path.dirname(this.ledgerFile), { recursive: true });
      await fs.appendFile(this.ledgerFile, line, 'utf-8');
    } catch (err) {
      console.error('[BudgetTracker] Failed to record transaction:', err);
    }
  }

  public async release(
    reservationId: string,
    reason?: string,
  ): Promise<void> {
    const result = await this.repository.releaseQuota(reservationId, reason);
    if (result.usage) {
      this.applyUsageToAccount(result.usage);
    }
  }

  public async releaseAllForSession(sessionId: string, reason?: string): Promise<void> {
    const result = await this.repository.releaseQuotaReservationsForSession(sessionId, reason);
    for (const usage of result.usageByAccount) {
      this.applyUsageToAccount(usage);
    }
  }

  public applyExecutionUsage(session: AutonomySession, execution: BudgetExecutionAccounting): void {
    this.attachSession(session);
    const safeInputTokens = Math.max(0, Math.floor(execution.inputTokens));
    const safeOutputTokens = Math.max(0, Math.floor(execution.outputTokens));
    const safeEstimatedUsd = Math.max(0, execution.estimatedUsd);
    session.budgets.usage.inputTokensUsed += safeInputTokens;
    session.budgets.usage.outputTokensUsed += safeOutputTokens;
    session.budgets.usage.usdUsed += safeEstimatedUsd;
    this.applyUsageSnapshot(session, execution.usage);
  }

  /**
   * Legacy post-response accounting retained for direct unit tests and
   * compatibility with older callers. Runtime quota admission should use
   * reserve/commit/release instead.
   */
  public consume(
    session: AutonomySession,
    inputTokens: number,
    outputTokens: number,
    estimatedUsd: number,
  ): void {
    const safeInputTokens = Math.max(0, Math.floor(inputTokens));
    const safeOutputTokens = Math.max(0, Math.floor(outputTokens));
    const safeEstimatedUsd = Math.max(0, estimatedUsd);
    const usage = session.budgets.usage;
    const createdAt = Date.parse(session.createdAt);

    usage.cyclesUsed = session.cycleCount;
    usage.durationMsUsed = Date.now() - createdAt;
    usage.inputTokensUsed += safeInputTokens;
    usage.outputTokensUsed += safeOutputTokens;
    usage.usdUsed += safeEstimatedUsd;

    this.totalInputTokens += safeInputTokens;
    this.totalOutputTokens += safeOutputTokens;
    this.totalUsd += safeEstimatedUsd;

    this.tokenHistory.push({
      timestamp: Date.now(),
      input: safeInputTokens,
      output: safeOutputTokens,
    });
    this.cleanupHistory();
    this.recordSessionUsage(session.id, safeInputTokens + safeOutputTokens);
    this.refreshUsage(session);
  }

  public checkWarning(session: AutonomySession): string | null {
    const { usage, limits } = session.budgets;
    this.refreshUsage(session);
    const currentTPM = (usage.currentTPM ?? 0) + (usage.reservedTPM ?? 0);
    const currentRPD = (usage.requestsUsed ?? 0) + (usage.reservedRequests ?? 0);
    const warningReason =
      this.checkApproachingQuota("tpm", currentTPM, limits.maxTPM, TPM_WARNING_RATIO) ??
      this.checkApproachingQuota("rpd", currentRPD, limits.maxRPD, RPD_WARNING_RATIO) ??
      (limits.maxUsd && usage.usdUsed >= limits.maxUsd * 0.90
        ? `BUDGET_WARNING: usd ${usage.usdUsed.toFixed(4)}/${limits.maxUsd.toFixed(4)}`
        : null);

    session.budgets.warning = warningReason !== null;
    session.budgets.warningReason = warningReason;
    return warningReason;
  }

  public checkExceeded(session: AutonomySession): boolean {
    const { usage, limits } = session.budgets;
    this.refreshUsage(session);
    const currentTPM = (usage.currentTPM ?? 0) + (usage.reservedTPM ?? 0);
    const currentRPD = (usage.requestsUsed ?? 0) + (usage.reservedRequests ?? 0);

    if (usage.cyclesUsed >= limits.maxCycles) {
      return this.markExceeded(
        session,
        `BUDGET_EXCEEDED: cycles budget exhausted (${usage.cyclesUsed}/${limits.maxCycles})`,
      );
    }

    if (usage.durationMsUsed >= limits.maxDurationMs) {
      return this.markExceeded(
        session,
        `BUDGET_EXCEEDED: duration ${usage.durationMsUsed}/${limits.maxDurationMs}ms`,
      );
    }

    if (currentTPM >= limits.maxTPM) {
      return this.markExceeded(session, `BUDGET_EXCEEDED: tpm ${currentTPM}/${limits.maxTPM}`);
    }

    if (currentRPD >= limits.maxRPD) {
      return this.markExceeded(session, `BUDGET_EXCEEDED: rpd ${currentRPD}/${limits.maxRPD}`);
    }

    if (usage.inputTokensUsed >= limits.maxInputTokens) {
      return this.markExceeded(
        session,
        `BUDGET_EXCEEDED: input tokens ${usage.inputTokensUsed}/${limits.maxInputTokens}`,
      );
    }

    if (usage.outputTokensUsed >= limits.maxOutputTokens) {
      return this.markExceeded(
        session,
        `BUDGET_EXCEEDED: output tokens ${usage.outputTokensUsed}/${limits.maxOutputTokens}`,
      );
    }

    if (typeof limits.maxUsd === "number" && limits.maxUsd > 0 && usage.usdUsed >= limits.maxUsd) {
      return this.markExceeded(
        session,
        `BUDGET_EXCEEDED: usd ${usage.usdUsed.toFixed(4)}/${limits.maxUsd.toFixed(4)}`,
      );
    }

    session.budgets.warning = false;
    session.budgets.warningReason = null;
    session.budgets.exceeded = false;
    session.budgets.exceedReason = null;
    return false;
  }

  public getUsagePercentage(session: AutonomySession, metric: keyof BudgetLimits): number {
    const { usage, limits } = session.budgets;
    const limit = limits[metric] ?? 0;
    const currentValue = this.metricValueForLimit(metric, usage);
    if (limit <= 0) return 0;
    return (currentValue / limit) * 100;
  }

  public getTokenVelocity(): number {
    const total = this.tokenHistory.reduce((acc, h) => acc + h.input + h.output, 0);
    return Math.round(total / (this.ROLLING_WINDOW_MS / 1000));
  }

  private async purgeExpiredReservations(): Promise<void> {
    const usages = await this.repository.purgeExpiredQuotaReservations();
    for (const usage of usages) {
      this.applyUsageToAccount(usage);
    }
  }

  private applyUsageToAccount(usage: AccountQuotaUsageSnapshot): void {
    const sessions = this.accountSessions.get(usage.accountKey);
    if (!sessions || sessions.size === 0) {
      return;
    }
    for (const session of sessions) {
      this.applyUsageSnapshot(session, usage);
    }
  }

  private applyUsageSnapshot(session: AutonomySession, usage: AccountQuotaUsageSnapshot): void {
    session.budgets.usage.currentTPM = Math.max(0, Math.floor(usage.currentTPM));
    session.budgets.usage.requestsUsed = Math.max(0, Math.floor(usage.requestsUsed));
    session.budgets.usage.reservedTPM = Math.max(0, Math.floor(usage.reservedTPM));
    session.budgets.usage.reservedRequests = Math.max(0, Math.floor(usage.reservedRequests));
    session.budgets.usage.cachedInputTokensUsed = Math.max(
      0,
      Math.floor(usage.cachedInputTokensUsed),
    );
    this.refreshUsage(session);
  }

  private markExceeded(session: AutonomySession, reason: string): boolean {
    session.budgets.warning = false;
    session.budgets.warningReason = null;
    session.budgets.exceeded = true;
    session.budgets.exceedReason = reason;
    return true;
  }

  private refreshUsage(session: AutonomySession): void {
    const { usage } = session.budgets;
    usage.currentTPM = Math.max(0, Math.floor(usage.currentTPM ?? 0));
    usage.requestsUsed = Math.max(0, Math.floor(usage.requestsUsed ?? 0));
    usage.reservedTPM = Math.max(0, Math.floor(usage.reservedTPM ?? 0));
    usage.reservedRequests = Math.max(0, Math.floor(usage.reservedRequests ?? 0));
    usage.cachedInputTokensUsed = Math.max(0, Math.floor(usage.cachedInputTokensUsed ?? 0));
    usage.cyclesUsed = session.cycleCount;
    usage.durationMsUsed = Date.now() - Date.parse(session.createdAt);
    if (
      this.sessionTokenWindows.has(session.id) ||
      this.sessionRequestWindows.has(session.id)
    ) {
      this.syncRollingUsage(session);
    }
  }

  private checkApproachingQuota(
    metric: QuotaMetric,
    usage: number,
    limit: number,
    thresholdRatio: number,
  ): string | null {
    if (limit <= 0) return null;
    if (usage < Math.ceil(limit * thresholdRatio)) return null;
    if (usage >= limit) return null;
    return `BUDGET_WARNING: ${metric} ${this.formatMetricValue(metric, usage)}/${this.formatMetricValue(metric, limit)}`;
  }

  private recordSessionUsage(sessionId: string, totalTokens: number): void {
    const now = Date.now();
    const tokenEntries = this.sessionTokenWindows.get(sessionId) ?? [];
    tokenEntries.push({ timestamp: now, tokens: totalTokens });
    this.sessionTokenWindows.set(sessionId, tokenEntries);

    const requestEntries = this.sessionRequestWindows.get(sessionId) ?? [];
    requestEntries.push(now);
    this.sessionRequestWindows.set(sessionId, requestEntries);
  }

  private syncRollingUsage(session: AutonomySession): void {
    const now = Date.now();
    const tokenEntries = (this.sessionTokenWindows.get(session.id) ?? []).filter(
      (entry) => now - entry.timestamp < SESSION_TPM_WINDOW_MS,
    );
    this.sessionTokenWindows.set(session.id, tokenEntries);

    const requestEntries = (this.sessionRequestWindows.get(session.id) ?? []).filter(
      (timestamp) => now - timestamp < SESSION_RPD_WINDOW_MS,
    );
    this.sessionRequestWindows.set(session.id, requestEntries);

    session.budgets.usage.currentTPM = tokenEntries.reduce((total, entry) => total + entry.tokens, 0);
    session.budgets.usage.requestsUsed = requestEntries.length;
  }

  private formatMetricValue(metric: QuotaMetric, value: number): string {
    if (metric === "rpd") {
      return Math.floor(value).toString();
    }
    return Math.floor(value).toString();
  }

  private metricValueForLimit(metric: keyof BudgetLimits, usage: BudgetUsage): number {
    switch (metric) {
      case "maxCycles":
        return usage.cyclesUsed;
      case "maxDurationMs":
        return usage.durationMsUsed;
      case "maxInputTokens":
        return usage.inputTokensUsed;
      case "maxOutputTokens":
        return usage.outputTokensUsed;
      case "maxTPM":
        return usage.currentTPM + (usage.reservedTPM ?? 0);
      case "maxRPD":
        return usage.requestsUsed + (usage.reservedRequests ?? 0);
      case "maxUsd":
        return usage.usdUsed;
      default:
        return 0;
    }
  }

  private cleanupHistory(): void {
    const now = Date.now();
    this.tokenHistory = this.tokenHistory.filter((h) => now - h.timestamp < this.ROLLING_WINDOW_MS);
  }
}

export const budgetTracker = new BudgetTracker();
