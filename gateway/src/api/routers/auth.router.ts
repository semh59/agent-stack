import type { FastifyInstance } from "fastify";
import { type TokenStore } from "../../gateway/token-store";
import { type GatewayAuthManager } from "../../gateway/gateway-auth-manager";
import { apiResponse, apiError } from "../../gateway/rest-response";
import { DEFAULT_OAUTH_CALLBACK_PORT, checkOAuthCallbackPortAvailability } from "../../gateway/oauth-port";
import AsyncLock from "async-lock";
import type { AuthServer } from "../../gateway/auth-server";

const authLock = new AsyncLock();

export interface AuthRouteDependencies {
  tokenStore: TokenStore;
  authManager: GatewayAuthManager;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: AuthRouteDependencies,
): void {
  const { tokenStore, authManager } = dependencies;
  
  // State variables for Auth Server
  let activeAuthServer: AuthServer | null = null;

  app.get("/api/auth/login", async (request, reply) => {
    return authLock.acquire("login", async () => {
      try {
        const { provider = "google", redirect, token: queryToken } = request.query as { provider?: string; redirect?: string; token?: string };
        const { getProviderAdapterByName } = await import("../../gateway/provider-registry");
        const { AuthServer } = await import("../../gateway/auth-server");
        const { loadAccounts, saveAccounts } = await import("../../plugin/storage");

        // Auth check for window.open flows that can't use headers
        const effectiveToken = queryToken || (request.headers.authorization?.split(" ")[1]);
        if (!effectiveToken || !authManager.verifyToken(effectiveToken)) {
          return reply.status(401).send(apiError("Unauthorized"));
        }

        const adapter = getProviderAdapterByName(provider);
        const callbackPort = DEFAULT_OAUTH_CALLBACK_PORT;

        if (activeAuthServer) {
          app.log.info("[GatewayAuthRouter] Stopping previous AuthServer instance...");
          activeAuthServer.stop();
          activeAuthServer = null;
        }

        const portCheck = await checkOAuthCallbackPortAvailability(callbackPort);
        if (!portCheck.available) {
          const message = `OAuth callback port ${callbackPort} is busy. Stop the other local auth process and retry.`;
          return reply.status(409).send(apiError(message, { code: "OAUTH_CALLBACK_PORT_IN_USE" }));
        }
        
        app.log.info({ provider }, "[GatewayAuthRouter] Generating OAuth URL...");
        const authData = await adapter.getAuthUrl();
        const oauthUrl = authData.url;

        const currentServer = new AuthServer({ 
          port: callbackPort,
          tokenStore: tokenStore,
          expectedState: authData.state,
          adapter
        });
        activeAuthServer = currentServer;
        
        currentServer.start().then(async (result) => {
          if (activeAuthServer === currentServer) {
            activeAuthServer = null;
          }
          if (!result.success || !result.token) return;
          
          try {
            const existing = await loadAccounts();
            const storage = existing ?? { version: 3 as const, accounts: [], activeIndex: 0 };
            
            const duplicateIndex = storage.accounts.findIndex(a => a.email === result.token!.email);
            const accountData = {
              email: result.token.email,
              refreshToken: result.token.refreshToken,
              projectId: result.token.projectId,
              addedAt: result.token.createdAt || Date.now(),
              lastUsed: Date.now(),
              enabled: true,
            };

            if (duplicateIndex >= 0) {
              storage.accounts[duplicateIndex] = { ...storage.accounts[duplicateIndex], ...accountData };
            } else {
              storage.accounts.push(accountData);
            }
            await saveAccounts(storage);
            app.log.info("[GatewayAuthRouter] Account synced to plugin storage.");
          } catch (storageErr) {
             app.log.error(storageErr, "[GatewayAuthRouter] Plugin storage sync error");
          }
        }).catch(err => {
          if (activeAuthServer === currentServer) activeAuthServer = null;
          app.log.error(err, "[GatewayAuthRouter] AuthServer background error");
        });

        if (redirect === "true") {
          return reply.redirect(oauthUrl);
        }

        return apiResponse({ url: oauthUrl });
      } catch (err) {
        app.log.error(err, "[GatewayAuthRouter] Failed to generate auth URL");
        return reply.status(500).send(apiError("Authentication preparation failed"));
      }
    });
  });

  app.get("/api/gateway/token/status", async () => {
    return apiResponse(authManager.getTokenState());
  });

  app.post<{ Body: { token?: string; graceMs?: number } }>(
    "/api/gateway/token/rotate",
    async (request, reply) => {
      try {
        const graceMs =
          request.body && typeof request.body.graceMs === "number" ? request.body.graceMs : undefined;
        const token =
          request.body && typeof request.body.token === "string" ? request.body.token : undefined;
        const rotated = authManager.rotateToken(token, graceMs);
        return apiResponse(rotated);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send(apiError(message));
      }
    },
  );

  app.post("/api/gateway/token/revoke-grace", async () => {
    authManager.revokeGraceTokens();
    return apiResponse({ revoked: true });
  });
}
