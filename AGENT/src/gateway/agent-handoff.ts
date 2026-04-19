/**
 * Agent Handoff — Auth tamamlandıktan sonra agent sisteminin devralma noktası
 *
 * Token'ı AntigravityClient'a bağlar ve SequentialPipeline'ı başlatır.
 * Tam otonom çalışma döngüsüne girer.
 */

import { AntigravityClient } from "../orchestration/antigravity-client";
import { AccountManager } from "../plugin/accounts";
import { TokenStore, type StoredToken } from "./token-store";
import type { AntigravityConfig } from "../plugin/config";
import { ANTIGRAVITY_PROVIDER_ID } from "../constants";
import type { OAuthAuthDetails } from "../plugin/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HandoffOptions {
  /** Token store instance */
  tokenStore: TokenStore;
  /** Varsayılan model (ör. "gemini-3-pro") */
  defaultModel?: string;
  /** Otonom seviye: full | supervised */
  autonomyLevel?: "full" | "supervised";
  /** Antigravity config override */
  configOverrides?: Partial<AntigravityConfig>;
}

export interface HandoffResult {
  client: AntigravityClient;
  accountManager: AccountManager;
  token: StoredToken;
}

// ─── Agent Handoff ───────────────────────────────────────────────────────────

/**
 * Token store'dan auth bilgilerini alıp AntigravityClient oluşturur.
 * Agent sisteminin otonom çalışma altyapısını hazırlar.
 */
export async function performHandoff(
  options: HandoffOptions,
): Promise<HandoffResult> {
  const { tokenStore } = options;

  // 1. Geçerli token al
  let token = tokenStore.getActiveToken();
  if (!token) {
    throw new Error("Token store boş — önce auth tamamlanmalı.");
  }

  // 2. Token süresi dolduysa yenile
  if (tokenStore.isTokenExpired(token)) {
    console.log("[Handoff] Token süresi dolmuş, yenileniyor...");
    const refreshed = await tokenStore.refreshActiveToken();
    if (!refreshed) {
      throw new Error("Token yenileme başarısız — tekrar auth gerekli.");
    }
    token = refreshed;
  }

  // 3. AccountManager oluştur — OAuthAuthDetails fallback ile
  // AccountManager constructor'ı OAuthAuthDetails kabul eder ve hesabı
  // otomatik olarak internal pool'a ekler
  const authDetails: OAuthAuthDetails = {
    type: "oauth",
    refresh: token.refreshToken,
    access: token.accessToken,
    expires: token.expiresAt,
  };

  // Önce diskten yüklemeyi dene (antigravity-accounts.json varsa)
  // Yoksa authDetails fallback kullanılır
  let accountManager: AccountManager;
  try {
    accountManager = await AccountManager.loadFromDisk(authDetails);
  } catch {
    // Disk dosyası yoksa constructor ile oluştur
    accountManager = new AccountManager(authDetails);
  }

  // 4. Config hazırla
  const defaultConfig: AntigravityConfig = {
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
  } as AntigravityConfig;

  // 5. Auth getter fonksiyonu
  const getAuth = async () => {
    const currentToken = await tokenStore.getValidAccessToken();
    if (!currentToken) {
      throw new Error("Geçerli access token bulunamadı.");
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

  // 6. AntigravityClient oluştur
  const client = new AntigravityClient(
    accountManager,
    defaultConfig,
    ANTIGRAVITY_PROVIDER_ID,
    getAuth,
  );

  console.log(`[Handoff] ✅ AntigravityClient hazır`);
  console.log(`[Handoff]    Hesap: ${token.email || "bilinmiyor"}`);
  console.log(`[Handoff]    Project: ${token.projectId || "otomatik"}`);
  console.log(`[Handoff]    Model: ${options.defaultModel || "varsayılan"}`);
  console.log(`[Handoff]    Otonom Seviye: ${options.autonomyLevel || "supervised"}`);

  return { client, accountManager, token };
}
