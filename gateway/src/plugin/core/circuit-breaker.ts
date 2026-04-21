/**
 * Endpoint Circuit Breaker
 * 
 * Prevents "thundering herd" and wasted requests to failing endpoints.
 * Tracks failures per endpoint and "trips" (opens) the circuit after a threshold.
 */

import { createLogger } from "../logger";

const log = createLogger("circuit-breaker");

interface EndpointState {
  failureCount: number;
  lastFailureTime: number;
  trippedUntil: number;
}

export interface CircuitBreakerConfig {
  /** Failures before tripping (default: 5) */
  failureThreshold: number;
  /** Duration to stay tripped in ms (default: 30000 = 30s) */
  resetTimeoutMs: number;
}

export class EndpointCircuitBreaker {
  private states = new Map<string, EndpointState>();
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeoutMs: config.resetTimeoutMs ?? 30000,
    };
  }

  /**
   * Checks if an endpoint is usable.
   * If tripped, returns false only if the reset timeout hasn't passed.
   */
  isUsable(endpoint: string): boolean {
    const state = this.states.get(endpoint);
    if (!state) return true;

    const now = Date.now();
    if (now < state.trippedUntil) {
      return false;
    }

    // Semi-open: if timeout passed, allow a test request
    return true;
  }

  /**
   * Records a failure for an endpoint.
   */
  recordFailure(endpoint: string): void {
    const now = Date.now();
    let state = this.states.get(endpoint);

    if (!state) {
      state = { failureCount: 1, lastFailureTime: now, trippedUntil: 0 };
    } else {
      state.failureCount++;
      state.lastFailureTime = now;
    }

    if (state.failureCount >= this.config.failureThreshold) {
      state.trippedUntil = now + this.config.resetTimeoutMs;
      log.warn(`Circuit Breaker TRIPPED for endpoint: ${endpoint}`, {
        failures: state.failureCount,
        trippedUntil: new Date(state.trippedUntil).toISOString(),
      });
    }

    this.states.set(endpoint, state);
  }

  /**
   * Records a success, resetting the failure count.
   */
  recordSuccess(endpoint: string): void {
    const state = this.states.get(endpoint);
    if (state && state.failureCount > 0) {
      log.debug(`Circuit Breaker RESET for endpoint: ${endpoint}`);
      this.states.set(endpoint, {
        failureCount: 0,
        lastFailureTime: 0,
        trippedUntil: 0,
      });
    }
  }

  /**
   * Gets the remaining wait time for a tripped endpoint in ms.
   * Returns 0 if not tripped.
   */
  getRemainingWaitMs(endpoint: string): number {
    const state = this.states.get(endpoint);
    if (!state) return 0;
    return Math.max(0, state.trippedUntil - Date.now());
  }
}
