import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HealthScoreTracker,
  TokenBucketTracker,
  addJitter,
  randomDelay,
  sortByLruWithHealth,
  selectHybridAccount,
  type AccountWithMetrics,
} from "./rotation";

describe("HealthScoreTracker", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("returns initial score for unknown account", () => {
      const tracker = new HealthScoreTracker();
      expect(tracker.getScore(0)).toBe(70);
    });

    it("uses custom initial score from config", () => {
      const tracker = new HealthScoreTracker({ initial: 50 });
      expect(tracker.getScore(0)).toBe(50);
    });

    it("isUsable returns true for new accounts", () => {
      const tracker = new HealthScoreTracker();
      expect(tracker.isUsable(0)).toBe(true);
    });

    it("getConsecutiveFailures returns 0 for unknown account", () => {
      const tracker = new HealthScoreTracker();
      expect(tracker.getConsecutiveFailures(0)).toBe(0);
    });
  });

  describe("recordSuccess", () => {
    it("increases score by success reward", () => {
      const tracker = new HealthScoreTracker({ initial: 70, successReward: 5 });
      tracker.recordSuccess(0);
      expect(tracker.getScore(0)).toBe(75);
    });

    it("caps score at maxScore", () => {
      const tracker = new HealthScoreTracker({ initial: 98, successReward: 5, maxScore: 100 });
      tracker.recordSuccess(0);
      expect(tracker.getScore(0)).toBe(100);
    });

    it("resets consecutive failures", () => {
      const tracker = new HealthScoreTracker();
      tracker.recordRateLimit(0);
      tracker.recordRateLimit(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(2);
      
      tracker.recordSuccess(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(0);
    });
  });

  describe("recordRateLimit", () => {
    it("decreases score by rate limit penalty", () => {
      const tracker = new HealthScoreTracker({ initial: 70, rateLimitPenalty: -10 });
      tracker.recordRateLimit(0);
      expect(tracker.getScore(0)).toBe(60);
    });

    it("does not go below 0", () => {
      const tracker = new HealthScoreTracker({ initial: 5, rateLimitPenalty: -10 });
      tracker.recordRateLimit(0);
      expect(tracker.getScore(0)).toBe(0);
    });

    it("increments consecutive failures", () => {
      const tracker = new HealthScoreTracker();
      tracker.recordRateLimit(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(1);
      
      tracker.recordRateLimit(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(2);
    });
  });

  describe("recordFailure", () => {
    it("decreases score by failure penalty", () => {
      const tracker = new HealthScoreTracker({ initial: 70, failurePenalty: -20 });
      tracker.recordFailure(0);
      expect(tracker.getScore(0)).toBe(50);
    });

    it("does not go below 0", () => {
      const tracker = new HealthScoreTracker({ initial: 10, failurePenalty: -20 });
      tracker.recordFailure(0);
      expect(tracker.getScore(0)).toBe(0);
    });

    it("increments consecutive failures", () => {
      const tracker = new HealthScoreTracker();
      tracker.recordFailure(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(1);
    });
  });

  describe("health score bounds (Bug #2)", () => {
    it("recordSuccess never goes below 0", () => {
      const tracker = new HealthScoreTracker({
        initial: 5,
        successReward: 1,
        maxScore: 100
      });

      tracker.recordSuccess(0);
      expect(tracker.getScore(0)).toBe(6);

      const trackerNegative = new HealthScoreTracker({
        initial: 5,
        successReward: -10,
        maxScore: 100
      });
      trackerNegative.recordSuccess(0);
      expect(trackerNegative.getScore(0)).toBeGreaterThanOrEqual(0);
    });

    it("recordSuccess maintains upper bound at maxScore", () => {
      const tracker = new HealthScoreTracker({
        initial: 98,
        successReward: 5,
        maxScore: 100
      });

      tracker.recordSuccess(0);
      expect(tracker.getScore(0)).toBe(100);
    });

    it("all three methods maintain [0, maxScore] bounds consistently", () => {
      const tracker = new HealthScoreTracker({
        initial: 70,
        successReward: 1,
        rateLimitPenalty: -10,
        failurePenalty: -20,
        maxScore: 100,
        minUsable: 50
      });

      tracker.recordSuccess(0);
      let score = tracker.getScore(0);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);

      tracker.recordRateLimit(0);
      score = tracker.getScore(0);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);

      tracker.recordFailure(0);
      score = tracker.getScore(0);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("recordSuccess consistency with recordRateLimit and recordFailure", () => {
      const trackerSuccess = new HealthScoreTracker({ initial: 70 });
      const trackerRateLimit = new HealthScoreTracker({ initial: 70 });
      const trackerFailure = new HealthScoreTracker({ initial: 70 });

      trackerSuccess.recordSuccess(0);
      trackerRateLimit.recordRateLimit(0);
      trackerFailure.recordFailure(0);

      const successScore = trackerSuccess.getScore(0);
      const rateLimitScore = trackerRateLimit.getScore(0);
      const failureScore = trackerFailure.getScore(0);

      expect(successScore).toBeGreaterThanOrEqual(0);
      expect(rateLimitScore).toBeGreaterThanOrEqual(0);
      expect(failureScore).toBeGreaterThanOrEqual(0);

      expect(successScore).toBeLessThanOrEqual(100);
      expect(rateLimitScore).toBeLessThanOrEqual(100);
      expect(failureScore).toBeLessThanOrEqual(100);
    });

    it("extreme penalties do not result in negative scores", () => {
      const tracker = new HealthScoreTracker({
        initial: 10,
        rateLimitPenalty: -1000,
        failurePenalty: -1000
      });

      tracker.recordRateLimit(0);
      expect(tracker.getScore(0)).toBe(0);

      tracker.recordFailure(0);
      expect(tracker.getScore(0)).toBe(0);
    });

    it("normalizes negative recovery config and keeps score in range", () => {
      let mockTime = 0;
      vi.spyOn(Date, "now").mockImplementation(() => mockTime);

      const tracker = new HealthScoreTracker({
        initial: 50,
        recoveryRatePerHour: -10,
        maxScore: 100,
      });

      expect(tracker.getScore(0)).toBe(50);

      mockTime = 2 * 60 * 60 * 1000;
      expect(tracker.getScore(0)).toBe(50);

      tracker.setScore(0, -999);
      expect(tracker.getScore(0)).toBe(0);

      tracker.setScore(0, 999);
      expect(tracker.getScore(0)).toBe(100);

      vi.restoreAllMocks();
    });
  });

  describe("isUsable", () => {
    it("returns true when score >= minUsable", () => {
      const tracker = new HealthScoreTracker({ initial: 50, minUsable: 50 });
      expect(tracker.isUsable(0)).toBe(true);
    });

    it("returns false when score < minUsable", () => {
      const tracker = new HealthScoreTracker({ initial: 49, minUsable: 50 });
      expect(tracker.isUsable(0)).toBe(false);
    });

    it("becomes unusable after multiple failures", () => {
      const tracker = new HealthScoreTracker({ initial: 70, failurePenalty: -20, minUsable: 50 });
      tracker.recordFailure(0);
      expect(tracker.isUsable(0)).toBe(true);
      
      tracker.recordFailure(0);
      expect(tracker.isUsable(0)).toBe(false);
    });
  });

  describe("time-based recovery", () => {
    it("recovers points over time", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new HealthScoreTracker({ 
        initial: 70, 
        failurePenalty: -20, 
        recoveryRatePerHour: 10 
      });
      
      tracker.recordFailure(0);
      expect(tracker.getScore(0)).toBe(50);

      mockTime = 2 * 60 * 60 * 1000;
      expect(tracker.getScore(0)).toBe(70);

      vi.restoreAllMocks();
    });

    it("caps recovery at maxScore", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new HealthScoreTracker({ 
        initial: 90, 
        successReward: 5,
        recoveryRatePerHour: 20,
        maxScore: 100 
      });
      
      tracker.recordSuccess(0);
      expect(tracker.getScore(0)).toBe(95);
      
      mockTime = 60 * 60 * 1000;
      expect(tracker.getScore(0)).toBe(100);

      vi.restoreAllMocks();
    });

    it("floors recovered points (no partial points)", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new HealthScoreTracker({ 
        initial: 70, 
        failurePenalty: -10, 
        recoveryRatePerHour: 2 
      });
      
      tracker.recordFailure(0);
      expect(tracker.getScore(0)).toBe(60);

      mockTime = 20 * 60 * 1000;
      expect(tracker.getScore(0)).toBe(60);

      mockTime = 30 * 60 * 1000;
      expect(tracker.getScore(0)).toBe(61);

      vi.restoreAllMocks();
    });
  });

  describe("reset", () => {
    it("clears health state for account", () => {
      const tracker = new HealthScoreTracker({ initial: 70 });
      tracker.recordSuccess(0);
      tracker.reset(0);
      
      expect(tracker.getScore(0)).toBe(70);
      expect(tracker.getConsecutiveFailures(0)).toBe(0);
    });
  });

  describe("getSnapshot", () => {
    it("returns current state of all tracked accounts", () => {
      const tracker = new HealthScoreTracker({ initial: 70, failurePenalty: -10 });
      tracker.recordSuccess(0);
      tracker.recordFailure(1);
      tracker.recordFailure(1);
      
      const snapshot = tracker.getSnapshot();
      expect(snapshot.get(0)?.score).toBe(71);
      expect(snapshot.get(0)?.consecutiveFailures).toBe(0);
      expect(snapshot.get(1)?.score).toBe(50);
      expect(snapshot.get(1)?.consecutiveFailures).toBe(2);
    });
  });
});

