"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pkceStateManager = void 0;
exports.authorizeGoogleGemini = authorizeGoogleGemini;
exports.exchangeGoogleGemini = exchangeGoogleGemini;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("../constants");
const logger_1 = require("../plugin/logger");
const auth_1 = require("../plugin/auth");
const log = (0, logger_1.createLogger)("oauth");
/**
 * PKCEStateManager - Server-side PKCE state storage
 *
 * Stores PKCE verifiers server-side to prevent exposure in URLs.
 * States are one-time use and expire after 10 minutes.
 */
class PKCEStateManager {
    sessions = new Map();
    STATE_TTL_MS = 10 * 60 * 1000;
    cleanupInterval = null;
    constructor() {
        // Start periodic cleanup of expired states
        this.startCleanupTimer();
    }
    startCleanupTimer() {
        if (this.cleanupInterval)
            return;
        this.cleanupInterval = setInterval(() => this.cleanupExpiredStates(), 60 * 1000);
        // Allow process to exit even if cleanup interval is running
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
    /**
     * Generate a new PKCE state/verifier pair and store server-side
     */
    generateState(projectId) {
        const verifier = (0, node_crypto_1.randomBytes)(32).toString('hex').slice(0, 64); // PKCE verifier (43-128 chars)
        const state = (0, node_crypto_1.randomBytes)(16).toString('hex'); // Random state (not containing verifier)
        // Calculate S256 code challenge
        const challenge = (0, node_crypto_1.createHash)('sha256')
            .update(verifier)
            .digest('base64url');
        const now = Date.now();
        this.sessions.set(state, {
            state,
            verifier,
            challenge,
            projectId,
            createdAt: now,
            expiresAt: now + this.STATE_TTL_MS,
            consumed: false,
        });
        return { state, verifier, challenge };
    }
    /**
     * Validate state and return verifier/projectId (one-time use)
     * Returns null if state is invalid, expired, or already consumed
     */
    validateAndConsumeState(state) {
        const session = this.sessions.get(state);
        if (!session) {
            log.warn('OAuth state not found', { state: state.slice(0, 8) + '...' });
            return null;
        }
        if (session.consumed) {
            log.warn('OAuth state already consumed (replay attack?)', { state: state.slice(0, 8) + '...' });
            this.sessions.delete(state);
            return null;
        }
        if (Date.now() > session.expiresAt) {
            log.warn('OAuth state expired', { state: state.slice(0, 8) + '...' });
            this.sessions.delete(state);
            return null;
        }
        // Mark as consumed (one-time use)
        session.consumed = true;
        this.sessions.delete(state);
        return {
            verifier: session.verifier,
            projectId: session.projectId,
        };
    }
    /**
     * Cleanup expired states periodically
     */
    cleanupExpiredStates() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, session] of this.sessions) {
            if (now > session.expiresAt) {
                this.sessions.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            log.debug('Cleaned up expired OAuth states', { count: cleaned });
        }
    }
    /**
     * Get current number of stored states (for monitoring)
     */
    getStateCount() {
        return this.sessions.size;
    }
    /**
     * Shutdown and cleanup resources
     */
    shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.sessions.clear();
    }
}
// Global PKCE state manager instance
exports.pkceStateManager = new PKCEStateManager();
/**
 * Build the Alloy OAuth authorization URL using server-side PKCE state.
 * The PKCE verifier is stored server-side and NOT exposed in the URL.
 */
