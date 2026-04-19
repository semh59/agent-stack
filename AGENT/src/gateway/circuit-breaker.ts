/**
 * Provider-Aware Circuit Breaker
 *
 * Protects the system from cascading failures when a provider is down.
 * Each provider gets its own breaker with independent state.
 *
 * States:
 *   CLOSED  → Normal operation, requests pass through
 *   OPEN    → Provider is failing, requests are rejected immediately
 *   HALF    → Testing recovery, allows a single probe request
 *
 * When a breaker opens, the ModelRouter automatically falls to the other provider.
 * This enables true dual-provider resilience.
 */

import { AIProvider } from "./provider-types";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerConfig {
  /** Number of consecutive failures before opening (default: 5) */
  failureThreshold: number;
  /** Time in ms to wait before half-open probe (default: 30s) */
  recoveryTimeoutMs: number;
  /** Success count in half-open to close the breaker (default: 2) */
  halfOpenSuccessThreshold: number;
  /** Maximum recorded latency entries for stats (default: 100) */
  maxLatencyHistory: number;
}

export interface BreakerStats {
  state: BreakerState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  avgLatencyMs: number;
  errorRate: number;
  openedAt: number | null;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 2,
  maxLatencyHistory: 100,
};

// ─── Single Circuit Breaker ─────────────────────────────────────────────────

class CircuitBreaker {
  private state: BreakerState = "closed";
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private openedAt: number | null = null;
  private latencyHistory: number[] = [];
  private readonly config: BreakerConfig;

  constructor(config: Partial<BreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if the breaker allows requests */
  canExecute(): boolean {
    switch (this.state) {
      case "closed":
        return true;

      case "open": {
        const elapsed = Date.now() - (this.openedAt ?? 0);
        if (elapsed >= this.config.recoveryTimeoutMs) {
          this.state = "half_open";
          this.halfOpenSuccesses = 0;
          return true; // Allow probe request
        }
        return false;
      }

      case "half_open":
        return true; // Allow probe requests

      default:
        return true;
    }
  }

  /** Record a successful request */
  recordSuccess(latencyMs: number): void {
    this.consecutiveFailures = 0;
    this.totalSuccesses++;
    this.lastSuccessAt = Date.now();
    this.recordLatency(latencyMs);

    if (this.state === "half_open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.state = "closed";
        this.openedAt = null;
      }
    }
  }

  /** Record a failed request */
  recordFailure(latencyMs?: number): void {
    this.consecutiveFailures++;
    this.totalFailures++;
    this.lastFailureAt = Date.now();
    if (latencyMs !== undefined) this.recordLatency(latencyMs);

    if (this.state === "half_open") {
      // Probe failed — back to open
      this.state = "open";
      this.openedAt = Date.now();
      return;
    }

    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  /** Force the breaker to a specific state */
  forceState(state: BreakerState): void {
    this.state = state;
    if (state === "closed") {
      this.consecutiveFailures = 0;
      this.halfOpenSuccesses = 0;
      this.openedAt = null;
    } else if (state === "open") {
      this.openedAt = Date.now();
    }
  }

  /** Reset all counters */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.halfOpenSuccesses = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.lastFailureAt = null;
    this.lastSuccessAt = null;
    this.openedAt = null;
    this.latencyHistory = [];
  }

  /** Get current stats */
  getStats(): BreakerStats {
    const total = this.totalSuccesses + this.totalFailures;
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      avgLatencyMs: this.latencyHistory.length > 0
        ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length
        : 0,
      errorRate: total > 0 ? this.totalFailures / total : 0,
      openedAt: this.openedAt,
      p50LatencyMs: this.getPercentile(50),
      p95LatencyMs: this.getPercentile(95),
      p99LatencyMs: this.getPercentile(99),
    };
  }

  private recordLatency(ms: number): void {
    this.latencyHistory.push(ms);
    if (this.latencyHistory.length > this.config.maxLatencyHistory) {
      this.latencyHistory.shift();
    }
  }

  private getPercentile(p: number): number {
    if (this.latencyHistory.length === 0) return 0;
    const sorted = [...this.latencyHistory].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }
}

// ─── Provider Circuit Breaker Manager ───────────────────────────────────────

export class ProviderCircuitBreaker {
  private breakers = new Map<AIProvider, CircuitBreaker>();
  private readonly config: Partial<BreakerConfig>;

  constructor(config: Partial<BreakerConfig> = {}) {
    this.config = config;
  }

  private getBreaker(provider: AIProvider): CircuitBreaker {
    let breaker = this.breakers.get(provider);
    if (!breaker) {
      breaker = new CircuitBreaker(this.config);
      this.breakers.set(provider, breaker);
    }
    return breaker;
  }

  /** Check if a provider is available */
  isAvailable(provider: AIProvider): boolean {
    return this.getBreaker(provider).canExecute();
  }

  /** Get available providers from a list */
  filterAvailable(providers: AIProvider[]): AIProvider[] {
    return providers.filter((p) => this.isAvailable(p));
  }

  /** Record a successful request to a provider */
  recordSuccess(provider: AIProvider, latencyMs: number): void {
    this.getBreaker(provider).recordSuccess(latencyMs);
  }

  /** Record a failed request to a provider */
  recordFailure(provider: AIProvider, latencyMs?: number): void {
    this.getBreaker(provider).recordFailure(latencyMs);
  }

  /**
   * Execute a function with circuit breaker protection.
   * Automatically records success/failure and routes to fallback.
   */
  async execute<T>(
    provider: AIProvider,
    fn: () => Promise<T>,
    fallbackProvider?: AIProvider,
    fallbackFn?: () => Promise<T>,
  ): Promise<T> {
    const breaker = this.getBreaker(provider);

    if (!breaker.canExecute()) {
      if (fallbackProvider && fallbackFn && this.isAvailable(fallbackProvider)) {
        return this.execute(fallbackProvider, fallbackFn);
      }
      throw new Error(
        `Provider ${provider} circuit breaker is OPEN. No fallback available.`,
      );
    }

    const start = Date.now();
    try {
      const result = await fn();
      breaker.recordSuccess(Date.now() - start);
      return result;
    } catch (error) {
      breaker.recordFailure(Date.now() - start);

      // Try fallback
      if (fallbackProvider && fallbackFn && this.isAvailable(fallbackProvider)) {
        return this.execute(fallbackProvider, fallbackFn);
      }

      throw error;
    }
  }

  /** Get stats for all providers */
  getAllStats(): Map<AIProvider, BreakerStats> {
    const stats = new Map<AIProvider, BreakerStats>();
    for (const [provider, breaker] of this.breakers) {
      stats.set(provider, breaker.getStats());
    }
    return stats;
  }

  /** Get stats for a specific provider */
  getStats(provider: AIProvider): BreakerStats {
    return this.getBreaker(provider).getStats();
  }

  /** Force reset a provider's breaker */
  resetProvider(provider: AIProvider): void {
    this.getBreaker(provider).reset();
  }

  /** Reset all breakers */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}
