/**
 * Backoff and Duration Utilities
 */

export const CAPACITY_BACKOFF_TIERS_MS = [5000, 10000, 20000, 30000, 60000];

/**
 * Get the next capacity backoff delay based on consecutive failures.
 */
export function getCapacityBackoffDelay(consecutiveFailures: number): number {
  const index = Math.min(consecutiveFailures, CAPACITY_BACKOFF_TIERS_MS.length - 1);
  return CAPACITY_BACKOFF_TIERS_MS[Math.max(0, index)] ?? 5000;
}

/**
 * Extract retry delay from response headers.
 */
export function retryAfterMsFromResponse(response: Response, defaultRetryMs: number = 60_000): number {
  const retryAfterMsHeader = response.headers.get("retry-after-ms");
  if (retryAfterMsHeader) {
    const parsed = Number.parseInt(retryAfterMsHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const parsed = Number.parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed * 1000;
    }
  }

  return defaultRetryMs;
}

/**
 * Parse Go-style duration strings to milliseconds.
 * Supports compound durations: "1h16m0.667s", "1.5s", "200ms", "5m30s"
 * 
 * @param duration - Duration string in Go format
 * @returns Duration in milliseconds, or null if parsing fails
 */
export function parseDurationToMs(duration: string): number | null {
  // Handle simple formats first for backwards compatibility
  const simpleMatch = duration.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (simpleMatch) {
    const value = parseFloat(simpleMatch[1]!);
    const unit = (simpleMatch[2] || "s").toLowerCase();
    switch (unit) {
      case "h": return value * 3600 * 1000;
      case "m": return value * 60 * 1000;
      case "s": return value * 1000;
      case "ms": return value;
      default: return value * 1000;
    }
  }
  
  // Parse compound Go-style durations: "1h16m0.667s", "5m30s", etc.
  const compoundRegex = /(\d+(?:\.\d+)?)(h|m(?!s)|s|ms)/gi;
  let totalMs = 0;
  let matchFound = false;
  let match;
  
  while ((match = compoundRegex.exec(duration)) !== null) {
    matchFound = true;
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();
    switch (unit) {
      case "h": totalMs += value * 3600 * 1000; break;
      case "m": totalMs += value * 60 * 1000; break;
      case "s": totalMs += value * 1000; break;
      case "ms": totalMs += value; break;
    }
  }
  
  return matchFound ? totalMs : null;
}
