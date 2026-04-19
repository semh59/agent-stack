/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptedSessionStorage,
  encryptedLocalStorage,
  secureTokenStorage,
  initializeSecureStorage,
} from './storage';

describe('Simplified SessionStorage Utility', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('stores and retrieves data correctly', () => {
    const data = 'test-data';
    encryptedSessionStorage.setItem('test-key', data);

    const retrieved = encryptedSessionStorage.getItem('test-key');
    expect(retrieved).toBe(data);
  });

  it('returns null for non-existent keys', () => {
    const result = encryptedSessionStorage.getItem('non-existent');
    expect(result).toBeNull();
  });

  it('removes items with removeItem', () => {
    encryptedSessionStorage.setItem('to-remove', 'data');
    expect(sessionStorage.getItem('to-remove')).toBeTruthy();

    encryptedSessionStorage.removeItem('to-remove');
    expect(sessionStorage.getItem('to-remove')).toBeNull();
  });

  it('clears all items with clear', () => {
    encryptedSessionStorage.setItem('key1', 'value1');
    encryptedSessionStorage.setItem('key2', 'value2');

    expect(sessionStorage.length).toBeGreaterThan(0);

    encryptedSessionStorage.clear();

    expect(sessionStorage.length).toBe(0);
  });

  it('handles large data', () => {
    const largeData = 'x'.repeat(10000);
    encryptedSessionStorage.setItem('large', largeData);

    const result = encryptedSessionStorage.getItem('large');
    expect(result).toBe(largeData);
  });
});

describe('Simplified LocalStorage Utility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves data in localStorage', () => {
    const data = 'local-data';
    encryptedLocalStorage.setItem('local-key', data);

    const result = encryptedLocalStorage.getItem('local-key');
    expect(result).toBe(data);
  });
});

describe('Secure Token Storage Compatibility', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    secureTokenStorage.clear();
  });

  it('stores access token', () => {
    const token = 'access-token-xyz-123';
    secureTokenStorage.setAccessToken(token);

    const retrieved = secureTokenStorage.getAccessToken();
    expect(retrieved).toBe(token);
  });

  it('stores refresh token', () => {
    const token = 'refresh-token-abc-456';
    secureTokenStorage.setRefreshToken(token);

    const retrieved = secureTokenStorage.getRefreshToken();
    expect(retrieved).toBe(token);
  });

  it('clears both tokens', () => {
    secureTokenStorage.setAccessToken('access');
    secureTokenStorage.setRefreshToken('refresh');

    secureTokenStorage.clear();

    expect(secureTokenStorage.getAccessToken()).toBeNull();
    expect(secureTokenStorage.getRefreshToken()).toBeNull();
  });
});

describe('Storage Initialization Compatibility', () => {
  it('initializes without error', () => {
    expect(() => initializeSecureStorage()).not.toThrow();
  });
});
