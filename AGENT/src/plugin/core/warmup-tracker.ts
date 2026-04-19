import { createLogger } from "../logger";

const log = createLogger("warmup");

/**
 * Warmup Session Tracking
 * 
 * Prevents redundant warmup attempts for the same session ID
 * and limits memory usage by rotating old sessions.
 */

const MAX_WARMUP_SESSIONS = 1000;
const MAX_WARMUP_RETRIES = 2;

const warmupAttemptedSessionIds = new Set<string>();
const warmupSucceededSessionIds = new Set<string>();

/**
 * Track an attempt to warm up a session.
 * @returns true if warmup should proceed, false if already warmed up or max retries reached.
 */
export function trackWarmupAttempt(sessionId: string): boolean {
  if (warmupSucceededSessionIds.has(sessionId)) {
    return false;
  }

  // Cleanup old sessions if we exceed limit
  if (warmupAttemptedSessionIds.size >= MAX_WARMUP_SESSIONS) {
    const first = warmupAttemptedSessionIds.values().next().value;
    if (first) {
      warmupAttemptedSessionIds.delete(first);
      warmupSucceededSessionIds.delete(first);
    }
  }

  const attempts = getWarmupAttemptCount(sessionId);
  if (attempts >= MAX_WARMUP_RETRIES) {
    return false;
  }

  warmupAttemptedSessionIds.add(sessionId);
  return true;
}

/**
 * Get the number of warmup attempts for a session.
 */
export function getWarmupAttemptCount(sessionId: string): number {
  return warmupAttemptedSessionIds.has(sessionId) ? 1 : 0;
}

/**
 * Mark a session as successfully warmed up.
 */
export function markWarmupSuccess(sessionId: string): void {
  warmupSucceededSessionIds.add(sessionId);
  
  // Cleanup old successful sessions if we exceed limit
  if (warmupSucceededSessionIds.size >= MAX_WARMUP_SESSIONS) {
    const first = warmupSucceededSessionIds.values().next().value;
    if (first) {
      warmupSucceededSessionIds.delete(first);
    }
  }
}

/**
 * Clear warmup attempts for a session (e.g. on error to allow retry).
 */
export function clearWarmupAttempt(sessionId: string): void {
  warmupAttemptedSessionIds.delete(sessionId);
}