describe("TokenBucketTracker", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("returns initial tokens for unknown account", () => {
      const tracker = new TokenBucketTracker();
      expect(tracker.getTokens(0)).toBe(50);
    });

    it("uses custom initial tokens from config", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 30 });
      expect(tracker.getTokens(0)).toBe(30);
    });

    it("hasTokens returns true for new accounts", () => {
      const tracker = new TokenBucketTracker();
      expect(tracker.hasTokens(0)).toBe(true);
    });

    it("getMaxTokens returns configured max tokens", () => {
      const tracker = new TokenBucketTracker({ maxTokens: 100 });
      expect(tracker.getMaxTokens()).toBe(100);
    });

    it("getMaxTokens returns default when not configured", () => {
      const tracker = new TokenBucketTracker();
      expect(tracker.getMaxTokens()).toBe(50);
    });
  });

  describe("consume", () => {
    it("reduces token balance", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 50 });
      expect(tracker.consume(0, 1)).toBe(true);
      // Use toBeCloseTo to handle floating point from micro-regeneration between calls
      expect(tracker.getTokens(0)).toBeCloseTo(49, 2);
    });

    it("returns false when insufficient tokens", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 5 });
      expect(tracker.consume(0, 10)).toBe(false);
      expect(tracker.getTokens(0)).toBe(5);
    });

    it("allows consuming exact remaining tokens", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 10 });
      expect(tracker.consume(0, 10)).toBe(true);
      // Use toBeCloseTo to handle floating point from micro-regeneration between calls
      expect(tracker.getTokens(0)).toBeCloseTo(0, 2);
    });

    it("handles multiple consumes", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 50 });
      tracker.consume(0, 10);
      tracker.consume(0, 10);
      tracker.consume(0, 10);
      expect(tracker.getTokens(0)).toBe(20);
    });
  });

  describe("hasTokens", () => {
    it("returns true when enough tokens", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 50 });
      expect(tracker.hasTokens(0, 50)).toBe(true);
    });

    it("returns false when insufficient tokens", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 10 });
      expect(tracker.hasTokens(0, 11)).toBe(false);
    });

    it("defaults to cost of 1", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 1 });
      expect(tracker.hasTokens(0)).toBe(true);
      
      tracker.consume(0, 1);
      expect(tracker.hasTokens(0)).toBe(false);
    });
  });

  describe("refund", () => {
    it("adds tokens back", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 50 });
      tracker.consume(0, 10);
      expect(tracker.getTokens(0)).toBeCloseTo(40, 2);
      
      tracker.refund(0, 5);
      expect(tracker.getTokens(0)).toBeCloseTo(45, 2);
    });

    it("caps at maxTokens", () => {
      const tracker = new TokenBucketTracker({ initialTokens: 50, maxTokens: 50 });
      tracker.refund(0, 10);
      expect(tracker.getTokens(0)).toBe(50);
    });
  });

  describe("token regeneration", () => {
    it("regenerates tokens over time", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({ 
        initialTokens: 50, 
        maxTokens: 50,
        regenerationRatePerMinute: 6 
      });
      
      tracker.consume(0, 30);
      expect(tracker.getTokens(0)).toBe(20);

      mockTime = 5 * 60 * 1000;
      expect(tracker.getTokens(0)).toBe(50);

      vi.restoreAllMocks();
    });

    it("caps regeneration at maxTokens", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({ 
        initialTokens: 40, 
        maxTokens: 50,
        regenerationRatePerMinute: 6 
      });
      
      tracker.consume(0, 1);
      
      mockTime = 10 * 60 * 1000;
      expect(tracker.getTokens(0)).toBe(50);

      vi.restoreAllMocks();
    });
  });

  describe("integer token enforcement (Bug #1)", () => {
    it("preserves fractional regeneration remainder across operations", () => {
      let mockTime = 0;
      vi.spyOn(Date, "now").mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({
        initialTokens: 0,
        maxTokens: 10,
        regenerationRatePerMinute: 1,
      });

      expect(tracker.getTokens(0)).toBe(0);

      mockTime = 90_000;
      expect(tracker.getTokens(0)).toBe(1);
      expect(tracker.consume(0, 1)).toBe(true);
      expect(tracker.getTokens(0)).toBe(0);

      mockTime = 120_000;
      expect(tracker.getTokens(0)).toBe(1);

      vi.restoreAllMocks();
    });

    it("should return integer tokens (not fractional) from getTokens", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({
        initialTokens: 50,
        regenerationRatePerMinute: 6,
        maxTokens: 50
      });

      tracker.consume(0, 1);  // Consume 1 token â†’ 49
      expect(tracker.getTokens(0)).toBe(49);

      // Advance time by 1.5 minutes (90000 ms)
      mockTime = 90000;

      const tokens = tracker.getTokens(0);

      // Should always be integer
      expect(Number.isInteger(tokens)).toBe(true);
      // Should be 49 + floor(1.5 * 6) = 49 + 9 = 58, capped at 50
      expect(tokens).toBe(50);

      vi.restoreAllMocks();
    });

    it("should never expose fractional tokens after consume", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({
        initialTokens: 50,
        regenerationRatePerMinute: 6,
        maxTokens: 50
      });

      // Multiple operations to test integer consistency
      for (let i = 0; i < 10; i++) {
        const tokens = tracker.getTokens(0);
        expect(Number.isInteger(tokens)).toBe(true);

        if (tokens > 0) {
          tracker.consume(0, 1);
          const afterConsume = tracker.getTokens(0);
          expect(Number.isInteger(afterConsume)).toBe(true);
        }

        mockTime += 15000;  // 15 seconds between operations
      }

      vi.restoreAllMocks();
    });

    it("should never expose fractional tokens after refund", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({
        initialTokens: 50,
        regenerationRatePerMinute: 6,
        maxTokens: 50
      });

      tracker.consume(0, 30);
      expect(tracker.getTokens(0)).toBe(20);

      mockTime += 90000;  // 1.5 minutes later
      tracker.refund(0, 5);

      const tokens = tracker.getTokens(0);
      expect(Number.isInteger(tokens)).toBe(true);

      vi.restoreAllMocks();
    });

    it("should maintain integer tokens across full lifecycle", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({
        initialTokens: 50,
        regenerationRatePerMinute: 6,
        maxTokens: 50
      });

      // Lifecycle: consume â†’ wait â†’ refund â†’ wait
      tracker.consume(0, 25);
      expect(Number.isInteger(tracker.getTokens(0))).toBe(true);

      mockTime += 78000;  // 1.3 minutes
      expect(Number.isInteger(tracker.getTokens(0))).toBe(true);

      tracker.refund(0, 3);
      expect(Number.isInteger(tracker.getTokens(0))).toBe(true);

      mockTime += 45000;  // 45 more seconds (1.75 minutes total)
      expect(Number.isInteger(tracker.getTokens(0))).toBe(true);

      tracker.consume(0, 10);
      expect(Number.isInteger(tracker.getTokens(0))).toBe(true);

      vi.restoreAllMocks();
    });

    it("hybrid scoring produces consistent results with integer tokens", () => {
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const tracker = new TokenBucketTracker({
        initialTokens: 50,
        regenerationRatePerMinute: 6,
        maxTokens: 50
      });

      // Get the same tokens multiple times in quick succession
      const ratios: number[] = [];
      for (let i = 0; i < 5; i++) {
        const tokens = tracker.getTokens(0);
        expect(Number.isInteger(tokens)).toBe(true);
        const ratio = tokens / tracker.getMaxTokens();
        ratios.push(ratio);
      }

      // All ratios should be identical (same token count = same ratio)
      for (let i = 1; i < ratios.length; i++) {
        expect(ratios[i]).toBe(ratios[0]);
      }

      vi.restoreAllMocks();
    });
  });
});

