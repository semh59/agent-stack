import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import AsyncLock from "async-lock";
import { KeyManager, type EncryptedPayload } from "../plugin/key-manager";
import { type UnifiedToken, AIProvider } from "./provider-types";

// Cache for account lookups to ensure O(1) efficiency in high-frequency rotation
const accountCache = new Map<string, StoredToken>();

const keyManager = new KeyManager();

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface StoredToken {
  provider: AIProvider;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  email: string;
  projectId?: string;
  createdAt: number;
}

export interface TokenStoreData {
  version: 2;
  accounts: StoredToken[];
  activeIndex: number;
}

// â”€â”€â”€ Defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getDefaultStore(): TokenStoreData {
  return {
    version: 2,
    accounts: [],
    activeIndex: 0,
  };
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function getStorePath(): string {
  const configDir =
    process.env.AGENT_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "Alloy");

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  return path.join(configDir, "alloy-credentials.json");
}

function isEncrypted(content: string): boolean {
  if (!content) return false;
  return KeyManager.isV3Encrypted(content);
}

export class TokenStore {
  private storePath: string;
  private data: TokenStoreData;
  private refreshLock = new AsyncLock();
  private refreshInProgress: Map<string, Promise<StoredToken | null>> = new Map();

  constructor(storePath?: string) {
    this.storePath = storePath ?? getStorePath();
    this.data = this.loadFromDisk();
  }

  private loadFromDisk(): TokenStoreData {
    try {
      if (fs.existsSync(this.storePath)) {
        let raw = fs.readFileSync(this.storePath, "utf-8");
        
        if (isEncrypted(raw)) {
          try {
            raw = JSON.stringify(keyManager.decrypt(JSON.parse(raw) as EncryptedPayload));
          } catch (err) {
            console.error("[TokenStore] Failed to decrypt token store:", err);
            return getDefaultStore();
          }
        }

        const parsed = JSON.parse(raw) as TokenStoreData;
        if (Array.isArray(parsed.accounts)) {
          accountCache.clear();
          parsed.accounts.forEach(acc => {
            if (acc.email) accountCache.set(acc.email, acc);
          });
          return parsed;
        }
      }
    } catch {
      // Start fresh
    }
    return getDefaultStore();
  }

  private saveToDisk(): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const encrypted = keyManager.encrypt(this.data);
    fs.writeFileSync(this.storePath, JSON.stringify(encrypted, null, 2), "utf-8");
  }

  addOrUpdateAccount(token: StoredToken | UnifiedToken): void {
    // Explicitly handle mapping if it's a UnifiedToken
    const stored: StoredToken = {
      provider: token.provider || AIProvider.GOOGLE_GEMINI,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      email: token.email,
      projectId: token.projectId,
      createdAt: token.createdAt || Date.now(),
    };

    const existingIndex = this.data.accounts.findIndex(
      (a) => a.email === stored.email,
    );

    if (existingIndex >= 0) {
      this.data.accounts[existingIndex] = stored;
    } else {
      this.data.accounts.push(stored);
      this.data.activeIndex = this.data.accounts.length - 1;
    }

    accountCache.set(stored.email, stored);
    this.saveToDisk();
  }

  removeAccount(email: string): boolean {
    const existingIndex = this.data.accounts.findIndex((a) => a.email === email);
    if (existingIndex >= 0) {
      this.data.accounts.splice(existingIndex, 1);
      accountCache.delete(email);
      if (this.data.activeIndex >= this.data.accounts.length) {
        this.data.activeIndex = Math.max(0, this.data.accounts.length - 1);
      }
      this.saveToDisk();
      return true;
    }
    return false;
  }

  getActiveToken(): StoredToken | null {
    if (this.data.accounts.length === 0) return null;
    const idx = Math.min(this.data.activeIndex, this.data.accounts.length - 1);
    return this.data.accounts[idx] ?? null;
  }

  getAllAccounts(): StoredToken[] {
    return [...this.data.accounts];
  }

  setActiveAccountByEmail(email: string): boolean {
    const account = accountCache.get(email);
    if (account) {
      const index = this.data.accounts.findIndex(a => a.email === email);
      if (index >= 0) {
        this.data.activeIndex = index;
        this.saveToDisk();
        return true;
      }
    }
    return false;
  }

  hasValidToken(): boolean {
    const token = this.getActiveToken();
    if (!token) return false;
    return !this.isTokenExpired(token);
  }

  isTokenExpired(token: StoredToken): boolean {
    if (token.expiresAt === 0) return false; // Never expires (API keys)
    return Date.now() >= token.expiresAt - TOKEN_REFRESH_BUFFER_MS;
  }

  async refreshActiveToken(): Promise<StoredToken | null> {
    const token = this.getActiveToken();
    if (!token) return null;

    // Use email as lock key
    const lockKey = token.email || "default";

    if (this.refreshInProgress.has(lockKey)) {
      return this.refreshInProgress.get(lockKey)!;
    }

    const refreshPromise = this.refreshLock.acquire(lockKey, async () => {
      try {
        const { getProviderAdapter } = await import("./provider-registry");
        const adapter = getProviderAdapter(token.provider);

        // If adapter doesn't support refresh or it's an API key (expiresAt=0), skip
        if (token.expiresAt === 0 || !token.refreshToken) {
          return token;
        }

        const refreshed = await adapter.refreshToken(token as UnifiedToken);
        const storedRefreshed: StoredToken = {
          ...token,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || token.refreshToken,
          expiresAt: refreshed.expiresAt,
        };

        this.addOrUpdateAccount(storedRefreshed);
        return storedRefreshed;
      } catch (error) {
        console.error("[TokenStore] Token refresh error:", error);
        return null;
      } finally {
        this.refreshInProgress.delete(lockKey);
      }
    });

    this.refreshInProgress.set(lockKey, refreshPromise);
    return refreshPromise;
  }

  async getValidAccessToken(): Promise<string | null> {
    let token = this.getActiveToken();
    if (!token) return null;

    if (this.isTokenExpired(token)) {
      token = await this.refreshActiveToken();
      if (!token) return null;
    }

    return token.accessToken;
  }

  clear(): void {
    this.data = getDefaultStore();
    this.saveToDisk();
  }
}

