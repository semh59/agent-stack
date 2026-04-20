/**
 * Tests for backoff and duration utilities.
 */
import { describe, it, expect } from "vitest";
import {
  CAPACITY_BACKOFF_TIERS_MS,
  getCapacityBackoffDelay,
  retryAfterMsFromResponse,
  parseDurationToMs,
} from "./backoff";

// â”€â”€ getCapacityBackoffDelay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("getCapacityBackoffDelay", () => {
  it("should return first tier for 0 failures", () => {
    expect(getCapacityBackoffDelay(0)).toBe(CAPACITY_BACKOFF_TIERS_MS[0]);
  });

  it("should return second tier for 1 failure", () => {
    expect(getCapacityBackoffDelay(1)).toBe(CAPACITY_BACKOFF_TIERS_MS[1]);
  });

  it("should return last tier for failures exceeding array length", () => {
    const lastTier = CAPACITY_BACKOFF_TIERS_MS[CAPACITY_BACKOFF_TIERS_MS.length - 1];
    expect(getCapacityBackoffDelay(100)).toBe(lastTier);
  });

  it("should return first tier for negative failures", () => {
    expect(getCapacityBackoffDelay(-1)).toBe(CAPACITY_BACKOFF_TIERS_MS[0]);
  });
});

// â”€â”€ retryAfterMsFromResponse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("retryAfterMsFromResponse", () => {
  it("should return default when no retry headers", () => {
    const response = new Response(null, { status: 429 });
    expect(retryAfterMsFromResponse(response)).toBe(60_000);
  });

  it("should parse retry-after-ms header", () => {
    const headers = new Headers({ "retry-after-ms": "5000" });
    const response = new Response(null, { status: 429, headers });
    expect(retryAfterMsFromResponse(response)).toBe(5000);
  });

  it("should parse retry-after header (seconds)", () => {
    const headers = new Headers({ "retry-after": "30" });
    const response = new Response(null, { status: 429, headers });
    expect(retryAfterMsFromResponse(response)).toBe(30_000);
  });

  it("should use custom default when no headers", () => {
    const response = new Response(null, { status: 429 });
    expect(retryAfterMsFromResponse(response, 10_000)).toBe(10_000);
  });

  it("should prefer retry-after-ms over retry-after", () => {
    const headers = new Headers({
      "retry-after-ms": "2000",
      "retry-after": "30",
    });
    const response = new Response(null, { status: 429, headers });
    expect(retryAfterMsFromResponse(response)).toBe(2000);
  });

  it("should ignore invalid retry-after-ms", () => {
    const headers = new Headers({ "retry-after-ms": "not-a-number" });
    const response = new Response(null, { status: 429, headers });
    expect(retryAfterMsFromResponse(response)).toBe(60_000);
  });
});

// â”€â”€ parseDurationToMs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("parseDurationToMs", () => {
  it("should parse milliseconds", () => {
    expect(parseDurationToMs("200ms")).toBe(200);
  });

  it("should parse seconds", () => {
    expect(parseDurationToMs("5s")).toBe(5000);
  });

  it("should parse minutes", () => {
    expect(parseDurationToMs("2m")).toBe(120_000);
  });

  it("should parse hours", () => {
    expect(parseDurationToMs("1h")).toBe(3_600_000);
  });

  it("should parse fractional seconds", () => {
    expect(parseDurationToMs("1.5s")).toBe(1500);
  });

  it("should parse compound Go durations", () => {
    expect(parseDurationToMs("1h16m0.667s")).toBe(
      1 * 3600_000 + 16 * 60_000 + 667
    );
  });

  it("should parse minutes+seconds compound", () => {
    expect(parseDurationToMs("5m30s")).toBe(330_000);
  });

  it("should return null for invalid input", () => {
    expect(parseDurationToMs("invalid")).toBeNull();
  });

  it("should default to seconds when no unit", () => {
    expect(parseDurationToMs("10")).toBe(10_000);
  });
});
