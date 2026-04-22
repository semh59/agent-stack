import { type HeaderStyle } from "../constants";
import { type AlloyGatewayConfig } from "../plugin/config";
import { type ModelFamily } from "../plugin/accounts";

export interface RateLimitBodyInfo {
  retryDelayMs: number | null;
  message?: string;
  quotaResetTime?: string;
  reason?: string;
}

export const log = {
  debug: (...args: unknown[]) => console.debug('[Alloy:Debug]', ...args),
  info: (...args: unknown[]) => console.info('[Alloy:Info]', ...args),
  warn: (...args: unknown[]) => console.warn('[Alloy:Warn]', ...args),
  error: (...args: unknown[]) => console.error('[Alloy:Error]', ...args),
};

export function retryAfterMsFromResponse(response: Response, defaultRetryMs: number = 60_000): number {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return defaultRetryMs;
  if (/^\d+$/.test(retryAfter)) return parseInt(retryAfter, 10) * 1000;
  const retryDate = Date.parse(retryAfter);
  if (!isNaN(retryDate)) return Math.max(0, retryDate - Date.now());
  return defaultRetryMs;
}

function parseDurationToMs(duration: string): number | null {
  const match = duration.match(/^([\d.]+)([hms])?$/);
  if (!match) return null;
  const val = parseFloat(match[1]!);
  const unit = match[2];
  if (unit === 'h') return val * 3600000;
  if (unit === 'm') return val * 60000;
  if (unit === 's') return val * 1000;
  return val * 1000;
}

export async function extractRetryInfoFromBody(response: Response): Promise<RateLimitBodyInfo> {
  try {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      return { retryDelayMs: null };
    }

    if (!body || typeof body !== "object") return { retryDelayMs: null };
    const bodyObj = body as Record<string, unknown>;

    const error = typeof bodyObj.error === "object" && bodyObj.error !== null
      ? bodyObj.error as Record<string, unknown>
      : null;
    const rawMessage = error?.message ?? bodyObj.message;
    const message = typeof rawMessage === "string" ? rawMessage : undefined;
    const details = error?.details;
    let reason = typeof (error?.reason ?? bodyObj.reason) === "string"
      ? String(error?.reason ?? bodyObj.reason)
      : undefined;

    if (Array.isArray(details)) {
      for (const detail of details) {
        if (!detail || typeof detail !== "object") continue;
        const d = detail as Record<string, unknown>;
        const type = d["@type"];
        if (typeof type === "string" && type.includes("google.rpc.ErrorInfo") && typeof d.reason === "string") {
          reason = d.reason;
          break;
        }
      }
      for (const detail of details) {
        if (!detail || typeof detail !== "object") continue;
        const d = detail as Record<string, unknown>;
        const type = d["@type"];
        if (typeof type === "string" && type.includes("google.rpc.RetryInfo") && typeof d.retryDelay === "string") {
          const retryDelayMs = parseDurationToMs(d.retryDelay);
          if (retryDelayMs !== null) return { retryDelayMs, message, reason };
        }
      }
      for (const detail of details) {
        if (!detail || typeof detail !== "object") continue;
        const d = detail as Record<string, unknown>;
        if (d.metadata && typeof d.metadata === "object") {
          const meta = d.metadata as Record<string, unknown>;
          const quotaResetDelay = meta.quotaResetDelay;
          const quotaResetTime = typeof meta.quotaResetTimeStamp === "string" ? meta.quotaResetTimeStamp : undefined;
          if (typeof quotaResetDelay === "string") {
            const retryDelayMs = parseDurationToMs(quotaResetDelay);
            if (retryDelayMs !== null) return { retryDelayMs, message, quotaResetTime, reason };
          }
        }
      }
    }

    if (message) {
      const afterMatch = message.match(/retry after\s+([0-9hms.]+)/i) || message.match(/reset after\s+([0-9hms.]+)/i);
      if (afterMatch && afterMatch[1]) {
        const parsed = parseDurationToMs(afterMatch[1]);
        if (parsed !== null) return { retryDelayMs: parsed, message, reason };
      }
    }

    const retryAfterMs = bodyObj.retry_after_ms ?? bodyObj.retryAfterMs;
    const retryAfterSec = bodyObj.retry_after;
    const retryDelayMs = typeof retryAfterMs === "number" ? retryAfterMs
      : typeof retryAfterSec === "number" ? retryAfterSec * 1000
      : null;
    const quotaResetTime = typeof bodyObj.quota_reset_time === "string"
      ? bodyObj.quota_reset_time
      : typeof bodyObj.quotaResetTime === "string"
      ? bodyObj.quotaResetTime
      : undefined;

    return { retryDelayMs, message, quotaResetTime, reason };
  } catch {
    return { retryDelayMs: null };
  }
}

