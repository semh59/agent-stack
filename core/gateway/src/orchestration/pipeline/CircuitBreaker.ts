export interface CircuitBreakerState {
  failures: number;
  lastFailureAt: number | null;
  isOpen: boolean;
  nextRetryAt: number;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  onTrip?: (provider: string, state: CircuitBreakerState) => void | Promise<void>;
}

export class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();

  constructor(private readonly options: CircuitBreakerOptions) {}

  public check(provider: string): void {
    const cb = this.states.get(provider);
    if (!cb || !cb.isOpen) return;

    if (Date.now() >= cb.nextRetryAt) {
      // Half-open: allow one attempt
      return;
    }

    throw new Error(
      `Circuit breaker is OPEN for ${provider}. Next retry at ${new Date(
        cb.nextRetryAt
      ).toISOString()}`
    );
  }

  public recordFailure(provider: string): void {
    let cb = this.states.get(provider);
    if (!cb) {
      cb = { failures: 0, lastFailureAt: null, isOpen: false, nextRetryAt: 0 };
      this.states.set(provider, cb);
    }
    cb.failures++;
    cb.lastFailureAt = Date.now();

    if (cb.failures >= this.options.failureThreshold) {
      cb.isOpen = true;
      cb.nextRetryAt = Date.now() + this.options.cooldownMs;
      this.options.onTrip?.(provider, cb);
    }
  }

  public recordSuccess(provider: string): void {
    this.states.delete(provider);
  }

  public getStates(): Map<string, CircuitBreakerState> {
    return new Map(this.states);
  }

  public setStates(states: Record<string, CircuitBreakerState>): void {
    this.states = new Map(Object.entries(states));
  }
}
