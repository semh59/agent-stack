"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlloyAPI = void 0;
const gateway_utils_1 = require("./gateway-utils");
const request_1 = require("../plugin/request");
const auth_1 = require("../plugin/auth");
const token_1 = require("../plugin/token");
const accounts_1 = require("../plugin/accounts");
const rate_limit_state_1 = require("../plugin/core/rate-limit-state");
const MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const MOCK_LATENCY_HEADER = "x-alloy-mock-latency-ms";
class AlloyAPI {
    accountManager;
    config;
    providerId;
    getAuth;
    nativeFetch;
    // Static state for rate limiting and failure tracking
    // These are now initialized inline to avoid TypeScript initialization issues
    static rateLimitStateByAccountQuota = new Map();
    static failureStateCountByEmail = new Map();
    constructor(accountManager, config, providerId, getAuth, nativeFetch) {
        this.accountManager = accountManager;
        this.config = config;
        this.providerId = providerId;
        this.getAuth = getAuth;
        this.nativeFetch = nativeFetch;
    }
    async fetch(input, init) {
        const fetchInputString = (0, gateway_utils_1.toUrlString)(input);
        if (!(0, request_1.isGenerativeLanguageRequest)(fetchInputString)) {
            return this.nativeFetch(input, init);
        }
        let latestAuth = await this.getAuth();
        if (!(0, auth_1.isOAuthAuth)(latestAuth)) {
            return this.nativeFetch(input, init);
        }
        const family = (0, gateway_utils_1.getModelFamilyFromUrl)(fetchInputString);
        const model = (0, gateway_utils_1.extractModelFromUrl)(fetchInputString);
        const headerStyle = fetchInputString.includes("gemini-cli") ? "gemini-cli" : "alloy";
        let requestInit = stripInternalHeaders(init);
        const mockLatencyMs = getMockLatencyMs(init);
        let refreshAttempted = false;
        // Standard retry loop logic
        let attempts = 0;
        while (attempts < MAX_RETRY_ATTEMPTS) {
            if (mockLatencyMs > 0) {
                await (0, rate_limit_state_1.sleep)(mockLatencyMs, requestInit?.signal);
            }
            const response = await this.nativeFetch(input, requestInit);
            if (response.ok) {
                const am = this.accountManager;
                if (am?.markAccountUsed) {
                    const getCurrentForFamily = am.getCurrentAccountForFamily;
                    const active = getCurrentForFamily?.(family);
                    if (active)
                        am.markAccountUsed(active.index);
                }
                return response;
            }
            if (response.status === 429) {
                attempts++;
                const bodyInfo = await (0, gateway_utils_1.extractRetryInfoFromBody)(response);
                const headerRetryMs = (0, gateway_utils_1.retryAfterMsFromResponse)(response, 0);
                const retryAfterMs = headerRetryMs > 0 ? headerRetryMs : (bodyInfo.retryDelayMs ?? null);
                const reason = (0, accounts_1.parseRateLimitReason)(bodyInfo.reason, bodyInfo.message, response.status);
                // Strategy: Rotation over same-account retry
                const am = this.accountManager;
                if (am?.getCurrentOrNextForFamily) {
                    const getCurrentForFamily = am.getCurrentAccountForFamily;
                    const current = getCurrentForFamily ? getCurrentForFamily(family) : null;
                    if (current) {
                        am.markRateLimited(current, retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS, family, headerStyle, model);
                    }
                    const getCurrentOrNext = am.getCurrentOrNextForFamily;
                    const next = getCurrentOrNext(family, model, "round-robin", headerStyle);
                    const nextAccessToken = getAccountAccessToken(next);
                    const currentIndex = current ? current.index : undefined;
                    const nextIndex = next ? next.index : undefined;
                    if (next && nextAccessToken && nextIndex !== currentIndex) {
                        const currentEmail = current ? String(current.email ?? 'unknown') : 'unknown';
                        const nextEmail = next ? String(next.email ?? nextIndex ?? '') : '';
                        gateway_utils_1.log.warn(`[Alloy AI] 429 hit. Rotating from ${currentEmail} to ${nextEmail}`);
                        requestInit = withAuthorizationHeader(requestInit, nextAccessToken);
                        continue; // Immediate retry with new account
                    }
                }
                const backoff = (0, accounts_1.calculateBackoffMs)(reason, attempts, retryAfterMs);
                gateway_utils_1.log.warn(`Rate limit hit (429), retrying effort ${attempts} in ${backoff}ms...`);
                await (0, rate_limit_state_1.sleep)(backoff, requestInit?.signal);
                continue;
            }
            if (response.status === 401 && !refreshAttempted) {
                refreshAttempted = true;
                const locallyExpired = (0, auth_1.accessTokenExpired)(latestAuth);
                gateway_utils_1.log.info(`[Alloy AI] Received 401${locallyExpired ? " for expired access token" : ""}, attempting refresh...`);
                try {
                    const refreshed = await (0, token_1.refreshAccessToken)(latestAuth, {}, this.providerId);
                    const refreshedAccessToken = getAuthAccessToken(refreshed);
                    if (!refreshed || !refreshedAccessToken) {
                        return createGracefulErrorResponse("OAuth token refresh failed: no refreshed access token was returned.", 401);
                    }
                    latestAuth = refreshed;
                    requestInit = withAuthorizationHeader(requestInit, refreshedAccessToken);
                    continue;
                }
                catch (error) {
                    return createGracefulErrorResponse(`OAuth token refresh failed: ${toErrorMessage(error)}`, 401);
                }
            }
            // If not retriable, return as is
            return response;
        }
        return createGracefulErrorResponse("Max retry attempts reached", 429);
    }
}
exports.AlloyAPI = AlloyAPI;
function getMockLatencyMs(init) {
    const raw = new Headers(init?.headers).get(MOCK_LATENCY_HEADER);
    if (!raw)
        return 0;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return 0;
    }
    return parsed;
}
function stripInternalHeaders(init) {
    if (!init?.headers) {
        return init;
    }
    const headers = new Headers(init.headers);
    if (!headers.has(MOCK_LATENCY_HEADER)) {
        return init;
    }
    headers.delete(MOCK_LATENCY_HEADER);
    return { ...init, headers };
}
function withAuthorizationHeader(init, accessToken) {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return { ...(init ?? {}), headers };
}
function getAccountAccessToken(account) {
    if (!account || typeof account !== "object") {
        return null;
    }
    const candidate = account;
    if (typeof candidate.access === "string" && candidate.access.length > 0) {
        return candidate.access;
    }
    if (typeof candidate.accessToken === "string" && candidate.accessToken.length > 0) {
        return candidate.accessToken;
    }
    return null;
}
function getAuthAccessToken(auth) {
    if (!auth || typeof auth !== "object") {
        return null;
    }
    const candidate = auth;
    if (typeof candidate.access === "string" && candidate.access.length > 0) {
        return candidate.access;
    }
    if (typeof candidate.accessToken === "string" && candidate.accessToken.length > 0) {
        return candidate.accessToken;
    }
    return null;
}
function createGracefulErrorResponse(message, status) {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: {
            "Content-Type": "application/json",
            "X-Alloy-Graceful-Error": "true",
        },
    });
}
function toErrorMessage(error) {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=gateway-api.js.map