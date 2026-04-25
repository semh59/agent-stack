import type { FastifyInstance } from "fastify";
import { type TokenStore, type StoredToken } from "../../gateway/token-store";
import { type AccountManager } from "../../plugin/accounts";
import { apiResponse, apiError, parsePagination } from "../../gateway/rest-response";

export interface AccountsRouteDependencies {
  tokenStore: TokenStore;
  getAccountManager: () => AccountManager | null;
}

export function registerAccountsRoutes(
  app: FastifyInstance,
  dependencies: AccountsRouteDependencies,
): void {
  const { tokenStore, getAccountManager } = dependencies;

  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/accounts",
    async (request) => {
      const accounts = tokenStore.getAllAccounts();
      const { page, limit, offset } = parsePagination(
        request.query as Record<string, unknown>,
      );
      const now = Date.now();

      const total = accounts.length;
      const slice = accounts.slice(offset, offset + limit);

      return apiResponse(
        slice.map((t: StoredToken) => ({
          email: t.email ?? '',
          expiresAt: t.expiresAt,
          isValid: (t.expiresAt > now) || (!!t.refreshToken),
        })),
        { page, limit, total, totalPages: Math.ceil(total / limit) },
      );
    },
  );

  app.get("/api/accounts/quota", async (_request, reply) => {
    try {
      const accountManager = getAccountManager();
      if (!accountManager) {
        return reply.status(503).send(apiError("Account manager not ready", { code: "SERVICE_UNAVAILABLE" }));
      }
      
      const accounts = accountManager.getAccountsSnapshot();
      const quotaResults = accounts.map(acc => ({
        email: acc.email,
        quota: acc.cachedQuota,
        updatedAt: acc.cachedQuotaUpdatedAt,
        isCoolingDown: accountManager.isAccountCoolingDown(acc) ?? false,
        cooldownReason: acc.cooldownReason
      }));

      return apiResponse(quotaResults);
    } catch (err) {
      app.log.error(err, "[Gateway] Failed to fetch quota data");
      return reply.status(500).send(apiError("Failed to fetch quota data", { code: "INTERNAL_ERROR" }));
    }
  });

  app.get("/api/accounts/active", async () => {
    const token = tokenStore.getActiveToken();
    return apiResponse(token ? { email: token.email ?? '' } : null);
  });

  app.post<{ Body: { email: string } }>(
    "/api/accounts/active",
    async (request, reply) => {
      const { email } = request.body ?? {};
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return reply.status(400).send(apiError("Invalid email format", { code: "BAD_REQUEST" }));
      }

      const success = tokenStore.setActiveAccountByEmail(email);
      if (success) return apiResponse({ email: email });
      return reply.status(404).send(apiError("Account not found", { code: "RESOURCE_NOT_FOUND" }));
    },
  );

  app.delete<{ Params: { email: string } }>(
    "/api/accounts/:email",
    async (request, reply) => {
      const emailToDel = request.params.email;
      if (!emailToDel) return reply.status(400).send(apiError("Invalid email", { code: "BAD_REQUEST" }));
      
      const decodedEmail = decodeURIComponent(emailToDel).trim().toLowerCase();
      app.log.info(`[Gateway] Attempting to delete account: "${decodedEmail}"`);
      
      // 1. Remove from Gateway's TokenStore
      const tokenDeleted = tokenStore.removeAccount(decodedEmail);
      
      // 2. Remove from Alloy's AccountManager pool
      let poolDeleted = false;
      const accountManager = getAccountManager();
      if (accountManager) {
        const accounts = accountManager.getAccounts();
        const target = accounts.find(a => a.email?.toLowerCase().trim() === decodedEmail);
        
        if (target) {
          app.log.info(`[Gateway] Found account in pool: ${target.email}. Deleting...`);
          poolDeleted = accountManager.removeAccountByEmail(target.email || "");
          if (poolDeleted) {
            await accountManager.saveToDisk();
            app.log.info(`[Gateway] Successfully deleted ${decodedEmail} from AccountManager pool.`);
          }
        }
      }

      if (tokenDeleted || poolDeleted) {
        return apiResponse({ deleted: true });
      } else {
        return reply.status(404).send(apiError("Account not found", { code: "RESOURCE_NOT_FOUND" }));
      }
    }
  );
}
