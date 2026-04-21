/**
 * Agent Handoff â€” Auth tamamlandÄ±ktan sonra agent sisteminin devralma noktasÄ±
 *
 * Token'Ä± AlloyGatewayClient'a baÄŸlar ve SequentialPipeline'Ä± baÅŸlatÄ±r.
 * Tam otonom Ã§alÄ±ÅŸma dÃ¶ngÃ¼sÃ¼ne girer.
 */

import { AlloyGatewayClient } from "../orchestration/gateway-client";
import { AccountManager } from "../plugin/accounts";
import { TokenStore, type StoredToken } from "./token-store";
import type { AlloyGatewayConfig } from "../plugin/config";
import { GOOGLE_GEMINI_PROVIDER_ID } from "../constants";
import type { OAuthAuthDetails } from "../plugin/types";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface HandoffOptions {
  /** Token store instance */
  tokenStore: TokenStore;
  /** VarsayÄ±lan model (Ã¶r. "gemini-3-pro") */
  defaultModel?: string;
  /** Otonom seviye: full | supervised */
  autonomyLevel?: "full" | "supervised";
  /** Alloy config override */
  configOverrides?: Partial<AlloyGatewayConfig>;
}

export interface HandoffResult {
  client: AlloyGatewayClient;
  accountManager: AccountManager;
  token: StoredToken;
}

// â”€â”€â”€ Agent Handoff â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Token store'dan auth bilgilerini alÄ±p AlloyGatewayClient oluÅŸturur.
 * Agent sisteminin otonom Ã§alÄ±ÅŸma altyapÄ±sÄ±nÄ± hazÄ±rlar.
 */
export async function performHandoff(
  options: HandoffOptions,
): Promise<HandoffResult> {
  const { tokenStore } = options;

  // 1. GeÃ§erli token al
  let token = tokenStore.getActiveToken();
  if (!token) {
    throw new Error("Token store boÅŸ â€” Ã¶nce auth tamamlanmalÄ±.");
  }

  // 2. Token sÃ¼resi dolduysa yenile
  if (tokenStore.isTokenExpired(token)) {
    console.log("[Handoff] Token sÃ¼resi dolmuÅŸ, yenileniyor...");
    const refreshed = await tokenStore.refreshActiveToken();
    if (!refreshed) {
      throw new Error("Token yenileme baÅŸarÄ±sÄ±z â€” tekrar auth gerekli.");
    }
    token = refreshed;
  }

  // 3. AccountManager oluÅŸtur â€” OAuthAuthDetails fallback ile
  // AccountManager constructor'Ä± OAuthAuthDetails kabul eder ve hesabÄ±
  // otomatik olarak internal pool'a ekler
  const authDetails: OAuthAuthDetails = {
    type: "oauth",
    refresh: token.refreshToken,
    access: token.accessToken,
    expires: token.expiresAt,
  };

  // Ã–nce diskten yÃ¼klemeyi dene (Alloy-accounts.json varsa)
  // Yoksa authDetails fallback kullanÄ±lÄ±r
  let accountManager: AccountManager;
  try {
    accountManager = await AccountManager.loadFromDisk(authDetails);
  } catch {
    // Disk dosyasÄ± yoksa constructor ile oluÅŸtur
    accountManager = new AccountManager(authDetails);
  }

  // 4. Config hazÄ±rla
  const defaultConfig: AlloyGatewayConfig = {
    account_selection_strategy: "round-robin",
    max_rate_limit_wait_seconds: 300,
    quiet_mode: false,
    toast_scope: "all",
    soft_quota_threshold_percent: 80,
    soft_quota_cache_ttl_minutes: 5,
    quota_refresh_interval_minutes: 10,
    pid_offset_enabled: false,
    cli_first: false,
    ...options.configOverrides,
  } as AlloyGatewayConfig;

  // 5. Auth getter fonksiyonu
  const getAuth = async () => {
    const currentToken = await tokenStore.getValidAccessToken();
    if (!currentToken) {
      throw new Error("GeÃ§erli access token bulunamadÄ±.");
    }

    const activeToken = tokenStore.getActiveToken()!;
    return {
      type: "oauth" as const,
      access: currentToken,
      refresh: activeToken.refreshToken,
      expires: activeToken.expiresAt,
      projectId: activeToken.projectId || "",
      email: activeToken.email,
    };
  };

  // 6. AlloyGatewayClient oluÅŸtur
  const client = new AlloyGatewayClient(
    accountManager,
    defaultConfig,
    GOOGLE_GEMINI_PROVIDER_ID,
    getAuth,
  );

  console.log(`[Handoff] âœ… AlloyGatewayClient hazÄ±r`);
  console.log(`[Handoff]    Hesap: ${token.email || "bilinmiyor"}`);
  console.log(`[Handoff]    Project: ${token.projectId || "otomatik"}`);
  console.log(`[Handoff]    Model: ${options.defaultModel || "varsayÄ±lan"}`);
  console.log(`[Handoff]    Otonom Seviye: ${options.autonomyLevel || "supervised"}`);

  return { client, accountManager, token };
}
