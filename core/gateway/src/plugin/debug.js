"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEBUG_MESSAGE_PREFIX = void 0;
exports.initializeDebug = initializeDebug;
exports.isDebugEnabled = isDebugEnabled;
exports.isVerboseEnabled = isVerboseEnabled;
exports.getLogFilePath = getLogFilePath;
exports.startAlloyDebugRequest = startAlloyDebugRequest;
exports.logAlloyDebugResponse = logAlloyDebugResponse;
exports.logAccountContext = logAccountContext;
exports.logRateLimitEvent = logRateLimitEvent;
exports.logRateLimitSnapshot = logRateLimitSnapshot;
exports.logResponseBody = logResponseBody;
exports.logModelFamily = logModelFamily;
exports.debugLogToFile = debugLogToFile;
exports.logToast = logToast;
exports.logRetryAttempt = logRetryAttempt;
exports.logCacheStats = logCacheStats;
exports.logQuotaStatus = logQuotaStatus;
exports.logQuotaFetch = logQuotaFetch;
exports.logModelUsed = logModelUsed;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_process_1 = require("node:process");
const storage_1 = require("./storage");
const MAX_BODY_PREVIEW_CHARS = 12000;
const MAX_BODY_VERBOSE_CHARS = 50000;
exports.DEBUG_MESSAGE_PREFIX = "[alloy-ai debug]";
/**
 * Simple email masking helper for debug strings.
 */
function maskDebugLabel(label) {
    if (label.includes('@')) {
        return label.replace(/^(.)(.*)(@.*)$/, (_, first, middle, rest) => `${first}***${rest}`);
    }
    return label;
}
let debugState = null;
/**
 * Parse debug level from a flag string.
 * 0 = off, 1 = basic, 2 = verbose (full bodies)
 */
function parseDebugLevel(flag) {
    const trimmed = flag.trim();
    if (trimmed === "2" || trimmed === "verbose")
        return 2;
    if (trimmed === "1" || trimmed === "true")
        return 1;
    return 0;
}
/**
 * Get the OS-specific config directory.
 */
function getConfigDir() {
    const platform = process.platform;
    if (platform === "win32") {
        return (0, node_path_1.join)(node_process_1.env.APPDATA || (0, node_path_1.join)((0, node_os_1.homedir)(), "AppData", "Roaming"), "Alloy");
    }
    const xdgConfig = node_process_1.env.XDG_CONFIG_HOME || (0, node_path_1.join)((0, node_os_1.homedir)(), ".config");
    return (0, node_path_1.join)(xdgConfig, "Alloy");
}
/**
 * Returns the logs directory, creating it if needed.
 */
function getLogsDir(customLogDir) {
    const logsDir = customLogDir || (0, node_path_1.join)(getConfigDir(), "Alloy-logs");
    try {
        (0, node_fs_1.mkdirSync)(logsDir, { recursive: true });
    }
    catch {
        // Directory may already exist or we don't have permission
    }
    return logsDir;
}
/**
 * Builds a timestamped log file path.
 */
function createLogFilePath(customLogDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return (0, node_path_1.join)(getLogsDir(customLogDir), `Alloy-debug-${timestamp}.log`);
}
/**
 * Creates a log writer function that writes to a file.
 */
function createLogWriter(filePath) {
    if (!filePath) {
        return () => { };
    }
    try {
        const stream = (0, node_fs_1.createWriteStream)(filePath, { flags: "a" });
        stream.on("error", () => { });
        return (line) => {
            const timestamp = new Date().toISOString();
            const formatted = `[${timestamp}] ${line}`;
            stream.write(`${formatted}\n`);
        };
    }
    catch {
        return () => { };
    }
}
/**
 * Initialize or reinitialize debug state with the given config.
 * Call this once at plugin startup after loading config.
 */
