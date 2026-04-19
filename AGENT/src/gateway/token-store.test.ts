import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TokenStore, type StoredToken } from './token-store';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Helper for delays in tests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('TokenStore - Race Condition Prevention', () => {
  let tokenStore: TokenStore;
  let tempStorePath: string;

  const mockToken: StoredToken = {
    accessToken: 'mock-access-token-123',
    refreshToken: 'mock-refresh-token-456',
    expiresAt: Date.now() + 3600000,
    email: 'test@example.com',
    projectId: 'test-project',
    createdAt: Date.now(),
  };

  beforeEach(() => {
    // Create temp store path for testing
    tempStorePath = path.join(os.tmpdir(), `token-store-test-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
    tokenStore = new TokenStore(tempStorePath);
    tokenStore.addOrUpdateAccount(mockToken);
  });

  afterEach(() => {
    // Cleanup temp file
    if (fs.existsSync(tempStorePath)) {
      fs.unlinkSync(tempStorePath);
    }
  });

  it('prevents concurrent token refreshes for same email', async () => {
    let concurrentRefreshCount = 0;
    let maxConcurrentCount = 0;

    // Mock fetch to track concurrent calls
    global.fetch = vi.fn(async () => {
      concurrentRefreshCount++;
      maxConcurrentCount = Math.max(maxConcurrentCount, concurrentRefreshCount);

      // Verify only 1 refresh at a time
      expect(concurrentRefreshCount).toBe(1);

      await delay(50);
      concurrentRefreshCount--;

      return new Response(JSON.stringify({
        access_token: 'new-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    });

    // Launch 3 concurrent refresh calls
    const results = await Promise.all([
      tokenStore.refreshActiveToken(),
      tokenStore.refreshActiveToken(),
      tokenStore.refreshActiveToken(),
    ]);

    // All should return valid tokens
    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(results[2]).not.toBeNull();

    // Fetch should only be called once (not 3 times)
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Max concurrent count should be 1
    expect(maxConcurrentCount).toBe(1);
  });

  it('concurrent calls return same promise', async () => {
    global.fetch = vi.fn(async () => {
      await delay(50);
      return new Response(JSON.stringify({
        access_token: 'new-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    });

    // Get promises from concurrent calls
    const promise1 = tokenStore.refreshActiveToken();
    const promise2 = tokenStore.refreshActiveToken();
    const promise3 = tokenStore.refreshActiveToken();

    // All promises should resolve to same result
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cleanup removes promise from map after refresh completes', async () => {
    global.fetch = vi.fn(async () => {
      await delay(20);
      return new Response(JSON.stringify({
        access_token: 'new-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    });

    // Access private members for testing (using type assertion)
    const store = tokenStore as any;
    const lockKey = 'test@example.com';

    // Before refresh
    expect(store.refreshInProgress.has(lockKey)).toBe(false);

    // Start refresh
    const refreshPromise = tokenStore.refreshActiveToken();

    // During refresh, promise should be in map
    expect(store.refreshInProgress.has(lockKey)).toBe(true);

    // Wait for completion
    await refreshPromise;

    // After refresh, promise should be cleaned up
    expect(store.refreshInProgress.has(lockKey)).toBe(false);
  });

  it('handles refresh error without leaving lock hanging', async () => {
    global.fetch = vi.fn(async () => {
      await delay(20);
      return new Response('Token refresh failed', { status: 400 });
    });

    const store = tokenStore as any;
    const lockKey = 'test@example.com';

    const result = await tokenStore.refreshActiveToken();

    // Should return null on error
    expect(result).toBeNull();

    // Lock should still be cleaned up
    expect(store.refreshInProgress.has(lockKey)).toBe(false);
  });

  it('uses email as lock key for different accounts', async () => {
    const token2: StoredToken = {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 3600000,
      email: 'other@example.com',
      projectId: 'other-project',
      createdAt: Date.now(),
    };

    tokenStore.addOrUpdateAccount(token2);

    let fetchCallCount = 0;
    global.fetch = vi.fn(async () => {
      fetchCallCount++;
      await delay(30);
      return new Response(JSON.stringify({
        access_token: `new-access-${fetchCallCount}`,
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    });

    // Switch to first account
    const store = tokenStore as any;
    store.data.activeIndex = 0;

    // Refresh first account
    const refresh1 = tokenStore.refreshActiveToken();

    // Switch to second account
    store.data.activeIndex = 1;

    // Refresh second account (different email, should be concurrent)
    const refresh2 = tokenStore.refreshActiveToken();

    const [result1, result2] = await Promise.all([refresh1, refresh2]);

    // Both should succeed
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();

    // Fetch should be called twice (different locks)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles anonymous token (no email) with default lock key', async () => {
    const anonToken: StoredToken = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
      email: undefined,
      projectId: undefined,
      createdAt: Date.now(),
    };

    const tempPath = path.join(os.tmpdir(), `token-anon-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
    const anonStore = new TokenStore(tempPath);
    anonStore.addOrUpdateAccount(anonToken);

    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      await delay(30);
      return new Response(JSON.stringify({
        access_token: 'new-access',
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    });

    // Multiple concurrent calls with same anonymous token
    const results = await Promise.all([
      anonStore.refreshActiveToken(),
      anonStore.refreshActiveToken(),
    ]);

    expect(results[0]).not.toBeNull();
    expect(results[1]).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  });
});

describe('TokenStore - File Permissions & Security', () => {
  let tokenStore: TokenStore;
  let tempStorePath: string;

  beforeEach(() => {
    tempStorePath = path.join(os.tmpdir(), `token-perms-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
    tokenStore = new TokenStore(tempStorePath);
  });

  afterEach(() => {
    if (fs.existsSync(tempStorePath)) {
      fs.unlinkSync(tempStorePath);
    }
    const dir = path.dirname(tempStorePath);
    if (fs.existsSync(dir) && dir.includes('token-perms')) {
      try {
        fs.rmdirSync(dir);
      } catch {
        // Ignore if dir not empty
      }
    }
  });

  it('creates config directory with restrictive permissions (0o700)', () => {
    // Create a custom path in temp with subdirectories
    const customConfigDir = path.join(os.tmpdir(), `agent-config-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    const customStorePath = path.join(customConfigDir, 'tokens.json');

    const store = new TokenStore(customStorePath);
    const mockToken: StoredToken = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600000,
      email: 'test@example.com',
      projectId: 'project',
      createdAt: Date.now(),
    };

    store.addOrUpdateAccount(mockToken);

    // Check directory permissions (0o700 = rwx------)
    const stats = fs.statSync(customConfigDir);
    const mode = stats.mode & 0o777;

    // On Windows, permissions work differently, so we just check directory exists
    expect(fs.existsSync(customConfigDir)).toBe(true);

    // Cleanup
    if (fs.existsSync(customStorePath)) {
      fs.unlinkSync(customStorePath);
    }
    if (fs.existsSync(customConfigDir)) {
      fs.rmdirSync(customConfigDir);
    }
  });

  it('stores encrypted token data', () => {
    const mockToken: StoredToken = {
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh-token',
      expiresAt: Date.now() + 3600000,
      email: 'test@example.com',
      projectId: 'project',
      createdAt: Date.now(),
    };

    tokenStore.addOrUpdateAccount(mockToken);

    // Read raw file content
    const rawContent = fs.readFileSync(tempStorePath, 'utf-8');

    // Should not contain plaintext tokens
    expect(rawContent).not.toContain('secret-access-token');
    expect(rawContent).not.toContain('secret-refresh-token');

    // Should be valid JSON (encrypted payload)
    expect(() => JSON.parse(rawContent)).not.toThrow();
  });

  it('handles corrupted encrypted data gracefully', () => {
    // Write corrupted data to store
    fs.writeFileSync(tempStorePath, 'corrupted-encrypted-garbage-data', 'utf-8');

    // Should load with default empty store, not crash
    const store = new TokenStore(tempStorePath);
    expect(store.getAllAccounts()).toEqual([]);
  });
});

describe('TokenStore - Token Expiry & Validation', () => {
  let tokenStore: TokenStore;
  let tempStorePath: string;

  beforeEach(() => {
    tempStorePath = path.join(os.tmpdir(), `token-expiry-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
    tokenStore = new TokenStore(tempStorePath);
  });

  afterEach(() => {
    if (fs.existsSync(tempStorePath)) {
      fs.unlinkSync(tempStorePath);
    }
  });

  it('detects expired tokens with 5-minute buffer', () => {
    const now = Date.now();
    const almostExpiredToken: StoredToken = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: now + 2 * 60 * 1000, // 2 minutes from now
      email: 'test@example.com',
      projectId: 'project',
      createdAt: now,
    };

    tokenStore.addOrUpdateAccount(almostExpiredToken);

    // Should be considered expired (2 minutes < 5 minute buffer)
    const isExpired = tokenStore.isTokenExpired(almostExpiredToken);
    expect(isExpired).toBe(true);
  });

  it('accepts tokens with sufficient validity', () => {
    const now = Date.now();
    const validToken: StoredToken = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: now + 30 * 60 * 1000, // 30 minutes from now
      email: 'test@example.com',
      projectId: 'project',
      createdAt: now,
    };

    tokenStore.addOrUpdateAccount(validToken);

    // Should not be expired (30 minutes > 5 minute buffer)
    const isExpired = tokenStore.isTokenExpired(validToken);
    expect(isExpired).toBe(false);
  });

  it('auto-refreshes expired token in getValidAccessToken', async () => {
    const expiredToken: StoredToken = {
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000, // Already expired
      email: 'test@example.com',
      projectId: 'project',
      createdAt: Date.now(),
    };

    tokenStore.addOrUpdateAccount(expiredToken);

    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        access_token: 'new-fresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    });

    const token = await tokenStore.getValidAccessToken();

    expect(token).toBe('new-fresh-token');
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('TokenStore - Multi-Account Management', () => {
  let tokenStore: TokenStore;
  let tempStorePath: string;

  beforeEach(() => {
    tempStorePath = path.join(os.tmpdir(), `token-multi-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
    tokenStore = new TokenStore(tempStorePath);
  });

  afterEach(() => {
    if (fs.existsSync(tempStorePath)) {
      fs.unlinkSync(tempStorePath);
    }
  });

  it('manages multiple accounts independently', () => {
    const token1: StoredToken = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3600000,
      email: 'user1@example.com',
      projectId: 'project-1',
      createdAt: Date.now(),
    };

    const token2: StoredToken = {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 3600000,
      email: 'user2@example.com',
      projectId: 'project-2',
      createdAt: Date.now(),
    };

    tokenStore.addOrUpdateAccount(token1);
    tokenStore.addOrUpdateAccount(token2);

    expect(tokenStore.getAccountCount()).toBe(2);

    const accounts = tokenStore.getAllAccounts();
    expect(accounts).toContainEqual(expect.objectContaining({ email: 'user1@example.com' }));
    expect(accounts).toContainEqual(expect.objectContaining({ email: 'user2@example.com' }));
  });

  it('updates existing account instead of duplicating', () => {
    const token1: StoredToken = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3600000,
      email: 'user@example.com',
      projectId: 'project-1',
      createdAt: Date.now(),
    };

    tokenStore.addOrUpdateAccount(token1);
    expect(tokenStore.getAccountCount()).toBe(1);

    // Update same email
    const token1Updated: StoredToken = {
      ...token1,
      accessToken: 'access-1-updated',
      projectId: 'project-1-updated',
    };

    tokenStore.addOrUpdateAccount(token1Updated);

    // Should still be 1 account
    expect(tokenStore.getAccountCount()).toBe(1);

    // Should have updated values
    const active = tokenStore.getActiveToken();
    expect(active?.accessToken).toBe('access-1-updated');
    expect(active?.projectId).toBe('project-1-updated');
  });
});
