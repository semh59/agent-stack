/**
 * Gateway — Ana Orkestrasyon
 *
 * Tüm akışı yönetir:
 * 1. Token store kontrol (mevcut geçerli token var mı?)
 * 2. Yoksa: Auth Server başlat → Tarayıcı aç → Token bekle
 * 3. Token alındı → Agent Handoff → Otonom çalışma
 */

import { AuthServer, type AuthServerOptions } from "./auth-server";
import { launchOAuthBrowser } from "./browser-launcher";
import { TokenStore } from "./token-store";
import { performHandoff, type HandoffOptions, type HandoffResult } from "./agent-handoff";

/** Mask email for PII safety: "user@gmail.com" → "u***@gmail.com" */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GatewayOptions {
  /** Token dosya yolu (varsayılan: ~/.config/agent/antigravity-tokens.json) */
  tokenStorePath?: string;
  /** OAuth callback port (varsayılan: 51121) */
  port?: number;
  /** Auth timeout ms (varsayılan: 5 dakika) */
  authTimeoutMs?: number;
  /** Google Cloud project ID */
  projectId?: string;
  /** Varsayılan AI model */
  defaultModel?: string;
  /** Otonom seviye */
  autonomyLevel?: "full" | "supervised";
  /** Sadece auth yap, agent başlatma */
  authOnly?: boolean;
  /** Auth sonrası çağrılacak callback */
  onAuthComplete?: (result: HandoffResult) => Promise<void> | void;
  /** Agent döngüsü — otonom çalışma mantığı */
  onAgentLoop?: (result: HandoffResult) => Promise<void> | void;
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   🚀  Agent Auth Gateway                             ║
║   ─────────────────────────────────────────────      ║
║   Google Antigravity OAuth → Otonom Agent Sistemi    ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

/**
 * Gateway'i başlat.
 *
 * 1. Mevcut token varsa direkt agent'ı devralır
 * 2. Token yoksa tarayıcı açıp OAuth akışı başlatır
 * 3. Token alındıktan sonra agent sistemi otonom olarak çalışır
 */
export async function startGateway(options: GatewayOptions = {}): Promise<HandoffResult | null> {
  printBanner();

  // 1. Token Store oluştur
  const tokenStore = new TokenStore(options.tokenStorePath);

  // 2. Mevcut geçerli token kontrol
  if (tokenStore.hasValidToken()) {
    const token = tokenStore.getActiveToken()!;
    console.log(`✅ Mevcut token geçerli: ${maskEmail(token.email || "hesap")}`);
    console.log(`   Token süresi: ${new Date(token.expiresAt).toISOString()}`);
    console.log("");

    // Auth only modunda burada dur
    if (options.authOnly) {
      console.log("📋 Auth-only mod — agent başlatılmadı.");
      return null;
    }

    // Direkt handoff
    return await executeHandoff(tokenStore, options);
  }

  // 3. Token süresi dolmuş ama refresh var mı?
  const expiredToken = tokenStore.getActiveToken();
  if (expiredToken?.refreshToken) {
    console.log("🔄 Token süresi dolmuş, yenileniyor...");
    const refreshed = await tokenStore.refreshActiveToken();
    if (refreshed) {
      console.log(`✅ Token yenilendi: ${maskEmail(refreshed.email || "hesap")}\n`);

      if (options.authOnly) {
        console.log("📋 Auth-only mod — agent başlatılmadı.");
        return null;
      }

      return await executeHandoff(tokenStore, options);
    }
    console.log("⚠️  Token yenileme başarısız — yeni giriş gerekli.\n");
  }

  // 4. Yeni auth akışı başlat
  console.log("🔐 Yeni OAuth giriş akışı başlatılıyor...\n");

  // Önce URL ve State oluştur (CSRF için)
  const authInfo = await launchOAuthBrowser(options.projectId);

  // Auth server oluştur ve beklenen state'i ver
  const authServer = new AuthServer({
    port: options.port,
    timeoutMs: options.authTimeoutMs,
    tokenStore,
    expectedState: authInfo.authorization.state,
  });

  // Auth server'ı başlat (arka planda dinler)
  const authPromise = authServer.start();

  // Token gelene kadar bekle
  const authResult = await authPromise;

  if (!authResult.success || !authResult.token) {
    console.error(`\n❌ Auth başarısız: ${authResult.error}`);
    console.log("   Tekrar denemek için: npm run agent:start\n");
    return null;
  }

  console.log("\n" + "═".repeat(50));
  console.log("🎉 Google Antigravity hesabı başarıyla bağlandı!");
  console.log("═".repeat(50) + "\n");

  // Auth only modunda burada dur
  if (options.authOnly) {
    console.log("📋 Auth-only mod — token kaydedildi, agent başlatılmadı.");
    return null;
  }

  // 5. Agent handoff
  return await executeHandoff(tokenStore, options);
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function executeHandoff(
  tokenStore: TokenStore,
  options: GatewayOptions,
): Promise<HandoffResult> {
  console.log("🤖 Agent sistemi devralınıyor...\n");

  const handoffOpts: HandoffOptions = {
    tokenStore,
    defaultModel: options.defaultModel,
    autonomyLevel: options.autonomyLevel,
  };

  const result = await performHandoff(handoffOpts);

  // Auth complete callback
  if (options.onAuthComplete) {
    await options.onAuthComplete(result);
  }

  // Agent loop callback
  if (options.onAgentLoop) {
    console.log("\n🔁 Otonom agent döngüsü başlıyor...\n");
    await options.onAgentLoop(result);
  }

  return result;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { TokenStore } from "./token-store";
export { AuthServer } from "./auth-server";
export { launchOAuthBrowser } from "./browser-launcher";
export { performHandoff } from "./agent-handoff";
export type { HandoffResult } from "./agent-handoff";
