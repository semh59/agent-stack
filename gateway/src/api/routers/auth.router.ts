import type { FastifyInstance } from "fastify";
import { type TokenStore } from "../../gateway/token-store";
import { type GatewayAuthManager } from "../../gateway/gateway-auth-manager";
import { apiResponse, apiError } from "../../gateway/rest-response";
import { DEFAULT_OAUTH_CALLBACK_PORT, checkOAuthCallbackPortAvailability } from "../../gateway/oauth-port";
import AsyncLock from "async-lock";

const authLock = new AsyncLock();

export interface AuthRouteDependencies {
  tokenStore: TokenStore;
  authManager: GatewayAuthManager;
}

/**
 * Defensive normalization for OAuth consent URLs before exposing them to clients.
 * This guards against malformed links from stale builds or intermediate rewrites.
 */
function normalizeOAuthConsentUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const isGoogleOAuthHost = host === "accounts.google.com" || host.endsWith(".accounts.google.com");
    if (!isGoogleOAuthHost) return rawUrl;

    if (!parsed.searchParams.get("response_type")) {
      parsed.searchParams.set("response_type", "code");
    }
    if (!parsed.searchParams.get("access_type")) {
      parsed.searchParams.set("access_type", "offline");
    }
    if (!parsed.searchParams.get("prompt")) {
      parsed.searchParams.set("prompt", "consent");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: AuthRouteDependencies,
): void {
  const { tokenStore, authManager } = dependencies;
  
  // State variables for Auth Server
  let activeAuthServer: import("../../gateway/auth-server").AuthServer | null = null;

  app.get("/api/auth/login", async (_request, reply) => {
    return authLock.acquire("login", async () => {
      try {
        const { authorizeGoogleGemini } = await import("../../google-gemini/oauth");
        const { AuthServer } = await import("../../gateway/auth-server");
        const { loadAccounts, saveAccounts } = await import("../../plugin/storage");

        const callbackPort = DEFAULT_OAUTH_CALLBACK_PORT;
        // Releasing a stale in-process auth listener avoids false EADDRINUSE on retry.
        if (activeAuthServer) {
          app.log.info("[GatewayAuthRouter] Stopping previous AuthServer instance...");
          activeAuthServer.stop();
          activeAuthServer = null;
        }
        const portCheck = await checkOAuthCallbackPortAvailability(callbackPort);
        if (!portCheck.available) {
          const message = `OAuth callback port ${callbackPort} is busy. Stop the other local auth process and retry.`;
          app.log.error({ port: callbackPort, code: portCheck.code, detail: portCheck.message }, "[GatewayAuthRouter] OAuth callback port preflight failed");
          return reply.status(409).send(
            apiError(message, {
              code: "OAUTH_CALLBACK_PORT_IN_USE",
              meta: {
                port: callbackPort,
                detail: portCheck.message ?? null,
              },
            }),
          );
        }
        
        // Generate the Google OAuth Consent URL and state first
        app.log.info("[GatewayAuthRouter] Generating OAuth URL...");
        const authData = await authorizeGoogleGemini();
        const oauthUrl = normalizeOAuthConsentUrl(authData.url);
        if (oauthUrl !== authData.url) {
          app.log.warn("[GatewayAuthRouter] OAuth URL normalized before returning to client.");
        }
        app.log.info({ oauthUrl }, "[GatewayAuthRouter] OAuth URL generated");

        // Start AuthServer to listen for the callback, expecting the specific state
        activeAuthServer = new AuthServer({ 
          port: callbackPort,
          tokenStore: tokenStore,
          expectedState: authData.state
        });
        
        activeAuthServer.start().then(async (result) => {
          activeAuthServer = null; // Clear when done
          if (!result.success || !result.token) return;
          
          try {
            // Also sync to the VSCode Plugin extension storage 
            const existing = await loadAccounts();
            const storage = existing ?? { version: 3 as const, accounts: [], activeIndex: 0 };
            
            // Check if duplicate
            const duplicate = storage.accounts.find(a => a.email && a.email === result.token!.email);
            if (duplicate) {
               duplicate.refreshToken = result.token!.refreshToken;
               duplicate.lastUsed = Date.now();
               duplicate.enabled = true;
            } else {
               storage.accounts.push({
                 email: result.token.email,
                 refreshToken: result.token.refreshToken,
                 projectId: (result.token as { projectId?: string }).projectId,
                 addedAt: Date.now(),
                 lastUsed: 0,
                 enabled: true,
               });
            }
            await saveAccounts(storage);
            app.log.info("[GatewayAuthRouter] HesabÄ±n VSCode plugin storage'a senkronizasyonu tamamlandÄ±.");

          } catch (storageErr) {
             app.log.error(storageErr, "[GatewayAuthRouter] Plugin storage sync error");
          }
        }).catch(err => {
          app.log.error(err, "[GatewayAuthRouter] AuthServer background start error");
        });

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
