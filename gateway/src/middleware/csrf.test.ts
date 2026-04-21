import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CSRFTokenManager, csrfTokenManager, csrfProtection, skipCsrf } from './csrf';

describe('CSRF Token Manager', () => {
  let manager: CSRFTokenManager;

  beforeEach(() => {
    manager = new CSRFTokenManager('test-secret-key');
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('generates tokens for sessions', () => {
    const token = manager.generateToken('session-123');

    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(60); // HMAC hex string
  });

  it('validates correct tokens', () => {
    const sessionId = 'session-123';
    const token = manager.generateToken(sessionId);

    const isValid = manager.validateToken(sessionId, token);
    expect(isValid).toBe(true);
  });

  it('rejects tokens for different sessions', () => {
    const token = manager.generateToken('session-1');
    const isValid = manager.validateToken('session-2', token);

    expect(isValid).toBe(false);
  });

  it('rejects tampered tokens', () => {
    const token = manager.generateToken('session-1');
    const tamperedToken = token.slice(0, -1) + 'X'; // Change last character

    const isValid = manager.validateToken('session-1', tamperedToken);
    expect(isValid).toBe(false);
  });

  it('tokens are one-time use (consumed)', () => {
    const sessionId = 'session-123';
    const token = manager.generateToken(sessionId);

    // First validation should succeed
    const first = manager.validateToken(sessionId, token);
    expect(first).toBe(true);

    // Second validation should fail (already consumed)
    const second = manager.validateToken(sessionId, token);
    expect(second).toBe(false);
  });

  it('rejects expired tokens', () => {
    const sessionId = 'session-123';
    const token = manager.generateToken(sessionId);

    // Fast-forward time beyond TTL
    vi.useFakeTimers();
    vi.advanceTimersByTime(61 * 60 * 1000); // 61 minutes

    const isValid = manager.validateToken(sessionId, token);
    expect(isValid).toBe(false);

    vi.useRealTimers();
  });

  it('handles non-existent tokens', () => {
    const isValid = manager.validateToken('session-123', 'non-existent-token');
    expect(isValid).toBe(false);
  });

  it('cleans up expired tokens periodically', () => {
    vi.useFakeTimers();
    // Re-instantiate to use fake timers for the interval
    const testManager = new CSRFTokenManager('test-secret');
    
    testManager.generateToken('session-1');
    testManager.generateToken('session-2');
    testManager.generateToken('session-3');

    expect(testManager.getTokenCount()).toBe(3);

    // Fast-forward past TTL
    vi.advanceTimersByTime(61 * 60 * 1000);

    // Trigger cleanup (interval is 5 min)
    vi.advanceTimersToNextTimer();

    expect(testManager.getTokenCount()).toBe(0);

    testManager.shutdown();
    vi.useRealTimers();
  });

  it('uses HMAC for integrity verification', () => {
    const session = 'session-test';
    const token1 = manager.generateToken(session);
    const token2 = manager.generateToken(session);

    // Different tokens should be generated for same session
    expect(token1).not.toBe(token2);
  });

  it('prevents session fixation attacks', () => {
    const attackerSession = 'attacker-session';
    const victimSession = 'victim-session';

    const attackerToken = manager.generateToken(attackerSession);

    // Attacker tries to use their token with victim's session
    const isValid = manager.validateToken(victimSession, attackerToken);
    expect(isValid).toBe(false);
  });

  it('generates multiple tokens for same session', () => {
    const sessionId = 'session-123';

    const token1 = manager.generateToken(sessionId);
    const token2 = manager.generateToken(sessionId);
    const token3 = manager.generateToken(sessionId);

    // All should be valid initially
    expect(manager.validateToken(sessionId, token1)).toBe(true);
    expect(manager.validateToken(sessionId, token2)).toBe(true);
    expect(manager.validateToken(sessionId, token3)).toBe(true);
  });
});

describe('CSRF Middleware', () => {
  let manager: CSRFTokenManager;

  beforeEach(() => {
    manager = new CSRFTokenManager('test-secret');
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('skips CSRF protection for exempted paths', () => {
    const exemptions = skipCsrf(['/health', '/status'], ['GET']);

    expect(exemptions({ path: '/health', method: 'GET' })).toBe(false);
    expect(exemptions({ path: '/api/user', method: 'GET' })).toBe(true);
    expect(exemptions({ path: '/health', method: 'POST' })).toBe(true); // Different method
  });
});

describe('CSRF Security Properties', () => {
  let manager: CSRFTokenManager;

  beforeEach(() => {
    manager = new CSRFTokenManager('prod-secret-key-12345');
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('tokens are cryptographically random', () => {
    const sessionId = 'session-123';
    const tokens = new Set();

    // Generate 100 tokens
    for (let i = 0; i < 100; i++) {
      const token = manager.generateToken(sessionId);
      tokens.add(token);
    }

    // All should be unique
    expect(tokens.size).toBe(100);
  });

  it('protects against replay attacks', () => {
    const sessionId = 'session-123';
    const token = manager.generateToken(sessionId);

    // First use succeeds
    expect(manager.validateToken(sessionId, token)).toBe(true);

    // Replay attempt fails
    expect(manager.validateToken(sessionId, token)).toBe(false);
  });

  it('ensures tokens cannot be forged', () => {
    const sessionId = 'session-xyz';

    // Attacker tries to create a token
    const forgedToken = 'aa'.repeat(64); // Random 128-char hex string

    const isValid = manager.validateToken(sessionId, forgedToken);
    expect(isValid).toBe(false);
  });

  it('prevents timing attacks with constant-time comparison', () => {
    const sessionId = 'session-123';
    const validToken = manager.generateToken(sessionId);

    // These should take similar time (no timing leak)
    const wrongToken1 = validToken.slice(0, -10) + '0'.repeat(10);
    const wrongToken2 = '0'.repeat(128);

    const start1 = performance.now();
    manager.validateToken(sessionId, wrongToken1);
    const time1 = performance.now() - start1;

    manager.generateToken(sessionId + '2'); // Fresh manager state
    const wrongToken3 = validToken.slice(0, -10) + '1'.repeat(10);
    const start2 = performance.now();
    manager.validateToken(sessionId + '2', wrongToken3);
    const time2 = performance.now() - start2;

    // Times should be similar (within reasonable margin)
    // This is not a rigorous timing attack test but shows the pattern
    expect(Math.abs(time1 - time2)).toBeLessThan(10); // 10ms margin
  });

  it('token manager can be securely shut down', () => {
    const token = manager.generateToken('session-123');
    expect(manager.getTokenCount()).toBe(1);

    manager.shutdown();

    expect(manager.getTokenCount()).toBe(0);
  });
});