function initializeDebug(config) {
    // Config takes precedence, but env var can force enable for debugging
    const envDebugFlag = node_process_1.env.Alloy_ALLOY_DEBUG ?? "";
    const debugLevel = config.debug ? (envDebugFlag === "2" || envDebugFlag === "verbose" ? 2 : 1) : parseDebugLevel(envDebugFlag);
    const debugEnabled = debugLevel >= 1;
    const verboseEnabled = debugLevel >= 2;
    const logFilePath = debugEnabled ? createLogFilePath(config.log_dir) : undefined;
    const logWriter = createLogWriter(logFilePath);
    if (debugEnabled) {
        (0, storage_1.ensureGitignoreSync)(getConfigDir());
    }
    debugState = {
        debugLevel,
        debugEnabled,
        verboseEnabled,
        logFilePath,
        logWriter,
    };
}
/**
 * Get the current debug state, initializing with defaults if needed.
 * This allows the module to work even before initializeDebug is called.
 */
function getDebugState() {
    if (!debugState) {
        // Fallback to env-based initialization for backward compatibility
        const envDebugFlag = node_process_1.env.Alloy_ALLOY_DEBUG ?? "";
        const debugLevel = parseDebugLevel(envDebugFlag);
        const debugEnabled = debugLevel >= 1;
        const verboseEnabled = debugLevel >= 2;
        const logFilePath = debugEnabled ? createLogFilePath() : undefined;
        const logWriter = createLogWriter(logFilePath);
        debugState = {
            debugLevel,
            debugEnabled,
            verboseEnabled,
            logFilePath,
            logWriter,
        };
    }
    return debugState;
}
// =============================================================================
// Public API
// =============================================================================
function isDebugEnabled() {
    return getDebugState().debugEnabled;
}
function isVerboseEnabled() {
    return getDebugState().verboseEnabled;
}
function getLogFilePath() {
    return getDebugState().logFilePath;
}
let requestCounter = 0;
/**
 * Begins a debug trace for an Alloy request.
 */
function startAlloyDebugRequest(meta) {
    const state = getDebugState();
    if (!state.debugEnabled) {
        return null;
    }
    const id = `SOVEREIGN-${++requestCounter}`;
    const method = meta.method ?? "GET";
    logDebug(`[Alloy Debug ${id}] pid=${process.pid} ${method} ${meta.resolvedUrl}`);
    if (meta.originalUrl && meta.originalUrl !== meta.resolvedUrl) {
        logDebug(`[Alloy Debug ${id}] Original URL: ${meta.originalUrl}`);
    }
    if (meta.projectId) {
        logDebug(`[Alloy Debug ${id}] Project: ${meta.projectId}`);
    }
    logDebug(`[Alloy Debug ${id}] Streaming: ${meta.streaming ? "yes" : "no"}`);
    logDebug(`[Alloy Debug ${id}] Headers: ${JSON.stringify(maskHeaders(meta.headers))}`);
    const bodyPreview = formatBodyPreview(meta.body);
    if (bodyPreview) {
        logDebug(`[Alloy Debug ${id}] Body Preview: ${bodyPreview}`);
    }
    return { id, streaming: meta.streaming, startedAt: Date.now() };
}
/**
 * Logs response details for a previously started debug trace.
 */
function logAlloyDebugResponse(context, response, meta = {}) {
    const state = getDebugState();
    if (!state.debugEnabled || !context) {
        return;
    }
    const durationMs = Date.now() - context.startedAt;
    logDebug(`[Alloy Debug ${context.id}] Response ${response.status} ${response.statusText} (${durationMs}ms)`);
    logDebug(`[Alloy Debug ${context.id}] Response Headers: ${JSON.stringify(maskHeaders(meta.headersOverride ?? response.headers))}`);
    if (meta.note) {
        logDebug(`[Alloy Debug ${context.id}] Note: ${meta.note}`);
    }
    if (meta.error) {
        logDebug(`[Alloy Debug ${context.id}] Error: ${formatError(meta.error)}`);
    }
    if (meta.body) {
        logDebug(`[Alloy Debug ${context.id}] Response Body Preview: ${truncateForLog(meta.body)}`);
    }
}
/**
 * Obscures sensitive headers and returns a plain object for logging.
 */
function maskHeaders(headers) {
    if (!headers) {
        return {};
    }
    const result = {};
    const parsed = headers instanceof Headers ? headers : new Headers(headers);
    parsed.forEach((value, key) => {
        if (key.toLowerCase() === "authorization") {
            result[key] = "[redacted]";
        }
        else {
            result[key] = value;
        }
    });
    return result;
}
/**
 * Produces a short, type-aware preview of a request/response body for logs.
 */