describe("addJitter", () => {
  it("returns value within jitter range", () => {
    const base = 1000;
    const jitterFactor = 0.3;
    
    for (let i = 0; i < 100; i++) {
      const result = addJitter(base, jitterFactor);
      expect(result).toBeGreaterThanOrEqual(base * (1 - jitterFactor));
      expect(result).toBeLessThanOrEqual(base * (1 + jitterFactor));
    }
  });

  it("uses default jitter factor of 0.3", () => {
    const base = 1000;
    
    for (let i = 0; i < 100; i++) {
      const result = addJitter(base);
      expect(result).toBeGreaterThanOrEqual(700);
      expect(result).toBeLessThanOrEqual(1300);
    }
  });

  it("never returns negative values", () => {
    for (let i = 0; i < 100; i++) {
      const result = addJitter(10, 0.9);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns rounded values", () => {
    for (let i = 0; i < 100; i++) {
      const result = addJitter(1000);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});

describe("randomDelay", () => {
  it("returns value within min-max range", () => {
    for (let i = 0; i < 100; i++) {
      const result = randomDelay(100, 500);
      expect(result).toBeGreaterThanOrEqual(100);
      expect(result).toBeLessThanOrEqual(500);
    }
  });

  it("returns rounded values", () => {
    for (let i = 0; i < 100; i++) {
      const result = randomDelay(100, 500);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it("handles min === max", () => {
    const result = randomDelay(100, 100);
    expect(result).toBe(100);
  });
});

describe("sortByLruWithHealth", () => {
  it("filters out rate-limited accounts", () => {
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 70, isRateLimited: true, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = sortByLruWithHealth(accounts);
    expect(result).toHaveLength(1);
    expect(result[0]?.index).toBe(1);
  });

  it("filters out cooling down accounts", () => {
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: true, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = sortByLruWithHealth(accounts);
    expect(result).toHaveLength(1);
    expect(result[0]?.index).toBe(1);
  });

  it("filters out unhealthy accounts", () => {
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 40, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = sortByLruWithHealth(accounts, 50);
    expect(result).toHaveLength(1);
    expect(result[0]?.index).toBe(1);
  });

  it("sorts by lastUsed ascending (oldest first)", () => {
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 1000, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 500, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 2, lastUsed: 2000, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = sortByLruWithHealth(accounts);
    expect(result.map(a => a.index)).toEqual([1, 0, 2]);
  });

  it("uses health score as tiebreaker", () => {
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 1000, healthScore: 60, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 1000, healthScore: 80, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 2, lastUsed: 1000, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = sortByLruWithHealth(accounts);
    expect(result.map(a => a.index)).toEqual([1, 2, 0]);
  });

  it("returns empty array when all accounts filtered out", () => {
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 30, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 70, isRateLimited: true, isCoolingDown: false, addedAt: 0 },
    ];

    const result = sortByLruWithHealth(accounts, 50);
    expect(result).toHaveLength(0);
  });
});

describe("selectHybridAccount", () => {
  it("returns null when no accounts available", () => {
    const tokenTracker = new TokenBucketTracker();
    const result = selectHybridAccount([], tokenTracker);
    expect(result).toBeNull();
  });

  it("returns null when all accounts filtered out by health", () => {
    const tokenTracker = new TokenBucketTracker();
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 30, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = selectHybridAccount(accounts, tokenTracker, 50);
    expect(result).toBeNull();
  });

  it("returns the best candidate by score", () => {
    const tokenTracker = new TokenBucketTracker();
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 1000, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 500, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 2, lastUsed: 2000, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = selectHybridAccount(accounts, tokenTracker);
    expect([0, 1, 2]).toContain(result);
  });

  it("filters out rate-limited accounts", () => {
    const tokenTracker = new TokenBucketTracker();
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 70, isRateLimited: true, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = selectHybridAccount(accounts, tokenTracker);
    expect(result).toBe(1);
  });

  it("filters out accounts without tokens", () => {
    const tokenTracker = new TokenBucketTracker({ initialTokens: 1 });
    tokenTracker.consume(0, 1);
    
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = selectHybridAccount(accounts, tokenTracker);
    expect(result).toBe(1);
  });

  it("filters out unhealthy accounts", () => {
    const tokenTracker = new TokenBucketTracker();
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 40, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = selectHybridAccount(accounts, tokenTracker, 50);
    expect(result).toBe(1);
  });

  it("returns null when all accounts have no tokens", () => {
    const tokenTracker = new TokenBucketTracker({ initialTokens: 0 });
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = selectHybridAccount(accounts, tokenTracker);
    expect(result).toBeNull();
  });

  it("selects only available candidate when one account is filtered", () => {
    const tokenTracker = new TokenBucketTracker({ initialTokens: 50 });
    
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 0, healthScore: 40, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 0, healthScore: 100, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    const result = selectHybridAccount(accounts, tokenTracker, 50);
    expect(result).toBe(1);
  });

  it("returns a valid account index", () => {
    const tokenTracker = new TokenBucketTracker();
    const accounts: AccountWithMetrics[] = [
      { index: 0, lastUsed: 1000, healthScore: 70, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 1, lastUsed: 500, healthScore: 80, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
      { index: 2, lastUsed: 2000, healthScore: 60, isRateLimited: false, isCoolingDown: false, addedAt: 0 },
    ];

    for (let i = 0; i < 10; i++) {
      const result = selectHybridAccount(accounts, tokenTracker);
      expect([0, 1, 2]).toContain(result);
    }
  });
});
