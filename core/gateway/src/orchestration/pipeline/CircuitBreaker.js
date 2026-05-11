"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = void 0;
class CircuitBreaker {
    options;
    states = new Map();
    constructor(options) {
        this.options = options;
    }
    check(provider) {
        const cb = this.states.get(provider);
        if (!cb || !cb.isOpen)
            return;
        if (Date.now() >= cb.nextRetryAt) {
            // Half-open: allow one attempt
            return;
        }
        throw new Error(`Circuit breaker is OPEN for ${provider}. Next retry at ${new Date(cb.nextRetryAt).toISOString()}`);
    }
    recordFailure(provider) {
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
    recordSuccess(provider) {
        this.states.delete(provider);
    }
    getStates() {
        return new Map(this.states);
    }
    setStates(states) {
        this.states = new Map(Object.entries(states));
    }
}
exports.CircuitBreaker = CircuitBreaker;
//# sourceMappingURL=CircuitBreaker.js.map