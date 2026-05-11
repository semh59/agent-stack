"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SWITCH_ACCOUNT_DELAY_MS = exports.FIRST_RETRY_DELAY_MS = void 0;
exports.extractRateLimitBodyInfo = extractRateLimitBodyInfo;
exports.extractRetryInfoFromBody = extractRetryInfoFromBody;
exports.formatWaitTime = formatWaitTime;
exports.getEmptyResponseAttempts = getEmptyResponseAttempts;
exports.incrementEmptyResponseAttempts = incrementEmptyResponseAttempts;
exports.resetEmptyResponseAttempts = resetEmptyResponseAttempts;
exports.getRateLimitBackoff = getRateLimitBackoff;
exports.resetRateLimitState = resetRateLimitState;
exports.resetAllRateLimitStateForAccount = resetAllRateLimitStateForAccount;
exports.headerStyleToQuotaKey = headerStyleToQuotaKey;
exports.trackAccountFailure = trackAccountFailure;
exports.resetAccountFailureState = resetAccountFailureState;
exports.sleep = sleep;
const backoff_1 = require("./backoff");
/**
 * Extract rate limit information from a JSON response body.
 */
function extractRateLimitBodyInfo(body) {
    if (!body || typeof body !== "object") {
        return { retryDelayMs: null };
    }
    const error = body.error;
    const message = error && typeof error === "object"
        ? error.message
        : undefined;
    const details = error && typeof error === "object"
        ? error.details
        : undefined;
    let reason;
    if (Array.isArray(details)) {
        for (const detail of details) {
            if (!detail || typeof detail !== "object")
                continue;
            const type = detail["@type"];
            if (typeof type === "string" && type.includes("google.rpc.ErrorInfo")) {
                const detailReason = detail.reason;
                if (typeof detailReason === "string") {
                    reason = detailReason;
                    break;
                }
            }
        }
        for (const detail of details) {
            if (!detail || typeof detail !== "object")
                continue;
            const type = detail["@type"];
            if (typeof type === "string" && type.includes("google.rpc.RetryInfo")) {
                const retryDelay = detail.retryDelay;
                if (typeof retryDelay === "string") {
                    const retryDelayMs = (0, backoff_1.parseDurationToMs)(retryDelay);
                    if (retryDelayMs !== null) {
                        return { retryDelayMs, message, reason };
                    }
                }
            }
        }
        for (const detail of details) {
            if (!detail || typeof detail !== "object")
                continue;
            const metadata = detail.metadata;
            if (metadata && typeof metadata === "object") {
                const quotaResetDelay = metadata.quotaResetDelay;
                const quotaResetTime = metadata.quotaResetTimeStamp;
                if (typeof quotaResetDelay === "string") {
                    const quotaResetDelayMs = (0, backoff_1.parseDurationToMs)(quotaResetDelay);
                    if (quotaResetDelayMs !== null) {
                        return { retryDelayMs: quotaResetDelayMs, message, quotaResetTime, reason };
                    }
                }
            }
        }
    }
    if (message) {
        const afterMatch = message.match(/reset after\s+([0-9hms.]+)/i);
        const rawDuration = afterMatch?.[1];
        if (rawDuration) {
            const parsed = (0, backoff_1.parseDurationToMs)(rawDuration);
            if (parsed !== null) {
                return { retryDelayMs: parsed, message, reason };
            }
        }
    }
    return { retryDelayMs: null, message, reason };
}
/**
 * Extract retry info from a response body in a safe way.
 */
async function extractRetryInfoFromBody(response) {
    try {
        const text = await response.clone().text();
        try {
            const parsed = JSON.parse(text);
            return extractRateLimitBodyInfo(parsed);
        }
        catch {
            return { retryDelayMs: null };
        }
    }
    catch {
        return { retryDelayMs: null };
    }
}
/**
 * Format milliseconds into a human-readable duration string.
 */
