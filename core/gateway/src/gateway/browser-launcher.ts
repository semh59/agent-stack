/**
 * Browser Launcher â€” Platform baÄŸÄ±msÄ±z tarayÄ±cÄ± aÃ§ma
 *
 * OAuth URL'yi kullanÄ±cÄ±nÄ±n varsayÄ±lan tarayÄ±cÄ±sÄ±nda aÃ§ar.
 * Windows/macOS/Linux desteÄŸi.
 * TarayÄ±cÄ± aÃ§Ä±lamÄ±yorsa URL'yi terminale yazdÄ±rarak fallback saÄŸlar.
 */

import { spawn } from "node:child_process";
import { authorizeGoogleGemini } from "../google-gemini/oauth";
import type { AlloyAuthorization } from "../google-gemini/oauth";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface LaunchResult {
  authorization: AlloyAuthorization;
  browserOpened: boolean;
}

// â”€â”€â”€ Browser Open â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * OAuth authorization URL oluÅŸtur ve tarayÄ±cÄ±da aÃ§.
 *
 * @param projectId - Opsiyonel Google Cloud project ID
 * @returns Authorization bilgileri ve tarayÄ±cÄ±nÄ±n aÃ§Ä±lÄ±p aÃ§Ä±lmadÄ±ÄŸÄ±
 */
export async function launchOAuthBrowser(
  projectId?: string,
): Promise<LaunchResult> {
  // 1. OAuth URL oluÅŸtur (PKCE ile)
  const authorization = await authorizeGoogleGemini(projectId);

  console.log("\nğŸ” Google Alloy OAuth GiriÅŸ AkÄ±ÅŸÄ±");
  console.log("â”€".repeat(50));

  // 2. TarayÄ±cÄ± aÃ§
  const browserOpened = await openBrowser(authorization.url);

  if (browserOpened) {
    console.log("ğŸŒ TarayÄ±cÄ± aÃ§Ä±ldÄ± â€” Google hesabÄ±nÄ±zla giriÅŸ yapÄ±n.");
    console.log("   GiriÅŸ sonrasÄ± otomatik olarak devam edilecek.\n");
  } else {
    // Fallback: URL'yi terminale yazdÄ±r
    console.log("âš ï¸  TarayÄ±cÄ± otomatik aÃ§Ä±lamadÄ±.");
    console.log("   AÅŸaÄŸÄ±daki URL'yi tarayÄ±cÄ±nÄ±za kopyalayÄ±n:\n");
    console.log(`   ${authorization.url}\n`);
  }

  return { authorization, browserOpened };
}

/**
 * Sadece URL oluÅŸtur (tarayÄ±cÄ± aÃ§madan).
 * Headless ortamlar veya test senaryolarÄ± iÃ§in.
 */
export async function generateOAuthUrl(
  projectId?: string,
): Promise<AlloyAuthorization> {
  return authorizeGoogleGemini(projectId);
}