async function authorizeGoogleGemini(projectId = "") {
    // Generate state/verifier on server (verifier NOT in URL)
    const { state, challenge } = exports.pkceStateManager.generateState(projectId || "");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", constants_1.ALLOY_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", constants_1.ALLOY_REDIRECT_URI);
    url.searchParams.set("scope", constants_1.ALLOY_SCOPES.join(" "));
    url.searchParams.set("code_challenge", challenge); // S256 hash from server
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state); // Random state, verifier is server-side
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return {
        url: url.toString(),
        verifier: "", // Not needed by caller anymore (verifier is server-side)
        state,
        projectId: projectId || "",
    };
}
const FETCH_TIMEOUT_MS = 10000;
async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    }
    finally {
        clearTimeout(timeout);
    }
}
async function fetchProjectID(accessToken) {
    const errors = [];
    const loadHeaders = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": constants_1.GEMINI_CLI_HEADERS["User-Agent"],
        "X-Goog-Api-Client": constants_1.GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
        "Client-Metadata": constants_1.ALLOY_HEADERS["Client-Metadata"],
    };
    const loadEndpoints = Array.from(new Set([...constants_1.ALLOY_LOAD_ENDPOINTS, ...constants_1.ALLOY_ENDPOINT_FALLBACKS]));
    for (const baseEndpoint of loadEndpoints) {
        try {
            const url = `${baseEndpoint}/v1internal:loadCodeAssist`;
            const response = await fetchWithTimeout(url, {
                method: "POST",
                headers: loadHeaders,
                body: JSON.stringify({
                    metadata: {
                        ideType: "IDE_UNSPECIFIED",
                        platform: "PLATFORM_UNSPECIFIED",
                        pluginType: "GEMINI",
                    },
                }),
            });
            if (!response.ok) {
                const message = await response.text().catch(() => "");
                errors.push(`loadCodeAssist ${response.status} at ${baseEndpoint}${message ? `: ${message}` : ""}`);
                continue;
            }
            const data = (await response.json());
            if (typeof data.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
                return data.cloudaicompanionProject;
            }
            if (data.cloudaicompanionProject &&
                typeof data.cloudaicompanionProject.id === "string" &&
                data.cloudaicompanionProject.id) {
                return data.cloudaicompanionProject.id;
            }
            errors.push(`loadCodeAssist missing project id at ${baseEndpoint}`);
        }
        catch (e) {
            errors.push(`loadCodeAssist error at ${baseEndpoint}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    if (errors.length) {
        log.warn("Failed to resolve Alloy project via loadCodeAssist", { errors: errors.join("; ") });
    }
    return "";
}
/**
 * Exchange an authorization code for Alloy CLI access and refresh tokens.
 */
async function exchangeGoogleGemini(code, state) {
    try {
        // Get verifier from server-side state storage (not from URL-encoded state)
        const stateData = exports.pkceStateManager.validateAndConsumeState(state);
        if (!stateData) {
            console.error(`[OAuth] Invalid or expired state: ${state.slice(0, 8)}...`);
            return {
                type: "failed",
                error: "Invalid or expired OAuth state",
            };
        }
        const { verifier, projectId } = stateData;
        const startTime = Date.now();
        const bodyParams = {
            client_id: constants_1.ALLOY_CLIENT_ID,
            code,
            grant_type: "authorization_code",
            redirect_uri: constants_1.ALLOY_REDIRECT_URI,
            code_verifier: verifier,
        };
        bodyParams.client_secret = (0, constants_1.getAlloyClientSecret)();
        const requestParams = new URLSearchParams(bodyParams);
        console.log('[OAuth] Token Exchange Request:', {
            url: "https://oauth2.googleapis.com/token",
            method: "POST",
            bodyKeys: Array.from(requestParams.keys()),
            clientId: constants_1.ALLOY_CLIENT_ID.slice(0, 20) + "...",
            clientSecretProvided: !!(0, constants_1.getAlloyClientSecret)(),
            clientSecretLength: (0, constants_1.getAlloyClientSecret)().length,
        });
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate, br",
                "User-Agent": constants_1.GEMINI_CLI_HEADERS["User-Agent"],
                "X-Goog-Api-Client": constants_1.GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
            },
            body: requestParams,
        });
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[OAuth] Token Exchange Failed:', errorText);
            return { type: "failed", error: errorText };
        }
        const tokenPayload = (await tokenResponse.json());
        const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
            headers: {
                Authorization: `Bearer ${tokenPayload.access_token}`,
                "User-Agent": constants_1.GEMINI_CLI_HEADERS["User-Agent"],
                "X-Goog-Api-Client": constants_1.GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
            },
        });
        const userInfo = userInfoResponse.ok
            ? (await userInfoResponse.json())
            : {};
        const refreshToken = tokenPayload.refresh_token;
        if (!refreshToken) {
            return { type: "failed", error: "Missing refresh token in response" };
        }
        let effectiveProjectId = projectId;
        if (!effectiveProjectId) {
            effectiveProjectId = await fetchProjectID(tokenPayload.access_token);
        }
        const storedRefresh = `${refreshToken}|${effectiveProjectId || ""}`;
        return {
            type: "success",
            refresh: storedRefresh,
            access: tokenPayload.access_token,
            expires: (0, auth_1.calculateTokenExpiry)(startTime, tokenPayload.expires_in),
            email: userInfo.email,
            projectId: effectiveProjectId || "",
        };
    }
    catch (error) {
        return {
            type: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
//# sourceMappingURL=oauth.js.map