function formatWaitTime(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
// Progressive rate limit retry delays
exports.FIRST_RETRY_DELAY_MS = 1000;
exports.SWITCH_ACCOUNT_DELAY_MS = 5000;
const RATE_LIMIT_DEDUP_WINDOW_MS = 2000;
const RATE_LIMIT_STATE_RESET_MS = 120_000;
const rateLimitStateByAccountQuota = new Map();
// Track empty response retry attempts (ported from LLM-API-Key-Proxy)
const emptyResponseAttempts = new Map();
/**
 * Get empty response attempt count for a model.
 */
function getEmptyResponseAttempts(model) {
    return emptyResponseAttempts.get(model) ?? 0;
}
/**
 * Increment empty response attempt count for a model.
 */
function incrementEmptyResponseAttempts(model) {
    emptyResponseAttempts.set(model, (emptyResponseAttempts.get(model) ?? 0) + 1);
}
/**
 * Reset empty response attempt count for a model.
 */
function resetEmptyResponseAttempts(model) {
    emptyResponseAttempts.delete(model);
}
/**
 * Get rate limit backoff with time-window deduplication.
 */
function getRateLimitBackoff(accountIndex, quotaKey, serverRetryAfterMs, maxBackoffMs = 60_000) {
    const now = Date.now();
    const stateKey = `${accountIndex}:${quotaKey}`;
    const previous = rateLimitStateByAccountQuota.get(stateKey);
    if (previous && (now - previous.lastAt < RATE_LIMIT_DEDUP_WINDOW_MS)) {
        const baseDelay = serverRetryAfterMs ?? 1000;
        const backoffDelay = Math.min(baseDelay * Math.pow(2, previous.consecutive429 - 1), maxBackoffMs);
        return {
            attempt: previous.consecutive429,
            delayMs: Math.max(baseDelay, backoffDelay),
            isDuplicate: true
        };
    }
    const attempt = previous && (now - previous.lastAt < RATE_LIMIT_STATE_RESET_MS)
        ? previous.consecutive429 + 1
        : 1;
    rateLimitStateByAccountQuota.set(stateKey, {
        consecutive429: attempt,
        lastAt: now,
        quotaKey
    });
    const baseDelay = serverRetryAfterMs ?? 1000;
    const backoffDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxBackoffMs);
    return { attempt, delayMs: Math.max(baseDelay, backoffDelay), isDuplicate: false };
}
/**
 * Reset rate limit state for an account+quota.
 */
function resetRateLimitState(accountIndex, quotaKey) {
    const stateKey = `${accountIndex}:${quotaKey}`;
    rateLimitStateByAccountQuota.delete(stateKey);
}
/**
 * Reset all rate limit state for an account.
 */
function resetAllRateLimitStateForAccount(accountIndex) {
    for (const key of rateLimitStateByAccountQuota.keys()) {
        if (key.startsWith(`${accountIndex}:`)) {
            rateLimitStateByAccountQuota.delete(key);
        }
    }
}
/**
 * Helper to convert header style to quota key.
 */
function headerStyleToQuotaKey(headerStyle, family) {
    if (family === "claude")
        return "claude";
    return headerStyle === "Alloy" ? "gemini-Alloy" : "gemini-cli";
}
// Track consecutive non-429 failures per account
const accountFailureState = new Map();
const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_COOLDOWN_MS = 30_000;
const FAILURE_STATE_RESET_MS = 120_000;
/**
 * Track an account failure and return cooldown info.
 */
function trackAccountFailure(accountIndex) {
    const now = Date.now();
    const previous = accountFailureState.get(accountIndex);
    const failures = previous && (now - previous.lastFailureAt < FAILURE_STATE_RESET_MS)
        ? previous.consecutiveFailures + 1
        : 1;
    accountFailureState.set(accountIndex, { consecutiveFailures: failures, lastFailureAt: now });
    const shouldCooldown = failures >= MAX_CONSECUTIVE_FAILURES;
    const cooldownMs = shouldCooldown ? FAILURE_COOLDOWN_MS : 0;
    return { failures, shouldCooldown, cooldownMs };
}
/**
 * Reset failure state for an account.
 */
function resetAccountFailureState(accountIndex) {
    accountFailureState.delete(accountIndex);
}
/**
 * Sleep for a given duration, respecting an abort signal.
 */
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
            return;
        }
        const timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            reject(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
//# sourceMappingURL=rate-limit-state.js.map