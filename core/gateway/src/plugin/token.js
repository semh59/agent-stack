"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlloyTokenRefreshError = void 0;
exports.refreshAccessToken = refreshAccessToken;
const constants_1 = require("../constants");
const auth_1 = require("./auth");
const cache_1 = require("./cache");
const logger_1 = require("./logger");
const project_1 = require("./project");
const log = (0, logger_1.createLogger)("token");
/**
 * Parses OAuth error payloads returned by Google token endpoints, tolerating varied shapes.
 */
function parseOAuthErrorPayload(text) {
    if (!text) {
        return {};
    }
    try {
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== "object") {
            return { description: text };
        }
        let code;
        if (typeof payload.error === "string") {
            code = payload.error;
        }
        else if (payload.error && typeof payload.error === "object") {
            code = payload.error.status ?? payload.error.code;
            if (!payload.error_description && payload.error.message) {
                return { code, description: payload.error.message };
            }
        }
        const description = payload.error_description;
        if (description) {
            return { code, description };
        }
        if (payload.error && typeof payload.error === "object" && payload.error.message) {
            return { code, description: payload.error.message };
        }
        return { code };
    }
    catch {
        return { description: text };
    }
}
class AlloyTokenRefreshError extends Error {
    code;
    description;
    status;
    statusText;
    constructor(options) {
        super(options.message);
        this.name = "AlloyTokenRefreshError";
        this.code = options.code;
        this.description = options.description;
        this.status = options.status;
        this.statusText = options.statusText;
    }
}
exports.AlloyTokenRefreshError = AlloyTokenRefreshError;
const refreshPromises = new Map();
/**
 * Refreshes an Alloy OAuth access token, updates persisted credentials, and handles revocation.
 * Implements Double-Fetch Protection to prevent multiple simultaneous refreshes for the same token.
 */
async function refreshAccessToken(auth, _client, _providerId) {
    const parts = (0, auth_1.parseRefreshParts)(auth.refresh);
    if (!parts.refreshToken) {
        return undefined;
    }
    // Double-Fetch Protection: If a refresh is already in progress for this token, wait for it
    const existingPromise = refreshPromises.get(parts.refreshToken);
    if (existingPromise) {
        log.debug("Waiting for existing refresh promise", { token: parts.refreshToken.slice(0, 8) });
        return existingPromise;
    }
    const refreshPromise = (async () => {
        try {
            const startTime = Date.now();
            const response = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    refresh_token: parts.refreshToken,
                    client_id: constants_1.ALLOY_CLIENT_ID,
                    client_secret: (0, constants_1.getAlloyClientSecret)(),
                }),
            });
            if (!response.ok) {
                let errorText;
                try {
                    errorText = await response.text();
                }
                catch {
                    errorText = undefined;
                }
                const { code, description } = parseOAuthErrorPayload(errorText);
                const details = [code, description ?? errorText].filter(Boolean).join(": ");
                const baseMessage = `Alloy token refresh failed (${response.status} ${response.statusText})`;
                const message = details ? `${baseMessage} - ${details}` : baseMessage;
                log.warn("Token refresh failed", { status: response.status, code, details });
                if (code === "invalid_grant") {
                    log.warn("Google revoked the stored refresh token - reauthentication required");
                    (0, project_1.invalidateProjectContextCache)(auth.refresh);
                    (0, cache_1.clearCachedAuth)(auth.refresh);
                }
                throw new AlloyTokenRefreshError({
                    message,
                    code,
                    description: description ?? errorText,
                    status: response.status,
                    statusText: response.statusText,
                });
            }
            const payload = (await response.json());
            const refreshedParts = {
                refreshToken: payload.refresh_token ?? parts.refreshToken,
                projectId: parts.projectId,
                managedProjectId: parts.managedProjectId,
            };
            const updatedAuth = {
                ...auth,
                access: payload.access_token,
                expires: (0, auth_1.calculateTokenExpiry)(startTime, payload.expires_in),
                refresh: (0, auth_1.formatRefreshParts)(refreshedParts),
            };
            (0, cache_1.storeCachedAuth)(updatedAuth);
            (0, project_1.invalidateProjectContextCache)(auth.refresh);
            return updatedAuth;
        }
        catch (error) {
            if (error instanceof AlloyTokenRefreshError) {
                throw error;
            }
            log.error("Unexpected token refresh error", { error: String(error) });
            return undefined;
        }
        finally {
            // Always clear the promise from the map when finished
            refreshPromises.delete(parts.refreshToken);
        }
    })();
    refreshPromises.set(parts.refreshToken, refreshPromise);
    return refreshPromise;
}
//# sourceMappingURL=token.js.map