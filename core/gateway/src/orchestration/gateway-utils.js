"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
exports.retryAfterMsFromResponse = retryAfterMsFromResponse;
exports.extractRetryInfoFromBody = extractRetryInfoFromBody;
exports.toUrlString = toUrlString;
exports.toWarmupStreamUrl = toWarmupStreamUrl;
exports.extractModelFromUrl = extractModelFromUrl;
exports.extractModelFromUrlWithSuffix = extractModelFromUrlWithSuffix;
exports.getModelFamilyFromUrl = getModelFamilyFromUrl;
exports.getHeaderStyleFromUrl = getHeaderStyleFromUrl;
exports.isExplicitQuotaFromUrl = isExplicitQuotaFromUrl;
exports.headerStyleToQuotaKey = headerStyleToQuotaKey;
exports.getCliFirst = getCliFirst;
exports.resolveQuotaFallbackHeaderStyle = resolveQuotaFallbackHeaderStyle;
exports.cleanupToastCooldowns = cleanupToastCooldowns;
exports.shouldShowRateLimitToast = shouldShowRateLimitToast;
exports.normalizeTouchedFiles = normalizeTouchedFiles;
exports.log = {
    debug: (...args) => console.debug('[Alloy:Debug]', ...args),
    info: (...args) => console.info('[Alloy:Info]', ...args),
    warn: (...args) => console.warn('[Alloy:Warn]', ...args),
    error: (...args) => console.error('[Alloy:Error]', ...args),
};
function retryAfterMsFromResponse(response, defaultRetryMs = 60_000) {
    const retryAfter = response.headers.get("retry-after");
    if (!retryAfter)
        return defaultRetryMs;
    if (/^\d+$/.test(retryAfter))
        return parseInt(retryAfter, 10) * 1000;
    const retryDate = Date.parse(retryAfter);
    if (!isNaN(retryDate))
        return Math.max(0, retryDate - Date.now());
    return defaultRetryMs;
}
function parseDurationToMs(duration) {
    const match = duration.match(/^([\d.]+)([hms])?$/);
    if (!match)
        return null;
    const val = parseFloat(match[1]);
    const unit = match[2];
    if (unit === 'h')
        return val * 3600000;
    if (unit === 'm')
        return val * 60000;
    if (unit === 's')
        return val * 1000;
    return val * 1000;
}
async function extractRetryInfoFromBody(response) {
    try {
        let body;
        try {
            body = await response.clone().json();
        }
        catch {
            return { retryDelayMs: null };
        }
        if (!body || typeof body !== "object")
            return { retryDelayMs: null };
        const bodyObj = body;
        const error = typeof bodyObj.error === "object" && bodyObj.error !== null
            ? bodyObj.error
            : null;
        const rawMessage = error?.message ?? bodyObj.message;
        const message = typeof rawMessage === "string" ? rawMessage : undefined;
        const details = error?.details;
        let reason = typeof (error?.reason ?? bodyObj.reason) === "string"
            ? String(error?.reason ?? bodyObj.reason)
            : undefined;
        if (Array.isArray(details)) {
            for (const detail of details) {
                if (!detail || typeof detail !== "object")
                    continue;
                const d = detail;
                const type = d["@type"];
                if (typeof type === "string" && type.includes("google.rpc.ErrorInfo") && typeof d.reason === "string") {
                    reason = d.reason;
                    break;
                }
            }
            for (const detail of details) {
                if (!detail || typeof detail !== "object")
                    continue;
                const d = detail;
                const type = d["@type"];
                if (typeof type === "string" && type.includes("google.rpc.RetryInfo") && typeof d.retryDelay === "string") {
                    const retryDelayMs = parseDurationToMs(d.retryDelay);
                    if (retryDelayMs !== null)
                        return { retryDelayMs, message, reason };
                }
            }
            for (const detail of details) {
                if (!detail || typeof detail !== "object")
                    continue;
                const d = detail;
                if (d.metadata && typeof d.metadata === "object") {
                    const meta = d.metadata;
                    const quotaResetDelay = meta.quotaResetDelay;
                    const quotaResetTime = typeof meta.quotaResetTimeStamp === "string" ? meta.quotaResetTimeStamp : undefined;
                    if (typeof quotaResetDelay === "string") {
                        const retryDelayMs = parseDurationToMs(quotaResetDelay);
                        if (retryDelayMs !== null)
                            return { retryDelayMs, message, quotaResetTime, reason };
                    }
                }
            }
        }
        if (message) {
            const afterMatch = message.match(/retry after\s+([0-9hms.]+)/i) || message.match(/reset after\s+([0-9hms.]+)/i);
            if (afterMatch && afterMatch[1]) {
                const parsed = parseDurationToMs(afterMatch[1]);
                if (parsed !== null)
                    return { retryDelayMs: parsed, message, reason };
            }
        }
        const retryAfterMs = bodyObj.retry_after_ms ?? bodyObj.retryAfterMs;
        const retryAfterSec = bodyObj.retry_after;
        const retryDelayMs = typeof retryAfterMs === "number" ? retryAfterMs
            : typeof retryAfterSec === "number" ? retryAfterSec * 1000
                : null;
        const quotaResetTime = typeof bodyObj.quota_reset_time === "string"
            ? bodyObj.quota_reset_time
            : typeof bodyObj.quotaResetTime === "string"
                ? bodyObj.quotaResetTime
                : undefined;
        return { retryDelayMs, message, quotaResetTime, reason };
    }
    catch {
        return { retryDelayMs: null };
    }
}
function toUrlString(value) {
    if (value instanceof URL)
        return value.toString();
    if (typeof value === "string")
        return value;
    return value.url;
}
function toWarmupStreamUrl(value) {
    const url = new URL(toUrlString(value));
    url.searchParams.set("warmup", "true");
    url.searchParams.set("stream", "true");
    return url.toString();
}
function extractModelFromUrl(urlString) {
    const match = urlString.match(/\/models\/([^/?#:]+)/);
    return match ? (match[1] ?? null) : null;
}
function extractModelFromUrlWithSuffix(urlString) {
    const match = urlString.match(/\/models\/([^?#]+)/);
    return match ? (match[1] ?? null) : null;
}
function getModelFamilyFromUrl(urlString) {
    const model = extractModelFromUrl(urlString) || "";
    if (model.includes("titan"))
        return "titan";
    if (model.includes("gemini"))
        return "gemini";
    if (model.includes("claude"))
        return "claude";
    return "gemini"; // fallback
}
function getHeaderStyleFromUrl(urlString, family) {
    if (urlString.includes("header-style=compact"))
        return "compact";
    if (urlString.includes("header-style=expanded"))
        return "expanded";
    return family === "claude" ? "expanded" : "compact";
}
function isExplicitQuotaFromUrl(urlString) {
    return urlString.includes("quota=explicit");
}
function headerStyleToQuotaKey(headerStyle, family) {
    return `${family}:${headerStyle}`;
}
function getCliFirst(config) {
    // Use unknown cast to access potentially missing keys in simplified config objects
    return !!config.alloy?.cliFirst;
}
function resolveQuotaFallbackHeaderStyle(input) {
    if (!input.quotaFallback)
        return null;
    if (input.explicitQuota)
        return null;
    return input.alternateStyle;
}
function cleanupToastCooldowns(cooldowns) {
    const now = Date.now();
    for (const [key, timestamp] of cooldowns.entries()) {
        if (now > timestamp)
            cooldowns.delete(key);
    }
}
function shouldShowRateLimitToast(message, cooldowns) {
    const now = Date.now();
    const lastShown = cooldowns.get(message) || 0;
    if (now - lastShown < 5000)
        return false;
    cooldowns.set(message, now);
    return true;
}
function normalizeTouchedFiles(files) {
    return [...new Set(files.map(f => f.trim()).filter(f => f.length > 0))];
}
//# sourceMappingURL=gateway-utils.js.map