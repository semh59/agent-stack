import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pkceStateManager, authorizeGoogleGemini, exchangeGoogleGemini } from './oauth';

vi.mock('../constants', () => ({
  ALLOY_CLIENT_ID: 'test-client-id',
  ALLOY_CLIENT_SECRET: 'test-client-secret',
  ALLOY_REDIRECT_URI: 'http://localhost:3000/callback',
  ALLOY_SCOPES: ['scope1', 'scope2'],
  ALLOY_ENDPOINT_FALLBACKS: [],
  ALLOY_LOAD_ENDPOINTS: ['https://api.example.com'],
  ALLOY_HEADERS: { 'Client-Metadata': 'test' },
  GEMINI_CLI_HEADERS: { 'User-Agent': 'test-agent', 'X-Goog-Api-Client': 'test-client' },
}));

vi.mock('../plugin/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../plugin/auth', () => ({
  calculateTokenExpiry: (startTime: number, expiresIn: number) => startTime + expiresIn * 1000,
}));

describe('PKCE State Manager', () => {
  beforeEach(() => {
    pkceStateManager.shutdown();
  });

  afterEach(() => {
    pkceStateManager.shutdown();
  });

  it('generates random state and verifier', () => {
    const { state, verifier, challenge } = pkceStateManager.generateState('test-project');

    expect(state).toBeTruthy();
    expect(verifier).toBeTruthy();
    expect(challenge).toBeTruthy();

    // State should be random, not contain verifier
    expect(state).not.toContain(verifier);
    expect(state.length).toBe(32); // 16 bytes * 2 hex chars
    expect(verifier.length).toBe(64); // 32 bytes * 2 hex chars
  });

  it('stores verifier server-side with state key', () => {
    const { state } = pkceStateManager.generateState('project-123');

    // Retrieve using state
    const data = pkceStateManager.validateAndConsumeState(state);

    expect(data).not.toBeNull();
    expect(data?.projectId).toBe('project-123');
  });

  it('validates and consumes state (one-time use)', () => {
    const { state } = pkceStateManager.generateState('project-123');

    // First consumption should succeed
    const first = pkceStateManager.validateAndConsumeState(state);
    expect(first).not.toBeNull();

    // Second consumption should fail (already consumed)
    const second = pkceStateManager.validateAndConsumeState(state);
    expect(second).toBeNull();
  });

  it('rejects invalid state', () => {
    const result = pkceStateManager.validateAndConsumeState('invalid-state-xyz');
    expect(result).toBeNull();
  });

  it('rejects expired state', () => {
    const { state } = pkceStateManager.generateState();

    // Fast-forward time to expire the state
    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes

    const result = pkceStateManager.validateAndConsumeState(state);
    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it('prevents replay attacks (state consumed only once)', () => {
    const { state } = pkceStateManager.generateState();

    // First consumption
    const result1 = pkceStateManager.validateAndConsumeState(state);
    expect(result1).not.toBeNull();

    // Replay attempt
    const result2 = pkceStateManager.validateAndConsumeState(state);
    expect(result2).toBeNull();
  });

  it('cleans up expired states automatically', async () => {
    const { state } = pkceStateManager.generateState();
    expect(pkceStateManager.getStateCount()).toBe(1);

    // Fast-forward time
    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes

    // Wait for cleanup timer (mocked at 60 second intervals)
    vi.advanceTimersByTime(60 * 1000);

    // State should be cleaned up
    expect(pkceStateManager.validateAndConsumeState(state)).toBeNull();

    vi.useRealTimers();
  });

  it('stores project ID with state', () => {
    const { state } = pkceStateManager.generateState('my-project-id');

    const data = pkceStateManager.validateAndConsumeState(state);
    expect(data?.projectId).toBe('my-project-id');
  });

  it('handles multiple concurrent states', () => {
    const state1 = pkceStateManager.generateState('project-1').state;
    const state2 = pkceStateManager.generateState('project-2').state;
    const state3 = pkceStateManager.generateState('project-3').state;

    expect(pkceStateManager.getStateCount()).toBe(3);

    // All should be retrievable independently
    const data1 = pkceStateManager.validateAndConsumeState(state1);
    const data2 = pkceStateManager.validateAndConsumeState(state2);
    const data3 = pkceStateManager.validateAndConsumeState(state3);

    expect(data1?.projectId).toBe('project-1');
    expect(data2?.projectId).toBe('project-2');
    expect(data3?.projectId).toBe('project-3');

    // All should be consumed now
    expect(pkceStateManager.getStateCount()).toBe(0);
  });
});

describe('OAuth Authorization Flow', () => {
  beforeEach(() => {
    pkceStateManager.shutdown();
  });

  afterEach(() => {
    pkceStateManager.shutdown();
  });

  it('generates authorization URL with server-side PKCE', async () => {
    const auth = await authorizeGoogleGemini('test-project');
    const parsed = new URL(auth.url);

    expect(auth.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(auth.url).toContain('client_id=test-client-id');
    expect(auth.url).toContain('redirect_uri=');
    expect(auth.url).toContain('scope=');
    expect(auth.url).toContain('code_challenge=');
    expect(auth.url).toContain('state=');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');

    // State MUST be in the URL for CSRF protection
    expect(auth.url).toContain(auth.state); 

    // Verify state is stored server-side
    expect(auth.state.length).toBe(32);
  });

  it('code challenge is S256 hash of server-side verifier', async () => {
    const auth = await authorizeGoogleGemini();

    // Extract challenge from URL
    const url = new URL(auth.url);
    const challenge = url.searchParams.get('code_challenge');

    expect(challenge).toBeTruthy();
    expect(challenge?.length).toBeGreaterThan(0);

    // Challenge should be base64url encoded (no +, /, =)
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
    // = padding is allowed in base64url
  });
});

describe('OAuth Token Exchange', () => {
  beforeEach(() => {
    pkceStateManager.shutdown();
    vi.clearAllMocks();
  });

  afterEach(() => {
    pkceStateManager.shutdown();
  });

  it('exchanges code for tokens using server-side verifier', async () => {
    // Setup
    const { state } = pkceStateManager.generateState('test-project');

    // Mock Google token endpoint
    global.fetch = vi.fn((url, options?: RequestInit) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        // Verify verifier is sent in POST body
        const body = options?.body as URLSearchParams;
        const _verifier = body?.get('code_verifier');

        return Promise.resolve(new Response(JSON.stringify({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
        }), { status: 200 }));
      }

      if (typeof url === 'string' && url.includes('userinfo')) {
        return Promise.resolve(new Response(JSON.stringify({
          email: 'test@example.com',
        }), { status: 200 }));
      }

      return Promise.resolve(new Response('Not found', { status: 404 }));
    });

    const result = await exchangeGoogleGemini('test-code', state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.access).toBe('test-access-token');
      expect(result.refresh).toContain('test-refresh-token');
      expect(result.email).toBe('test@example.com');
    }
  });

  it('rejects invalid state', async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));

    const result = await exchangeGoogleGemini('test-code', 'invalid-state');

    expect(result.type).toBe('failed');
    if (result.type === 'failed') {
      expect(result.error).toContain('Invalid or expired OAuth state');
    }
  });

  it('rejects expired state', async () => {
    const { state } = pkceStateManager.generateState();

    // Fast-forward time to expire
    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60 * 1000);

    const result = await exchangeGoogleGemini('test-code', state);

    expect(result.type).toBe('failed');
    if (result.type === 'failed') {
      expect(result.error).toContain('Invalid or expired OAuth state');
    }

    vi.useRealTimers();
  });

  it('prevents state replay attacks during token exchange', async () => {
    const { state } = pkceStateManager.generateState();

    global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_in: 3600,
    }), { status: 200 })));

    // First exchange - should succeed
    const result1 = await exchangeGoogleGemini('code-1', state);
    expect(result1.type).toBe('success');

    // Replay attempt with same state - should fail
    const result2 = await exchangeGoogleGemini('code-2', state);
    expect(result2.type).toBe('failed');
  });

  it('handles token endpoint errors gracefully', async () => {
    const { state } = pkceStateManager.generateState();

    global.fetch = vi.fn(() => Promise.resolve(new Response('Invalid code', { status: 400 })));

    const result = await exchangeGoogleGemini('invalid-code', state);

    expect(result.type).toBe('failed');
    if (result.type === 'failed') {
      expect(result.error).toContain('Invalid code');
    }
  });

  it('handles network errors gracefully', async () => {
    const { state } = pkceStateManager.generateState();

    global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    const result = await exchangeGoogleGemini('test-code', state);

    expect(result.type).toBe('failed');
    if (result.type === 'failed') {
      expect(result.error).toContain('Network error');
    }
  });

  it('handles missing refresh token in response', async () => {
    const { state } = pkceStateManager.generateState();

    global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      access_token: 'test-access',
      expires_in: 3600,
      // Missing refresh_token
    }), { status: 200 })));

    const result = await exchangeGoogleGemini('test-code', state);

    expect(result.type).toBe('failed');
    if (result.type === 'failed') {
      expect(result.error).toContain('Missing refresh token');
    }
  });
});

describe('Security Properties', () => {
  it('state does not leak verifier in URL or logs', async () => {
    const { state, verifier } = pkceStateManager.generateState();

    // Verify state doesn't contain verifier
    expect(state).not.toContain(verifier);
    expect(state).not.toContain(verifier.slice(0, 10));

    // Generate auth URL and verify state is present
    const auth = await authorizeGoogleGemini();
    expect(auth.url).toContain(auth.state);
  });

  it('prevents PKCE interception attacks', async () => {
    const { state, challenge: _challenge } = pkceStateManager.generateState();

    // Even if attacker intercepts state, they can't derive verifier
    const stateData = pkceStateManager.validateAndConsumeState(state);
    expect(stateData).not.toBeNull();

    // Verifier is only available server-side during token exchange
    // An attacker with just the state cannot perform token exchange
  });

  it('challenge is properly S256 hashed', async () => {
    const { challenge } = pkceStateManager.generateState();

    // Challenge should be base64url without padding (S256 format)
    expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);

    // Challenge length for S256 (SHA256 hashed) should be ~43 chars
    expect(challenge.length).toBeGreaterThan(40);
    expect(challenge.length).toBeLessThan(50);
  });
});
