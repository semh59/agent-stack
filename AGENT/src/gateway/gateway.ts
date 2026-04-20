/**
 * Gateway â€” Ana Orkestrasyon
 *
 * TÃ¼m akÄ±ÅŸÄ± yÃ¶netir:
 * 1. Token store kontrol (mevcut geÃ§erli token var mÄ±?)
 * 2. Yoksa: Auth Server baÅŸlat â†’ TarayÄ±cÄ± aÃ§ â†’ Token bekle
 * 3. Token alÄ±ndÄ± â†’ Agent Handoff â†’ Otonom Ã§alÄ±ÅŸma
 */

import { AuthServer, type AuthServerOptions } from "./auth-server";
import { launchOAuthBrowser } from "./browser-launcher";
import { TokenStore } from "./token-store";
import { performHandoff, type HandoffOptions, type HandoffResult } from "./agent-handoff";

/** Mask email for PII safety: "user@gmail.com" â†’ "u***@gmail.com" */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GatewayOptions {
  /** Token dosya yolu (varsayÄ±lan: ~/.config/agent/google-gemini-tokens.json) */
  tokenStorePath?: string;
  /** OAuth callback port (varsayÄ±lan: 51121) */
  port?: number;
  /** Auth timeout ms (varsayÄ±lan: 5 dakika) */
  authTimeoutMs?: number;
  /** Google Cloud project ID */
  projectId?: string;
  /** VarsayÄ±lan AI model */
  defaultModel?: string;
  /** Otonom seviye */
  autonomyLevel?: "full" | "supervised";
  /** Sadece auth yap, agent baÅŸlatma */
  authOnly?: boolean;
  /** Auth sonrasÄ± Ã§aÄŸrÄ±lacak callback */
  onAuthComplete?: (result: HandoffResult) => Promise<void> | void;
  /** Agent dÃ¶ngÃ¼sÃ¼ â€” otonom Ã§alÄ±ÅŸma mantÄ±ÄŸÄ± */
  onAgentLoop?: (result: HandoffResult) => Promise<void> | void;
}

// â”€â”€â”€ Banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function printBanner(): void {
  console.log(`
â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘                                                      â•‘
â•‘   ğŸš€  Agent Auth Gateway                             â•‘
â•‘   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€      â•‘
â•‘   Google Sovereign OAuth â†’ Otonom Agent Sistemi    â•‘
â•‘                                                      â•‘
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  `);
}

// â”€â”€â”€ Gateway â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Gateway'i baÅŸlat.
 *
 * 1. Mevcut token varsa direkt agent'Ä± devralÄ±r
 * 2. Token yoksa tarayÄ±cÄ± aÃ§Ä±p OAuth akÄ±ÅŸÄ± baÅŸlatÄ±r
 * 3. Token alÄ±ndÄ±ktan sonra agent sistemi otonom olarak Ã§alÄ±ÅŸÄ±r
 */
export async function startGateway(options: GatewayOptions = {}): Promise<HandoffResult | null> {
  printBanner();

  // 1. Token Store oluÅŸtur
  const tokenStore = new TokenStore(options.tokenStorePath);

  // 2. Mevcut geÃ§erli token kontrol
  if (tokenStore.hasValidToken()) {
    const token = tokenStore.getActiveToken()!;
    console.log(`âœ… Mevcut token geÃ§erli: ${maskEmail(token.email || "hesap")}`);
    console.log(`   Token sÃ¼resi: ${new Date(token.expiresAt).toISOString()}`);
    console.log("");

    // Auth only modunda burada dur
    if (options.authOnly) {
      console.log("ğŸ“‹ Auth-only mod â€” agent baÅŸlatÄ±lmadÄ±.");
      return null;
    }

    // Direkt handoff
    return await executeHandoff(tokenStore, options);
  }

  // 3. Token sÃ¼resi dolmuÅŸ ama refresh var mÄ±?
  const expiredToken = tokenStore.getActiveToken();
  if (expiredToken?.refreshToken) {
    console.log("ğŸ”„ Token sÃ¼resi dolmuÅŸ, yenileniyor...");
    const refreshed = await tokenStore.refreshActiveToken();
    if (refreshed) {
      console.log(`âœ… Token yenilendi: ${maskEmail(refreshed.email || "hesap")}\n`);

      if (options.authOnly) {
        console.log("ğŸ“‹ Auth-only mod â€” agent baÅŸlatÄ±lmadÄ±.");
        return null;
      }

      return await executeHandoff(tokenStore, options);
    }
    console.log("âš ï¸  Token yenileme baÅŸarÄ±sÄ±z â€” yeni giriÅŸ gerekli.\n");
  }

  // 4. Yeni auth akÄ±ÅŸÄ± baÅŸlat
  console.log("ğŸ” Yeni OAuth giriÅŸ akÄ±ÅŸÄ± baÅŸlatÄ±lÄ±yor...\n");

  // Ã–nce URL ve State oluÅŸtur (CSRF iÃ§in)
  const authInfo = await launchOAuthBrowser(options.projectId);

  // Auth server oluÅŸtur ve beklenen state'i ver
  const authServer = new AuthServer({
    port: options.port,
    timeoutMs: options.authTimeoutMs,
    tokenStore,
    expectedState: authInfo.authorization.state,
  });

  // Auth server'Ä± baÅŸlat (arka planda dinler)
  const authPromise = authServer.start();

  // Token gelene kadar bekle
  const authResult = await authPromise;

  if (!authResult.success || !authResult.token) {
    console.error(`\nâŒ Auth baÅŸarÄ±sÄ±z: ${authResult.error}`);
    console.log("   Tekrar denemek iÃ§in: npm run agent:start\n");
    return null;
  }

  console.log("\n" + "â•".repeat(50));
  console.log("ğŸ‰ Google Sovereign hesabÄ± baÅŸarÄ±yla baÄŸlandÄ±!");
  console.log("â•".repeat(50) + "\n");

  // Auth only modunda burada dur
  if (options.authOnly) {
    console.log("ğŸ“‹ Auth-only mod â€” token kaydedildi, agent baÅŸlatÄ±lmadÄ±.");
    return null;
  }

  // 5. Agent handoff
  return await executeHandoff(tokenStore, options);
}

// â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function executeHandoff(
  tokenStore: TokenStore,
  options: GatewayOptions,
): Promise<HandoffResult> {
  console.log("ğŸ¤– Agent sistemi devralÄ±nÄ±yor...\n");

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
    console.log("\nğŸ” Otonom agent dÃ¶ngÃ¼sÃ¼ baÅŸlÄ±yor...\n");
    await options.onAgentLoop(result);
  }

  return result;
}

// â”€â”€â”€ Exports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export { TokenStore } from "./token-store";
export { AuthServer } from "./auth-server";
export { launchOAuthBrowser } from "./browser-launcher";
export { performHandoff } from "./agent-handoff";
export type { HandoffResult } from "./agent-handoff";
