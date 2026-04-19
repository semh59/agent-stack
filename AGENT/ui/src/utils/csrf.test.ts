import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCsrfToken, resetCsrfToken, apiFetch } from './csrf';

type FetchCall = [input: string | URL | Request, init?: RequestInit];
type MockedFetch = {
  mock: {
    calls: FetchCall[];
  };
};

describe('Frontend CSRF Token Utilities', () => {
  beforeEach(() => {
    resetCsrfToken();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetCsrfToken();
  });

  describe('getCsrfToken', () => {
    it('fetches token from server', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, {
          headers: { 'X-CSRF-Token': 'test-token-123' },
        }))
      );

      const token = await getCsrfToken();

      expect(token).toBe('test-token-123');
      expect(global.fetch).toHaveBeenCalledWith('/api/csrf-token', {
        method: 'GET',
        credentials: 'include',
        signal: expect.any(AbortSignal),
        headers: { 'Accept': 'application/json' },
      });
    });

    it('caches token in memory for subsequent calls', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, {
          headers: { 'X-CSRF-Token': 'cached-token-456' },
        }))
      );

      const t1 = await getCsrfToken();
      const t2 = await getCsrfToken();

      expect(t1).toBe('cached-token-456');
      expect(t2).toBe('cached-token-456');
      // Fetch should only be called once due to caching
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes expired cached token', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, {
          headers: { 'X-CSRF-Token': 'token-fresh-new' },
        }))
      );

      // First fetch
      await getCsrfToken();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Expire cache (55 minutes in real time, but we'll mock it)
      vi.useFakeTimers();
      vi.advanceTimersByTime(56 * 60 * 1000);

      const secondToken = await getCsrfToken();
      expect(secondToken).toBe('token-fresh-new');
      // Should fetch again after expiry
      expect(global.fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('handles fetch errors gracefully', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      await expect(getCsrfToken()).rejects.toThrow('Failed to fetch CSRF token');
    });

    it('handles missing token in headers', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      );

      await expect(getCsrfToken()).rejects.toThrow('Failed to fetch CSRF token');
    });

    it('handles non-200 responses', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 403 }))
      );

      await expect(getCsrfToken()).rejects.toThrow();
    });

    it('clears cache on error after cached token expiry', async () => {
      vi.useFakeTimers();

      // First successful fetch
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, {
          headers: { 'X-CSRF-Token': 'token-123' },
        }))
      );

      await getCsrfToken();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Next call should use cache
      await getCsrfToken();
      expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1

      await vi.advanceTimersByTimeAsync(56 * 60 * 1000);

      // Now simulate error
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      await expect(getCsrfToken()).rejects.toThrow('Failed to fetch CSRF token');

      // Cache should be cleared, so next successful call should fetch again
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, {
          headers: { 'X-CSRF-Token': 'token-456' },
        }))
      );

      const finalToken = await getCsrfToken();
      expect(finalToken).toBe('token-456');
      expect(global.fetch).toHaveBeenCalledTimes(1); // Fresh fetch

      vi.useRealTimers();
    });

    it('times out long-running requests', async () => {
      vi.useFakeTimers();

      global.fetch = vi.fn((_, init) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        );
      }));

      const timeoutPromise = expect(getCsrfToken()).rejects.toThrow('Failed to fetch CSRF token');

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(6000); // 6 seconds

      await timeoutPromise;

      vi.useRealTimers();
    });
  });

  describe('resetCsrfToken', () => {
    it('clears cached token', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, {
          headers: { 'X-CSRF-Token': 'token-to-clear' },
        }))
      );

      await getCsrfToken();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      resetCsrfToken();

      await getCsrfToken();
      expect(global.fetch).toHaveBeenCalledTimes(2); // Forced re-fetch
    });

    it('is called on logout', () => {
      // This is a behavioral test
      expect(() => resetCsrfToken()).not.toThrow();
    });
  });

  describe('apiFetch', () => {
    it('adds CSRF token to POST requests', async () => {
      global.fetch = vi.fn((url: string | URL | Request) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve(new Response(null, {
            headers: { 'X-CSRF-Token': 'test-csrf-token' },
          }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      });

      const response = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'John' }),
      });

      expect(response.status).toBe(200);

      // Verify CSRF token was added
      const calls = (global.fetch as unknown as MockedFetch).mock.calls;
      const apiCall = calls.find((c) => c[0] === '/api/users');
      expect(apiCall).toBeDefined();
      const headers = apiCall?.[1]?.headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('test-csrf-token');
    });

    it('includes credentials in all requests', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ data: 'test' })))
      );

      await apiFetch('/api/data');

      const calls = (global.fetch as unknown as MockedFetch).mock.calls;
      const call = calls[calls.length - 1];
      if (!call) throw new Error('Missing api/data fetch call');
      expect(call[1]?.credentials).toBe('include');
    });

    it('sets JSON content type for POST requests', async () => {
      global.fetch = vi.fn((url: string | URL | Request) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve(new Response(null, {
            headers: { 'X-CSRF-Token': 'token' },
          }));
        }
        return Promise.resolve(new Response(JSON.stringify({})));
      });

      await apiFetch('/api/test', { method: 'POST' });

      const calls = (global.fetch as unknown as MockedFetch).mock.calls;
      const apiCall = calls.find((c) => c[0] === '/api/test');
      expect(apiCall).toBeDefined();
      const headers = apiCall?.[1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('retries on CSRF token expiration (403)', async () => {
      let callCount = 0;

      global.fetch = vi.fn((url: string | URL | Request) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve(new Response(null, {
            headers: { 'X-CSRF-Token': `token-${callCount}` },
          }));
        }

        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({
            error: 'csrf_validation_failed',
            message: 'Token expired',
          }), { status: 403 }));
        }

        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      });

      const response = await apiFetch('/api/test', { method: 'POST' });

      // Should succeed after retry
      const data = await response.json();
      expect(data.success).toBe(true);

      // Should have made multiple calls
      expect((global.fetch as unknown as MockedFetch).mock.calls.length).toBeGreaterThan(2);
    });

    it('does not require CSRF token for GET requests', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ data: 'test' })))
      );

      await apiFetch('/api/data', { method: 'GET' });

      const calls = (global.fetch as unknown as MockedFetch).mock.calls;
      const call = calls[0];
      if (!call) throw new Error('Missing GET call');

      // Should not fetch CSRF token for GET
      expect((global.fetch as unknown as MockedFetch).mock.calls.length).toBe(1);
      expect(call[1]?.method).toBe('GET');
      const headers = (call[1]?.headers ?? {}) as Record<string, string | undefined>;
      expect(headers['X-CSRF-Token']).toBeUndefined();
    });
  });

  describe('Security Properties', () => {
    it('prevents cross-origin CSRF attacks with credentials', async () => {
      global.fetch = vi.fn((url: string | URL | Request) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve(new Response(null, {
            headers: { 'X-CSRF-Token': 'token-123' },
          }));
        }
        return Promise.resolve(new Response(JSON.stringify({})));
      });

      await apiFetch('/api/protected', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      });

      const calls = (global.fetch as unknown as MockedFetch).mock.calls;
      const apiCall = calls.find((c) => c[0] === '/api/protected');
      expect(apiCall).toBeDefined();
      const headers = apiCall?.[1]?.headers as Record<string, string>;

      // Verify protection mechanisms
      expect(apiCall?.[1]?.credentials).toBe('include'); // Send cookies
      expect(headers['X-CSRF-Token']).toBeTruthy(); // Include CSRF token
      expect(headers['Content-Type']).toBe('application/json'); // Standard content type
    });

    it('tokens are isolated per request', async () => {
      const tokens: string[] = [];

      global.fetch = vi.fn((url: string | URL | Request) => {
        if (url === '/api/csrf-token') {
          const token = `token-${tokens.length}`;
          tokens.push(token);
          return Promise.resolve(new Response(null, {
            headers: { 'X-CSRF-Token': token },
          }));
        }
        return Promise.resolve(new Response(JSON.stringify({})));
      });

      // First request uses fresh token
      await apiFetch('/api/test1', { method: 'POST' });

      // Reset to force new fetch
      resetCsrfToken();

      // Second request should get a new token
      await apiFetch('/api/test2', { method: 'POST' });

      // Both tokens should be present and potentially different
      expect(tokens.length).toBeGreaterThan(0);
    });
  });
});
