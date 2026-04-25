import type { PluginClient } from "../types";
import type { AlloyGatewayConfig } from "../config";
import { createLogger } from "../logger";

const log = createLogger("toast");

/**
 * Toast Management Utility
 * 
 * Handles debouncing, scoping (root vs child session), and filtering
 * of TUI toasts to prevent spam.
 */

const rateLimitToastCooldowns = new Map<string, number>();
const RATE_LIMIT_TOAST_COOLDOWN_MS = 5000;
const MAX_TOAST_COOLDOWN_ENTRIES = 100;

let softQuotaToastShown = false;
let rateLimitToastShown = false;

const toastDebounceMap = new Map<string, number>();
const TOAST_DEBOUNCE_MS = 3000;

function cleanupToastCooldowns(): void {
  if (rateLimitToastCooldowns.size > MAX_TOAST_COOLDOWN_ENTRIES) {
    const now = Date.now();
    for (const [key, time] of rateLimitToastCooldowns) {
      if (now - time > RATE_LIMIT_TOAST_COOLDOWN_MS * 2) {
        rateLimitToastCooldowns.delete(key);
      }
    }
  }
}

export function shouldShowRateLimitToast(message: string): boolean {
  cleanupToastCooldowns();
  const toastKey = message.replace(/\d+/g, "X");
  const lastShown = rateLimitToastCooldowns.get(toastKey) ?? 0;
  const now = Date.now();
  if (now - lastShown < RATE_LIMIT_TOAST_COOLDOWN_MS) {
    return false;
  }
  rateLimitToastCooldowns.set(toastKey, now);
  return true;
}

export function resetAllAccountsBlockedToasts(): void {
  softQuotaToastShown = false;
  rateLimitToastShown = false;
}

export function isSoftQuotaToastShown(): boolean { return softQuotaToastShown; }
export function setSoftQuotaToastShown(val: boolean): void { softQuotaToastShown = val; }
export function isRateLimitToastShown(): boolean { return rateLimitToastShown; }
export function setRateLimitToastShown(val: boolean): void { rateLimitToastShown = val; }

/**
 * Global toast helper that respects configuration and session scope.
 */
export async function showToast(
  client: PluginClient,
  config: AlloyGatewayConfig,
  message: string,
  variant: "info" | "warning" | "success" | "error",
  isChildSession: boolean = false,
  childSessionParentID?: string
): Promise<void> {
  // Always log to debug regardless of toast filtering
  log.debug("toast", { message, variant, isChildSession, toastScope: config.toast_scope });
  
  if (config.quiet_mode) return;
  
  // Elite Toast Debouncing: prevent same message spam
  const now = Date.now();
  const lastToast = toastDebounceMap.get(message);
  if (lastToast && (now - lastToast < TOAST_DEBOUNCE_MS)) {
    return;
  }
  toastDebounceMap.set(message, now);

  // Filter toasts for child sessions when toast_scope is "root_only"
  if (config.toast_scope === "root_only" && isChildSession) {
    log.debug("toast-suppressed-child-session", { message, variant, parentID: childSessionParentID });
    return;
  }
  
  if (variant === "warning" && message.toLowerCase().includes("rate")) {
    if (!shouldShowRateLimitToast(message)) {
      return;
    }
  }
  
  try {
    await client.tui.showToast({
      body: { message, variant },
    });
  } catch {
    // TUI may not be available
  }
}