function formatBodyPreview(body) {
    if (body == null) {
        return undefined;
    }
    if (typeof body === "string") {
        return truncateForLog(body);
    }
    if (body instanceof URLSearchParams) {
        return truncateForLog(body.toString());
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
        return `[Blob size=${body.size}]`;
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
        return "[FormData payload omitted]";
    }
    return `[${body.constructor?.name ?? typeof body} payload omitted]`;
}
/**
 * Truncates long strings to a fixed preview length for logging.
 */
function truncateForLog(text) {
    if (text.length <= MAX_BODY_PREVIEW_CHARS) {
        return text;
    }
    return `${text.slice(0, MAX_BODY_PREVIEW_CHARS)}... (truncated ${text.length - MAX_BODY_PREVIEW_CHARS} chars)`;
}
/**
 * Writes a single debug line using the configured writer.
 */
function logDebug(line) {
    getDebugState().logWriter(line);
}
/**
 * Converts unknown error-like values into printable strings.
 */
function formatError(error) {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
function logAccountContext(label, info) {
    if (!getDebugState().debugEnabled)
        return;
    const accountLabel = info.email
        ? maskDebugLabel(info.email)
        : info.index >= 0
            ? `Account ${info.index + 1}`
            : "All accounts";
    const indexLabel = info.index >= 0 ? `${info.index + 1}/${info.totalAccounts}` : `-/${info.totalAccounts}`;
    let rateLimitInfo = "";
    if (info.rateLimitState && Object.keys(info.rateLimitState).length > 0) {
        const now = Date.now();
        const activeRateLimits = {};
        for (const [key, resetTime] of Object.entries(info.rateLimitState)) {
            if (typeof resetTime === "number" && resetTime > now) {
                const remainingSec = Math.ceil((resetTime - now) / 1000);
                activeRateLimits[key] = `${remainingSec}s`;
            }
        }
        if (Object.keys(activeRateLimits).length > 0) {
            rateLimitInfo = ` rateLimits=${JSON.stringify(activeRateLimits)}`;
        }
    }
    logDebug(`[Account] ${label}: ${accountLabel} (${indexLabel}) family=${info.family}${rateLimitInfo}`);
}
function logRateLimitEvent(accountIndex, email, family, status, retryAfterMs, bodyInfo) {
    if (!getDebugState().debugEnabled)
        return;
    const accountLabel = email || `Account ${accountIndex + 1}`;
    logDebug(`[RateLimit] ${status} on ${accountLabel} family=${family} retryAfterMs=${retryAfterMs}`);
    if (bodyInfo.message) {
        logDebug(`[RateLimit] message: ${bodyInfo.message}`);
    }
    if (bodyInfo.quotaResetTime) {
        logDebug(`[RateLimit] quotaResetTime: ${bodyInfo.quotaResetTime}`);
    }
    if (bodyInfo.retryDelayMs !== undefined && bodyInfo.retryDelayMs !== null) {
        logDebug(`[RateLimit] body retryDelayMs: ${bodyInfo.retryDelayMs}`);
    }
    if (bodyInfo.reason) {
        logDebug(`[RateLimit] reason: ${bodyInfo.reason}`);
    }
}
function logRateLimitSnapshot(family, accounts) {
    if (!getDebugState().debugEnabled)
        return;
    const now = Date.now();
    const entries = accounts.map((account) => {
        const label = account.email ? maskDebugLabel(account.email) : `Account ${account.index + 1}`;
        const reset = account.rateLimitResetTimes?.[family];
        if (typeof reset !== "number") {
            return `${label}=ready`;
        }
        const remaining = Math.max(0, reset - now);
        const seconds = Math.ceil(remaining / 1000);
        return `${label}=wait ${seconds}s`;
    });
    logDebug(`[RateLimit] snapshot family=${family} ${entries.join(" | ")}`);
}
async function logResponseBody(context, response, status) {
    const state = getDebugState();
    if (!state.debugEnabled || !context)
        return undefined;
    const isError = status >= 400;
    const shouldLogBody = state.verboseEnabled || isError;
    if (!shouldLogBody)
        return undefined;
    try {
        const text = await response.clone().text();
        const maxChars = state.verboseEnabled ? MAX_BODY_VERBOSE_CHARS : MAX_BODY_PREVIEW_CHARS;
        const preview = text.length <= maxChars
            ? text
            : `${text.slice(0, maxChars)}... (truncated ${text.length - maxChars} chars)`;
        logDebug(`[Alloy Debug ${context.id}] Response Body (${status}): ${preview}`);
        return text;
    }
    catch (e) {
        logDebug(`[Alloy Debug ${context.id}] Failed to read response body: ${formatError(e)}`);
        return undefined;
    }
}
function logModelFamily(url, extractedModel, family) {
    if (!getDebugState().debugEnabled)
        return;
    logDebug(`[ModelFamily] url=${url} model=${extractedModel ?? "unknown"} family=${family}`);
}
function debugLogToFile(message) {
    if (!getDebugState().debugEnabled)
        return;
    logDebug(message);
}
/**
 * Logs a toast message to the debug file.
 * This helps correlate what the user saw with debug events.
 */
function logToast(message, variant) {
    if (!getDebugState().debugEnabled)
        return;
    const variantLabel = variant.toUpperCase();
    logDebug(`[Toast/${variantLabel}] ${message}`);
}
/**
 * Logs retry attempt information.
 * @param maxAttempts - Use -1 for unlimited retries
 */
function logRetryAttempt(attempt, maxAttempts, reason, delayMs) {
    if (!getDebugState().debugEnabled)
        return;
    const delayInfo = delayMs !== undefined ? ` delay=${delayMs}ms` : "";
    const maxInfo = maxAttempts < 0 ? "∞" : maxAttempts.toString();
    logDebug(`[Retry] Attempt ${attempt}/${maxInfo} reason=${reason}${delayInfo}`);
}
/**
 * Logs cache hit/miss information from response usage metadata.
 */
function logCacheStats(model, cacheReadTokens, cacheWriteTokens, totalInputTokens) {
    if (!getDebugState().debugEnabled)
        return;
    const cacheHitRate = totalInputTokens > 0
        ? Math.round((cacheReadTokens / totalInputTokens) * 100)
        : 0;
    const status = cacheReadTokens > 0 ? "HIT" : (cacheWriteTokens > 0 ? "WRITE" : "MISS");
    logDebug(`[Cache] ${status} model=${model} read=${cacheReadTokens} write=${cacheWriteTokens} total=${totalInputTokens} hitRate=${cacheHitRate}%`);
}
/**
 * Logs quota status for an account.
 */
function logQuotaStatus(accountEmail, accountIndex, quotaPercent, family) {
    if (!getDebugState().debugEnabled)
        return;
    const accountLabel = accountEmail || `Account ${accountIndex + 1}`;
    const familyInfo = family ? ` family=${family}` : "";
    const status = quotaPercent <= 0 ? "EXHAUSTED" : quotaPercent < 20 ? "LOW" : "OK";
    logDebug(`[Quota] ${accountLabel} remaining=${quotaPercent.toFixed(1)}% status=${status}${familyInfo}`);
}
/**
 * Logs background quota fetch events.
 */
function logQuotaFetch(event, accountCount, details) {
    if (!getDebugState().debugEnabled)
        return;
    const countInfo = accountCount !== undefined ? ` accounts=${accountCount}` : "";
    const detailsInfo = details ? ` ${details}` : "";
    logDebug(`[QuotaFetch] ${event.toUpperCase()}${countInfo}${detailsInfo}`);
}
/**
 * Logs which model is being used for a request.
 */
function logModelUsed(requestedModel, actualModel, accountEmail) {
    if (!getDebugState().debugEnabled)
        return;
    const accountInfo = accountEmail ? ` account=${accountEmail}` : "";
    if (requestedModel !== actualModel) {
        logDebug(`[Model] requested=${requestedModel} actual=${actualModel}${accountInfo}`);
    }
    else {
        logDebug(`[Model] ${actualModel}${accountInfo}`);
    }
}
//# sourceMappingURL=debug.js.map