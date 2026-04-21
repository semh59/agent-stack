/**
 * K6 FIX: Storage utility rewrite.
 * Removed fake CryptoJS encryption.
 * Using standard sessionStorage directly. Webview data is isolated and ephemeral.
 * ENCRYPTION_CONFIG removed as it's no longer needed.
 */

// Drop-in replacement for localStorage/sessionStorage APIs without encryption
export const encryptedSessionStorage = {
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  
  setItem: (key: string, value: string): void => {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      console.error('[Storage] Error setting item:', e);
    }
  },
  
  removeItem: (key: string): void => {
    try {
      sessionStorage.removeItem(key);
    } catch (e) {
      console.error('[Storage] Error removing item:', e);
    }
  },
  
  clear: (): void => {
    try {
      sessionStorage.clear();
    } catch (e) {
      console.error('[Storage] Error clearing storage:', e);
    }
  }
};

// Aliases for Group 1-5 backward compatibility
export const encryptedLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('[Storage] Error setting item:', e);
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error('[Storage] Error removing item:', e);
    }
  },
  clear: (): void => {
    try {
      localStorage.clear();
    } catch (e) {
      console.error('[Storage] Error clearing storage:', e);
    }
  }
};

export const secureTokenStorage = {
  getAccessToken: () => encryptedSessionStorage.getItem('auth_access_token'),
  setAccessToken: (token: string) => encryptedSessionStorage.setItem('auth_access_token', token),
  getRefreshToken: () => encryptedSessionStorage.getItem('auth_refresh_token'),
  setRefreshToken: (token: string) => encryptedSessionStorage.setItem('auth_refresh_token', token),
  clear: () => {
    encryptedSessionStorage.removeItem('auth_access_token');
    encryptedSessionStorage.removeItem('auth_refresh_token');
  }
};

export const initializeSecureStorage = () => {
  console.log('[Storage] System initialized in simplified mode.');
};
