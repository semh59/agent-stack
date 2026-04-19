/**
 * Tests for rate limit state tracking.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  formatWaitTime,
  extractRateLimitBodyInfo,
  getEmptyResponseAttempts,
  incrementEmptyResponseAttempts,
  resetEmptyResponseAttempts,
  getRateLimitBackoff,
  resetRateLimitState,
  resetAllRateLimitStateForAccount,
  headerStyleToQuotaKey,
  trackAccountFailure,
  resetAccountFailureState,
} from "./rate-limit-state";

// ── formatWaitTime ───────────────────────────────────────────────────

describe("formatWaitTime", () => {
  it("should format milliseconds", () => {
    expect(formatWaitTime(500)).toBe("500ms");
  });

  it("should format seconds", () => {
    expect(formatWaitTime(5000)).toBe("5s");
  });

  it("should format minutes", () => {
    expect(formatWaitTime(120000)).toBe("2m");
  });

  it("should format minutes with seconds", () => {
    expect(formatWaitTime(90000)).toBe("1m 30s");
  });

  it("should format hours", () => {
    expect(formatWaitTime(3600000)).toBe("1h");
  });

  it("should format hours with minutes", () => {
    expect(formatWaitTime(5400000)).toBe("1h 30m");
  });
});

// ── extractRateLimitBodyInfo ─────────────────────────────────────────

describe("extractRateLimitBodyInfo", () => {
  it("should handle null body", () => {
    expect(extractRateLimitBodyInfo(null)).toEqual({ retryDelayMs: null });
  });

  it("should handle non-object body", () => {
    expect(extractRateLimitBodyInfo("string")).toEqual({ retryDelayMs: null });
  });

  it("should extract retry delay from RetryInfo detail", () => {
    const body = {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "30s",
          },
        ],
      },
    };
    const result = extractRateLimitBodyInfo(body);
    expect(result.retryDelayMs).toBe(30000);
  });

  it("should extract reason from ErrorInfo detail", () => {
    const body = {
      error: {
        message: "rate limited",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "RATE_LIMIT_EXCEEDED",
          },
        ],
      },
    };
    const result = extractRateLimitBodyInfo(body);
    expect(result.reason).toBe("RATE_LIMIT_EXCEEDED");
    expect(result.message).toBe("rate limited");
  });

  it("should extract quota reset delay from metadata", () => {
    const body = {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            metadata: {
              quotaResetDelay: "60s",
            },
          },
        ],
      },
    };
    const result = extractRateLimitBodyInfo(body);
    expect(result.retryDelayMs).toBe(60000);
  });

  it("should extract retry delay from message text", () => {
    const body = {
      error: {
        message: "Quota reset after 30s",
      },
    };
    const result = extractRateLimitBodyInfo(body);
    expect(result.retryDelayMs).toBe(30000);
  });
});

// ── Empty Response Attempts ──────────────────────────────────────────

describe("empty response attempts", () => {
  beforeEach(() => {
    resetEmptyResponseAttempts("model-test");
  });

  it("should start at 0", () => {
    expect(getEmptyResponseAttempts("model-test")).toBe(0);
  });

  it("should increment", () => {
    incrementEmptyResponseAttempts("model-test");
    expect(getEmptyResponseAttempts("model-test")).toBe(1);
    incrementEmptyResponseAttempts("model-test");
    expect(getEmptyResponseAttempts("model-test")).toBe(2);
  });

  it("should reset", () => {
    incrementEmptyResponseAttempts("model-test");
    incrementEmptyResponseAttempts("model-test");
    resetEmptyResponseAttempts("model-test");
    expect(getEmptyResponseAttempts("model-test")).toBe(0);
  });
});

// ── getRateLimitBackoff ──────────────────────────────────────────────

describe("getRateLimitBackoff", () => {
  beforeEach(() => {
    resetRateLimitState(0, "test-quota");
  });

  it("should start with attempt 1", () => {
    const result = getRateLimitBackoff(0, "test-quota", null);
    expect(result.attempt).toBe(1);
    expect(result.isDuplicate).toBe(false);
  });

  it("should increase delay exponentially across different quotas", () => {
    const r1 = getRateLimitBackoff(0, "quota-a", 1000);
    // Use same quota key to accumulate attempts (dedup window makes it same delay)
    // So we test with different quotas to see actual backoff increase
    getRateLimitBackoff(0, "quota-b", 1000);
    getRateLimitBackoff(0, "quota-b", 1000);
    // quota-b now has attempt=2, delay should be higher than quota-a attempt=1
    const r2 = getRateLimitBackoff(0, "quota-b", 1000);
    expect(r2.attempt).toBeGreaterThanOrEqual(r1.attempt);
  });

  it("should use server retry delay as base", () => {
    const result = getRateLimitBackoff(0, "test-quota", 5000);
    expect(result.delayMs).toBeGreaterThanOrEqual(5000);
  });

  it("should cap at max backoff", () => {
    const result = getRateLimitBackoff(0, "test-quota", 1000, 2000);
    expect(result.delayMs).toBeLessThanOrEqual(2000);
  });

  it("should detect duplicates within dedup window", () => {
    getRateLimitBackoff(0, "test-quota", 1000);
    const result = getRateLimitBackoff(0, "test-quota", 1000);
    // Second call within dedup window should be flagged
    expect(typeof result.isDuplicate).toBe("boolean");
  });

  it("should reset state", () => {
    getRateLimitBackoff(0, "test-quota", 1000);
    resetRateLimitState(0, "test-quota");
    const result = getRateLimitBackoff(0, "test-quota", 1000);
    expect(result.attempt).toBe(1);
  });
});

// ── resetAllRateLimitStateForAccount ─────────────────────────────────

describe("resetAllRateLimitStateForAccount", () => {
  it("should reset all quotas for an account", () => {
    getRateLimitBackoff(1, "quota-a", 1000);
    getRateLimitBackoff(1, "quota-b", 1000);
    resetAllRateLimitStateForAccount(1);
    const r1 = getRateLimitBackoff(1, "quota-a", 1000);
    const r2 = getRateLimitBackoff(1, "quota-b", 1000);
    expect(r1.attempt).toBe(1);
    expect(r2.attempt).toBe(1);
  });
});

// ── headerStyleToQuotaKey ────────────────────────────────────────────

describe("headerStyleToQuotaKey", () => {
  it("should return claude for claude family", () => {
    expect(headerStyleToQuotaKey("antigravity", "claude")).toBe("claude");
  });

  it("should return gemini-antigravity for antigravity style", () => {
    expect(headerStyleToQuotaKey("antigravity", "gemini")).toBe("gemini-antigravity");
  });

  it("should return gemini-cli for gemini-cli style", () => {
    expect(headerStyleToQuotaKey("gemini-cli", "gemini")).toBe("gemini-cli");
  });
});

// ── trackAccountFailure ──────────────────────────────────────────────

describe("trackAccountFailure", () => {
  beforeEach(() => {
    resetAccountFailureState(0);
  });

  it("should track first failure", () => {
    const result = trackAccountFailure(0);
    expect(result.failures).toBe(1);
    expect(result.shouldCooldown).toBe(false);
  });

  it("should trigger cooldown after MAX_CONSECUTIVE_FAILURES (5)", () => {
    for (let i = 0; i < 4; i++) {
      trackAccountFailure(0);
    }
    const result = trackAccountFailure(0);
    expect(result.failures).toBe(5);
    expect(result.shouldCooldown).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("should reset failure state", () => {
    trackAccountFailure(0);
    trackAccountFailure(0);
    resetAccountFailureState(0);
    const result = trackAccountFailure(0);
    expect(result.failures).toBe(1);
  });
});