"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlloyGatewayClient = void 0;
const auth_1 = require("../plugin/auth");
const gateway_api_1 = require("./gateway-api");
const gateway_utils_1 = require("./gateway-utils");
class AlloyGatewayClient {
    accountManager;
    config;
    providerId;
    getAuth;
    nativeFetch;
    api;
    constructor(accountManager, config, providerId, getAuth, nativeFetch = globalThis.fetch) {
        this.accountManager = accountManager;
        this.config = config;
        this.providerId = providerId;
        this.getAuth = getAuth;
        this.nativeFetch = nativeFetch;
        this.api = new gateway_api_1.AlloyAPI(accountManager, config, providerId, getAuth, nativeFetch);
    }
    /**
     * Static factory for simplified instantiation
     */
    static fromToken(accessToken, email = 'default', realManager) {
        const fallbackExpiresAt = Date.now() + (55 * 60 * 1000);
        const manager = realManager || {
            getActiveAccount: () => ({ email, accessToken, access: accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }),
            getAccountCount: () => 1,
            getAccounts: () => [{ email, accessToken, access: accessToken, expires: fallbackExpiresAt }],
            getAccountsSnapshot: () => [{ email, access: accessToken, accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }],
            switchToAccount: async () => true,
            getCurrentAccountForFamily: () => ({ email, access: accessToken, accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }),
            getCurrentOrNextForFamily: () => ({ email, access: accessToken, accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }),
            markRateLimited: () => { },
            markAccountUsed: () => { },
        };
        const config = {
            Alloy: {
                accounts: [{ email, accessToken }]
            }
        };
        return new AlloyGatewayClient(manager, config, 'Alloy', async () => {
            const active = resolveManagedAccount(manager, email, accessToken) ?? {
                email,
                access: accessToken,
                accessToken,
                expires: fallbackExpiresAt,
                parts: { refreshToken: accessToken },
            };
            return {
                type: "oauth",
                access: active.access || active.accessToken || accessToken,
                expires: active.expires ?? fallbackExpiresAt,
                refresh: (0, auth_1.formatRefreshParts)(active.parts ?? { refreshToken: accessToken }),
            };
        });
    }
    /**
     * Main fetch method used by SequentialPipeline and other components.
     * Delegates to AlloyAPI for retries and rotation.
     */
    async fetch(input, init) {
        return this.api.fetch(input, init);
    }
    /**
     * Thinking warmup (Claude-specific feature)
     */
    async runThinkingWarmup(prepared, projectId) {
        gateway_utils_1.log.info(`[Alloy AI] Running thinking warmup for project: ${projectId}`);
        // Warmup implementation logic moved/simplified here
        // In a real scenario, this would send a minimal request to "warm up" the thinking capacity
    }
    /**
     * For compatibility with parts of the code expecting standard fetch-like interface
     */
    get nativeFetchHandler() {
        return this.fetch.bind(this);
    }
}
exports.AlloyGatewayClient = AlloyGatewayClient;
function resolveManagedAccount(manager, email, accessToken) {
    const dynamicManager = manager;
    const getCurrentForFamily = dynamicManager.getCurrentAccountForFamily;
    const byFamily = getCurrentForFamily?.("gemini") ?? getCurrentForFamily?.("claude");
    if (byFamily) {
        return byFamily;
    }
    const getSnapshots = dynamicManager.getAccountsSnapshot;
    const snapshots = getSnapshots?.();
    if (Array.isArray(snapshots)) {
        const byEmail = snapshots.find((account) => account.email === email);
        if (byEmail) {
            return byEmail;
        }
    }
    const getActive = dynamicManager.getActiveAccount;
    const active = getActive?.();
    if (active) {
        return active;
    }
    return {
        access: accessToken,
        accessToken,
        expires: Date.now() + (55 * 60 * 1000),
        parts: { refreshToken: accessToken },
    };
}
//# sourceMappingURL=gateway-client.js.map