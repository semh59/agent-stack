"use strict";
/**
 * Provider-Aware Circuit Breaker
 *
 * Protects the system from cascading failures when a provider is down.
 * Each provider gets its own breaker with independent state.
 *
 * States:
 *   CLOSED  â†’ Normal operation, requests pass through
 *   OPEN    â†’ Provider is failing, requests are rejected immediately
 *   HALF    â†’ Testing recovery, allows a single probe request
 *
 * When a breaker opens, the ModelRouter automatically falls to the other provider.
 * This enables true dual-provider resilience.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderCircuitBreaker = void 0;
// â”€â”€â”€ Default Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEFAULT_CONFIG = {
    failureThreshold: 5,
    recoveryTimeoutMs: 30_000,
    halfOpenSuccessThreshold: 2,
    maxLatencyHistory: 100,
};
// â”€â”€â”€ Single Circuit Breaker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class CircuitBreaker {
    state = "closed";
    consecutiveFailures = 0;
    halfOpenSuccesses = 0;
    totalFailures = 0;
    totalSuccesses = 0;
    lastFailureAt = null;
    lastSuccessAt = null;
    openedAt = null;
    latencyHistory = [];
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** Check if the breaker allows requests */
    canExecute() {
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
    recordSuccess(latencyMs) {
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
    recordFailure(latencyMs) {
        this.consecutiveFailures++;
        this.totalFailures++;
        this.lastFailureAt = Date.now();
        if (latencyMs !== undefined)
            this.recordLatency(latencyMs);
        if (this.state === "half_open") {
            // Probe failed â€” back to open
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
    forceState(state) {
        this.state = state;
        if (state === "closed") {
            this.consecutiveFailures = 0;
            this.halfOpenSuccesses = 0;
            this.openedAt = null;
        }
        else if (state === "open") {
            this.openedAt = Date.now();
        }
    }
    /** Reset all counters */
    reset() {
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
    getStats() {
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
    recordLatency(ms) {
        this.latencyHistory.push(ms);
        if (this.latencyHistory.length > this.config.maxLatencyHistory) {
            this.latencyHistory.shift();
        }
    }
    getPercentile(p) {
        if (this.latencyHistory.length === 0)
            return 0;
        const sorted = [...this.latencyHistory].sort((a, b) => a - b);
        const idx = Math.ceil(sorted.length * p / 100) - 1;
        return sorted[Math.max(0, idx)] ?? 0;
    }
}
// â”€â”€â”€ Provider Circuit Breaker Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class ProviderCircuitBreaker {
    breakers = new Map();
    config;
    constructor(config = {}) {
        this.config = config;
    }
    getBreaker(provider) {
        let breaker = this.breakers.get(provider);
        if (!breaker) {
            breaker = new CircuitBreaker(this.config);
            this.breakers.set(provider, breaker);
        }
        return breaker;
    }
    /** Check if a provider is available */
    isAvailable(provider) {
        return this.getBreaker(provider).canExecute();
    }
    /** Get available providers from a list */
    filterAvailable(providers) {
        return providers.filter((p) => this.isAvailable(p));
    }
    /** Record a successful request to a provider */
    recordSuccess(provider, latencyMs) {
        this.getBreaker(provider).recordSuccess(latencyMs);
    }
    /** Record a failed request to a provider */
    recordFailure(provider, latencyMs) {
        this.getBreaker(provider).recordFailure(latencyMs);
    }
    /**
     * Execute a function with circuit breaker protection.
     * Automatically records success/failure and routes to fallback.
     */
    async execute(provider, fn, fallbackProvider, fallbackFn) {
        const breaker = this.getBreaker(provider);
        if (!breaker.canExecute()) {
            if (fallbackProvider && fallbackFn && this.isAvailable(fallbackProvider)) {
                return this.execute(fallbackProvider, fallbackFn);
            }
            throw new Error(`Provider ${provider} circuit breaker is OPEN. No fallback available.`);
        }
        const start = Date.now();
        try {
            const result = await fn();
            breaker.recordSuccess(Date.now() - start);
            return result;
        }
        catch (error) {
            breaker.recordFailure(Date.now() - start);
            // Try fallback
            if (fallbackProvider && fallbackFn && this.isAvailable(fallbackProvider)) {
                return this.execute(fallbackProvider, fallbackFn);
            }
            throw error;
        }
    }
    /** Get stats for all providers */
    getAllStats() {
        const stats = new Map();
        for (const [provider, breaker] of this.breakers) {
            stats.set(provider, breaker.getStats());
        }
        return stats;
    }
    /** Get stats for a specific provider */
    getStats(provider) {
        return this.getBreaker(provider).getStats();
    }
    /** Force reset a provider's breaker */
    resetProvider(provider) {
        this.getBreaker(provider).reset();
    }
    /** Reset all breakers */
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }
}
exports.ProviderCircuitBreaker = ProviderCircuitBreaker;
//# sourceMappingURL=circuit-breaker.js.map