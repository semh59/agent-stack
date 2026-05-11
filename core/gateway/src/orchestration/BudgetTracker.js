"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.budgetTracker = exports.BudgetTracker = exports.BudgetReservationError = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const SQLiteQuotaRepository_1 = require("../persistence/SQLiteQuotaRepository");
const database_1 = require("../persistence/database");
const TPM_WARNING_RATIO = 0.90;
const RPD_WARNING_RATIO = 0.90;
const SESSION_TPM_WINDOW_MS = 60_000;
const SESSION_RPD_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEPER_INTERVAL_MS = 1_000;
class BudgetReservationError extends Error {
    usage;
    constructor(message, usage) {
        super(message);
        this.usage = usage;
        this.name = "BudgetReservationError";
    }
}
exports.BudgetReservationError = BudgetReservationError;
/**
 * BudgetTracker coordinates account-wide quota admission while still updating
 * per-session budget views for the runtime and UI.
 */
class BudgetTracker {
    totalInputTokens = 0;
    totalOutputTokens = 0;
    totalUsd = 0;
    startTime = Date.now();
    tokenHistory = [];
    sessionTokenWindows = new Map();
    sessionRequestWindows = new Map();
    accountSessions = new Map();
    quotaRepository;
    sweeperInterval;
    ROLLING_WINDOW_MS = 300_000;
    projectRoot;
    ledgerFile;
    constructor(options = {}) {
        this.projectRoot = options.projectRoot ?? process.cwd();
        this.ledgerFile = path.join(this.projectRoot, '.ai-company', 'ledger.jsonl');
        this.quotaRepository = options.quotaRepository ?? new SQLiteQuotaRepository_1.SQLiteQuotaRepository(database_1.database);
        const sweeperIntervalMs = typeof options.sweeperIntervalMs === "number" && options.sweeperIntervalMs > 0
            ? Math.floor(options.sweeperIntervalMs)
            : DEFAULT_SWEEPER_INTERVAL_MS;
        this.sweeperInterval = setInterval(() => {
            void this.purgeExpiredReservations();
        }, sweeperIntervalMs);
        this.sweeperInterval.unref?.();
    }
    async initialize(nowMs = Date.now()) {
        await this.quotaRepository.initializeQuotaState(nowMs);
    }
    dispose() {
        clearInterval(this.sweeperInterval);
    }
    attachSession(session) {
        const sessions = this.accountSessions.get(session.account) ?? new Set();
        sessions.add(session);
        this.accountSessions.set(session.account, sessions);
    }
    detachSession(session) {
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
    async reserve(session, request) {
        this.attachSession(session);
        const result = await this.quotaRepository.reserveQuota({
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
    async commit(reservationId, usage) {
        const result = await this.quotaRepository.commitQuota({
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
    async recordTransaction(record) {
        try {
            const line = JSON.stringify(record) + '\n';
            await fs.mkdir(path.dirname(this.ledgerFile), { recursive: true });
            await fs.appendFile(this.ledgerFile, line, 'utf-8');
        }
        catch (err) {
            console.error('[BudgetTracker] Failed to record transaction:', err);
        }
    }
    async release(reservationId, reason) {
        const result = await this.quotaRepository.releaseQuota(reservationId, reason);
        if (result.usage) {
            this.applyUsageToAccount(result.usage);
        }
    }
    async releaseAllForSession(sessionId, reason) {
        const result = await this.quotaRepository.releaseQuotaReservationsForSession(sessionId, reason);
        for (const usage of result.usageByAccount) {
            this.applyUsageToAccount(usage);
        }
    }
    applyExecutionUsage(session, execution) {
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
    consume(session, inputTokens, outputTokens, estimatedUsd) {
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
    checkWarning(session) {
        const { usage, limits } = session.budgets;
        this.refreshUsage(session);
        const currentTPM = (usage.currentTPM ?? 0) + (usage.reservedTPM ?? 0);
        const currentRPD = (usage.requestsUsed ?? 0) + (usage.reservedRequests ?? 0);
        const warningReason = this.checkApproachingQuota("tpm", currentTPM, limits.maxTPM, TPM_WARNING_RATIO) ??
            this.checkApproachingQuota("rpd", currentRPD, limits.maxRPD, RPD_WARNING_RATIO) ??
            (limits.maxUsd && usage.usdUsed >= limits.maxUsd * 0.90
                ? `BUDGET_WARNING: usd ${usage.usdUsed.toFixed(4)}/${limits.maxUsd.toFixed(4)}`
                : null);
        session.budgets.warning = warningReason !== null;
        session.budgets.warningReason = warningReason;
        return warningReason;
    }
    checkExceeded(session) {
        const { usage, limits } = session.budgets;
        this.refreshUsage(session);
        const currentTPM = (usage.currentTPM ?? 0) + (usage.reservedTPM ?? 0);
        const currentRPD = (usage.requestsUsed ?? 0) + (usage.reservedRequests ?? 0);
        if (usage.cyclesUsed >= limits.maxCycles) {
            return this.markExceeded(session, `BUDGET_EXCEEDED: cycles budget exhausted (${usage.cyclesUsed}/${limits.maxCycles})`);
        }
        if (usage.durationMsUsed >= limits.maxDurationMs) {
            return this.markExceeded(session, `BUDGET_EXCEEDED: duration ${usage.durationMsUsed}/${limits.maxDurationMs}ms`);
        }
        if (currentTPM >= limits.maxTPM) {
            return this.markExceeded(session, `BUDGET_EXCEEDED: tpm ${currentTPM}/${limits.maxTPM}`);
        }
        if (currentRPD >= limits.maxRPD) {
            return this.markExceeded(session, `BUDGET_EXCEEDED: rpd ${currentRPD}/${limits.maxRPD}`);
        }
        if (usage.inputTokensUsed >= limits.maxInputTokens) {
            return this.markExceeded(session, `BUDGET_EXCEEDED: input tokens ${usage.inputTokensUsed}/${limits.maxInputTokens}`);
        }
        if (usage.outputTokensUsed >= limits.maxOutputTokens) {
            return this.markExceeded(session, `BUDGET_EXCEEDED: output tokens ${usage.outputTokensUsed}/${limits.maxOutputTokens}`);
        }
        if (typeof limits.maxUsd === "number" && limits.maxUsd > 0 && usage.usdUsed >= limits.maxUsd) {
            return this.markExceeded(session, `BUDGET_EXCEEDED: usd ${usage.usdUsed.toFixed(4)}/${limits.maxUsd.toFixed(4)}`);
        }
        session.budgets.warning = false;
        session.budgets.warningReason = null;
        session.budgets.exceeded = false;
        session.budgets.exceedReason = null;
        return false;
    }
    getUsagePercentage(session, metric) {
        const { usage, limits } = session.budgets;
        const limit = limits[metric] ?? 0;
        const currentValue = this.metricValueForLimit(metric, usage);
        if (limit <= 0)
            return 0;
        return (currentValue / limit) * 100;
    }
    getTokenVelocity() {
        const total = this.tokenHistory.reduce((acc, h) => acc + h.input + h.output, 0);
        return Math.round(total / (this.ROLLING_WINDOW_MS / 1000));
    }
    async purgeExpiredReservations() {
        const usages = await this.quotaRepository.purgeExpiredQuotaReservations();
        for (const usage of usages) {
            this.applyUsageToAccount(usage);
        }
    }
    applyUsageToAccount(usage) {
        const sessions = this.accountSessions.get(usage.accountKey);
        if (!sessions || sessions.size === 0) {
            return;
        }
        for (const session of sessions) {
            this.applyUsageSnapshot(session, usage);
        }
    }
    applyUsageSnapshot(session, usage) {
        session.budgets.usage.currentTPM = Math.max(0, Math.floor(usage.currentTPM));
        session.budgets.usage.requestsUsed = Math.max(0, Math.floor(usage.requestsUsed));
        session.budgets.usage.reservedTPM = Math.max(0, Math.floor(usage.reservedTPM));
        session.budgets.usage.reservedRequests = Math.max(0, Math.floor(usage.reservedRequests));
        session.budgets.usage.cachedInputTokensUsed = Math.max(0, Math.floor(usage.cachedInputTokensUsed));
        this.refreshUsage(session);
    }
    markExceeded(session, reason) {
        session.budgets.warning = false;
        session.budgets.warningReason = null;
        session.budgets.exceeded = true;
        session.budgets.exceedReason = reason;
        return true;
    }
    refreshUsage(session) {
        const { usage } = session.budgets;
        usage.currentTPM = Math.max(0, Math.floor(usage.currentTPM ?? 0));
        usage.requestsUsed = Math.max(0, Math.floor(usage.requestsUsed ?? 0));
        usage.reservedTPM = Math.max(0, Math.floor(usage.reservedTPM ?? 0));
        usage.reservedRequests = Math.max(0, Math.floor(usage.reservedRequests ?? 0));
        usage.cachedInputTokensUsed = Math.max(0, Math.floor(usage.cachedInputTokensUsed ?? 0));
        usage.cyclesUsed = session.cycleCount;
        usage.durationMsUsed = Date.now() - Date.parse(session.createdAt);
        if (this.sessionTokenWindows.has(session.id) ||
            this.sessionRequestWindows.has(session.id)) {
            this.syncRollingUsage(session);
        }
    }
    checkApproachingQuota(metric, usage, limit, thresholdRatio) {
        if (limit <= 0)
            return null;
        if (usage < Math.ceil(limit * thresholdRatio))
            return null;
        if (usage >= limit)
            return null;
        return `BUDGET_WARNING: ${metric} ${this.formatMetricValue(metric, usage)}/${this.formatMetricValue(metric, limit)}`;
    }
    recordSessionUsage(sessionId, totalTokens) {
        const now = Date.now();
        const tokenEntries = this.sessionTokenWindows.get(sessionId) ?? [];
        tokenEntries.push({ timestamp: now, tokens: totalTokens });
        this.sessionTokenWindows.set(sessionId, tokenEntries);
        const requestEntries = this.sessionRequestWindows.get(sessionId) ?? [];
        requestEntries.push(now);
        this.sessionRequestWindows.set(sessionId, requestEntries);
    }
    syncRollingUsage(session) {
        const now = Date.now();
        const tokenEntries = (this.sessionTokenWindows.get(session.id) ?? []).filter((entry) => now - entry.timestamp < SESSION_TPM_WINDOW_MS);
        this.sessionTokenWindows.set(session.id, tokenEntries);
        const requestEntries = (this.sessionRequestWindows.get(session.id) ?? []).filter((timestamp) => now - timestamp < SESSION_RPD_WINDOW_MS);
        this.sessionRequestWindows.set(session.id, requestEntries);
        session.budgets.usage.currentTPM = tokenEntries.reduce((total, entry) => total + entry.tokens, 0);
        session.budgets.usage.requestsUsed = requestEntries.length;
    }
    formatMetricValue(metric, value) {
        if (metric === "rpd") {
            return Math.floor(value).toString();
        }
        return Math.floor(value).toString();
    }
    metricValueForLimit(metric, usage) {
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
    cleanupHistory() {
        const now = Date.now();
        this.tokenHistory = this.tokenHistory.filter((h) => now - h.timestamp < this.ROLLING_WINDOW_MS);
    }
}
exports.BudgetTracker = BudgetTracker;
exports.budgetTracker = new BudgetTracker();
//# sourceMappingURL=BudgetTracker.js.map