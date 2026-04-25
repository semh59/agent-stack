/**
 * Tests for endpoint circuit breaker.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EndpointCircuitBreaker } from "./circuit-breaker";

describe("EndpointCircuitBreaker", () => {
  let breaker: EndpointCircuitBreaker;

  beforeEach(() => {
    breaker = new EndpointCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
  });

  it("should allow requests to unknown endpoints", () => {
    expect(breaker.isUsable("https://example.com")).toBe(true);
  });

  it("should allow requests below failure threshold", () => {
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    expect(breaker.isUsable("https://example.com")).toBe(true);
  });

  it("should trip after reaching failure threshold", () => {
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    expect(breaker.isUsable("https://example.com")).toBe(false);
  });

  it("should recover after reset timeout", () => {
    vi.useFakeTimers();
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    expect(breaker.isUsable("https://example.com")).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(breaker.isUsable("https://example.com")).toBe(true);
    vi.useRealTimers();
  });

  it("should reset on success", () => {
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    breaker.recordSuccess("https://example.com");
    // Should need 3 failures again
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    expect(breaker.isUsable("https://example.com")).toBe(true);
  });

  it("should track endpoints independently", () => {
    breaker.recordFailure("https://a.com");
    breaker.recordFailure("https://a.com");
    breaker.recordFailure("https://a.com");
    expect(breaker.isUsable("https://a.com")).toBe(false);
    expect(breaker.isUsable("https://b.com")).toBe(true);
  });

  it("should report remaining wait time", () => {
    vi.useFakeTimers();
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    breaker.recordFailure("https://example.com");
    const remaining = breaker.getRemainingWaitMs("https://example.com");
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(1000);

    vi.advanceTimersByTime(500);
    const remainingAfter = breaker.getRemainingWaitMs("https://example.com");
    expect(remainingAfter).toBeLessThanOrEqual(500);
    vi.useRealTimers();
  });

  it("should return 0 remaining for non-tripped endpoints", () => {
    expect(breaker.getRemainingWaitMs("https://unknown.com")).toBe(0);
  });

  it("should use default config when none provided", () => {
    const defaultBreaker = new EndpointCircuitBreaker();
    // Should not trip with just 4 failures (default threshold is 5)
    for (let i = 0; i < 4; i++) {
      defaultBreaker.recordFailure("https://example.com");
    }
    expect(defaultBreaker.isUsable("https://example.com")).toBe(true);
    // 5th failure should trip
    defaultBreaker.recordFailure("https://example.com");
    expect(defaultBreaker.isUsable("https://example.com")).toBe(false);
  });
});
