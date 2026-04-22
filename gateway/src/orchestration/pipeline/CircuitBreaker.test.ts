import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from './CircuitBreaker';

describe('CircuitBreaker', () => {
  const options = {
    failureThreshold: 3,
    cooldownMs: 1000,
    onTrip: vi.fn(),
  };

  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker(options);
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('should start in closed state', () => {
    expect(() => cb.check('provider-a')).not.toThrow();
    const states = cb.getStates();
    expect(states.size).toBe(0);
  });

  it('should trip after threshold failures', () => {
    cb.recordFailure('provider-a');
    cb.recordFailure('provider-a');
    
    // Still closed
    expect(() => cb.check('provider-a')).not.toThrow();
    
    cb.recordFailure('provider-a');
    
    // Now open
    expect(() => cb.check('provider-a')).toThrow(/Circuit breaker is OPEN for provider-a/);
    expect(options.onTrip).toHaveBeenCalledWith('provider-a', expect.objectContaining({
      failures: 3,
      isOpen: true
    }));
  });

  it('should allow retry after cooldown (half-open)', () => {
    cb.recordFailure('provider-a');
    cb.recordFailure('provider-a');
    cb.recordFailure('provider-a');
    
    expect(() => cb.check('provider-a')).toThrow();
    
    // Advance time
    vi.advanceTimersByTime(1100);
    
    // Should NOT throw (half-open)
    expect(() => cb.check('provider-a')).not.toThrow();
  });

  it('should reset on success', () => {
    cb.recordFailure('provider-a');
    cb.recordFailure('provider-a');
    cb.recordFailure('provider-a');
    
    vi.advanceTimersByTime(1100);
    cb.recordSuccess('provider-a');
    
    const states = cb.getStates();
    expect(states.has('provider-a')).toBe(false);
    
    // Should be closed again
    expect(() => cb.check('provider-a')).not.toThrow();
  });

  it('should handle persistent state hydration', () => {
    const initialState = {
      'provider-b': {
        failures: 5,
        lastFailureAt: Date.now(),
        isOpen: true,
        nextRetryAt: Date.now() + 5000
      }
    };
    
    cb.setStates(initialState);
    
    expect(() => cb.check('provider-b')).toThrow(/Circuit breaker is OPEN for provider-b/);
    
    const exported = cb.getStates();
    expect(exported.get('provider-b')).toEqual(initialState['provider-b']);
  });

  it('should separate states by provider', () => {
    cb.recordFailure('provider-a');
    cb.recordFailure('provider-a');
    cb.recordFailure('provider-a');
    
    expect(() => cb.check('provider-a')).toThrow();
    expect(() => cb.check('provider-b')).not.toThrow();
  });
});
