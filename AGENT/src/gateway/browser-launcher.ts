/**
 * Browser Launcher — Platform bağımsız tarayıcı açma
 *
 * OAuth URL'yi kullanıcının varsayılan tarayıcısında açar.
 * Windows/macOS/Linux desteği.
 * Tarayıcı açılamıyorsa URL'yi terminale yazdırarak fallback sağlar.
 */

import { spawn } from "node:child_process";
import { authorizeAntigravity } from "../antigravity/oauth";
import type { AntigravityAuthorization } from "../antigravity/oauth";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LaunchResult {
  authorization: AntigravityAuthorization;
  browserOpened: boolean;
}

// ─── Browser Open ────────────────────────────────────────────────────────────

/**
 * Platform-independent browser opener using spawn (safer than exec).
 */
function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let command: string;
    let args: string[];

    if (process.platform === "win32") {
      // Windows: use 'cmd' with '/c start'
      // We use 'cmd /c start "" "url"' pattern which is robust
      command = "cmd";
      args = ["/c", "start", `"${url.replace(/&/g, "^&")}"`];
    } else if (process.platform === "darwin") {
      // macOS: use 'open'
      command = "open";
      args = [url];
    } else {
      // Linux: use 'xdg-open'
      command = "xdg-open";
      args = [url];
    }

    const browser = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsVerbatimArguments: process.platform === "win32", // Critical for Windows "start"
    });

    browser.on("error", () => {
      resolve(false);
    });

    // We don't wait for the browser process to exit as it's detached
    // If it started successfully, we assume it's open
    setTimeout(() => resolve(true), 500);
    browser.unref();
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * OAuth authorization URL oluştur ve tarayıcıda aç.
 *
 * @param projectId - Opsiyonel Google Cloud project ID
 * @returns Authorization bilgileri ve tarayıcının açılıp açılmadığı
 */
export async function launchOAuthBrowser(
  projectId?: string,
): Promise<LaunchResult> {
  // 1. OAuth URL oluştur (PKCE ile)
  const authorization = await authorizeAntigravity(projectId);

  console.log("\n🔐 Google Antigravity OAuth Giriş Akışı");
  console.log("─".repeat(50));

  // 2. Tarayıcı aç
  const browserOpened = await openBrowser(authorization.url);

  if (browserOpened) {
    console.log("🌐 Tarayıcı açıldı — Google hesabınızla giriş yapın.");
    console.log("   Giriş sonrası otomatik olarak devam edilecek.\n");
  } else {
    // Fallback: URL'yi terminale yazdır
    console.log("⚠️  Tarayıcı otomatik açılamadı.");
    console.log("   Aşağıdaki URL'yi tarayıcınıza kopyalayın:\n");
    console.log(`   ${authorization.url}\n`);
  }

  return { authorization, browserOpened };
}

/**
 * Sadece URL oluştur (tarayıcı açmadan).
 * Headless ortamlar veya test senaryoları için.
 */
export async function generateOAuthUrl(
  projectId?: string,
): Promise<AntigravityAuthorization> {
  return authorizeAntigravity(projectId);
}
