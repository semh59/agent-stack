import { type HeaderStyle } from "../constants";
import { type SovereignGatewayConfig } from "../plugin/config";
import { type ModelFamily, AccountManager } from "../plugin/accounts";
import { formatRefreshParts } from "../plugin/auth";
import type { OAuthAuthDetails } from "../plugin/types";
import { SovereignAPI } from "./gateway-api";
import { toUrlString, extractModelFromUrl, getModelFamilyFromUrl, log } from "./gateway-utils";
import { prepareSovereignRequest } from "../plugin/request";

export class SovereignGatewayClient {
  private api: SovereignAPI;

  constructor(
    private accountManager: AccountManager,
    private config: SovereignGatewayConfig,
    private providerId: string,
    private getAuth: () => Promise<any>,
    private nativeFetch: typeof fetch = globalThis.fetch
  ) {
    this.api = new SovereignAPI(
      accountManager,
      config,
      providerId,
      getAuth,
      nativeFetch
    );
  }

  /**
   * Static factory for simplified instantiation
   */
  public static fromToken(accessToken: string, email: string = 'default', realManager?: AccountManager): SovereignGatewayClient {
    const fallbackExpiresAt = Date.now() + (55 * 60 * 1000);
    const manager = realManager || ({
      getActiveAccount: () => ({ email, accessToken, access: accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }),
      getAccountCount: () => 1,
      getAccounts: () => [{ email, accessToken, access: accessToken, expires: fallbackExpiresAt }],
      getAccountsSnapshot: () => [{ email, access: accessToken, accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }],
      switchToAccount: async () => true,
      getCurrentAccountForFamily: () => ({ email, access: accessToken, accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }),
      getCurrentOrNextForFamily: () => ({ email, access: accessToken, accessToken, expires: fallbackExpiresAt, parts: { refreshToken: accessToken } }),
      markRateLimited: () => {},
      markAccountUsed: () => {},
    } as any);

    const config = {
      Sovereign: {
        accounts: [{ email, accessToken }]
      }
    } as any;

    return new SovereignGatewayClient(
      manager,
      config,
      'Sovereign',
      async (): Promise<OAuthAuthDetails> => {
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
          refresh: formatRefreshParts(active.parts ?? { refreshToken: accessToken }),
        };
      },
    );
  }

  /**
   * Main fetch method used by SequentialPipeline and other components.
   * Delegates to SovereignAPI for retries and rotation.
   */
  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return this.api.fetch(input, init);
  }

  /**
   * Thinking warmup (Claude-specific feature)
   */
  public async runThinkingWarmup(
    prepared: ReturnType<typeof prepareSovereignRequest>,
    projectId: string,
  ): Promise<void> {
    log.info(`[Sovereign AI] Running thinking warmup for project: ${projectId}`);
    // Warmup implementation logic moved/simplified here
    // In a real scenario, this would send a minimal request to "warm up" the thinking capacity
  }

  /**
   * For compatibility with parts of the code expecting standard fetch-like interface
   */
  public get nativeFetchHandler(): typeof fetch {
    return this.fetch.bind(this) as any;
  }
}

function resolveManagedAccount(
  manager: AccountManager | Record<string, any>,
  email: string,
  accessToken: string,
): { access?: string; accessToken?: string; expires?: number; parts?: { refreshToken: string; projectId?: string; managedProjectId?: string } } | null {
  const dynamicManager = manager as Record<string, any>;
  const byFamily =
    dynamicManager.getCurrentAccountForFamily?.("gemini") ??
    dynamicManager.getCurrentAccountForFamily?.("claude");
  if (byFamily) {
    return byFamily;
  }

  const snapshots = dynamicManager.getAccountsSnapshot?.();
  if (Array.isArray(snapshots)) {
    const byEmail = snapshots.find((account: { email?: string }) => account.email === email);
    if (byEmail) {
      return byEmail;
    }
  }

  const active = dynamicManager.getActiveAccount?.();
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