export function toUrlString(value: RequestInfo | URL): string {
  if (value instanceof URL) return value.toString();
  if (typeof value === "string") return value;
  return (value as Request).url;
}

export function toWarmupStreamUrl(value: RequestInfo | URL): string {
  const url = new URL(toUrlString(value));
  url.searchParams.set("warmup", "true");
  url.searchParams.set("stream", "true");
  return url.toString();
}

export function extractModelFromUrl(urlString: string): string | null {
  const match = urlString.match(/\/models\/([^/?#:]+)/);
  return match ? (match[1] ?? null) : null;
}

export function extractModelFromUrlWithSuffix(urlString: string): string | null {
  const match = urlString.match(/\/models\/([^?#]+)/);
  return match ? (match[1] ?? null) : null;
}

export function getModelFamilyFromUrl(urlString: string): ModelFamily {
  const model = extractModelFromUrl(urlString) || "";
  if (model.includes("titan")) return "titan" as ModelFamily;
  if (model.includes("gemini")) return "gemini";
  if (model.includes("claude")) return "claude";
  return "gemini"; // fallback
}

export function getHeaderStyleFromUrl(urlString: string, family: ModelFamily): HeaderStyle {
  if (urlString.includes("header-style=compact")) return "compact" as HeaderStyle;
  if (urlString.includes("header-style=expanded")) return "expanded" as HeaderStyle;
  return family === "claude" ? "expanded" as HeaderStyle : "compact" as HeaderStyle;
}

export function isExplicitQuotaFromUrl(urlString: string): boolean {
  return urlString.includes("quota=explicit");
}

export function headerStyleToQuotaKey(headerStyle: HeaderStyle, family: ModelFamily): string {
  return `${family}:${headerStyle}`;
}

export function getCliFirst(config: AlloyGatewayConfig): boolean {
  // Use unknown cast to access potentially missing keys in simplified config objects
  return !!((config as Record<string, unknown>).alloy as Record<string, unknown> | undefined)?.cliFirst;
}

export function resolveQuotaFallbackHeaderStyle(input: {
  quotaFallback: boolean;
  cliFirst: boolean;
  explicitQuota: boolean;
  family: ModelFamily;
  headerStyle: HeaderStyle;
  alternateStyle: HeaderStyle | null;
}): HeaderStyle | null {
  if (!input.quotaFallback) return null;
  if (input.explicitQuota) return null;
  return input.alternateStyle;
}

export function cleanupToastCooldowns(cooldowns: Map<string, number>): void {
  const now = Date.now();
  for (const [key, timestamp] of cooldowns.entries()) {
    if (now > timestamp) cooldowns.delete(key);
  }
}

export function shouldShowRateLimitToast(message: string, cooldowns: Map<string, number>): boolean {
  const now = Date.now();
  const lastShown = cooldowns.get(message) || 0;
  if (now - lastShown < 5000) return false;
  cooldowns.set(message, now);
  return true;
}

export function normalizeTouchedFiles(files: string[]): string[] {
  return [...new Set(files.map(f => f.trim()).filter(f => f.length > 0))];
}
