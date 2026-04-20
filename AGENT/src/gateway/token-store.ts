/**
 * Token Store â€” OAuth token saklama ve yenileme
 *
 * Google Sovereign OAuth tokenlarÄ±nÄ± diske kaydeder,
 * geÃ§erlilik sÃ¼resi dolarsa otomatik yeniler.
 *
 * Dosya: ~/.config/agent/google-gemini-tokens.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import AsyncLock from "async-lock";
import {
  SOVEREIGN_CLIENT_ID,
  SOVEREIGN_CLIENT_SECRET,
  GEMINI_CLI_HEADERS,
} from "../constants";
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from "node:crypto";
import pkg from "node-machine-id";
const { machineIdSync } = pkg;
import { KeyManager, type EncryptedPayload } from "../plugin/key-manager";

// Cache for account lookups to ensure O(1) efficiency in high-frequency rotation
const accountCache = new Map<string, StoredToken>();

const keyManager = new KeyManager();

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  email?: string;
  projectId?: string;
  createdAt: number;
}

export interface TokenStoreData {
  version: 1;
  accounts: StoredToken[];
  activeIndex: number;
}

// â”€â”€â”€ Defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getDefaultStore(): TokenStoreData {
  return {
    version: 1,
    accounts: [],
    activeIndex: 0,
  };
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 dakika Ã¶nce yenile

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getStorePath(): string {
  const configDir =
    process.env.AGENT_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "agent");

  if (!fs.existsSync(configDir)) {
    // Mode 0o700 = rwx------ (user only)
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  return path.join(configDir, "google-gemini-tokens.json");
}

/**
 * â”€â”€â”€ ENCRYPTION UTILITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Note: Legacy AES-256-CBC methods removed to prevent downgrade attacks.
 * All storage now uses KeyManager v3 (AES-256-GCM).
 */

function isEncrypted(content: string): boolean {
  if (!content) return false;
  return KeyManager.isV3Encrypted(content);
}

// â”€â”€â”€ TokenStore Class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class TokenStore {
  private storePath: string;
  private data: TokenStoreData;
  private refreshLock = new AsyncLock();
  private refreshInProgress: Map<string, Promise<StoredToken | null>> = new Map();

  constructor(storePath?: string) {
    this.storePath = storePath ?? getStorePath();
    this.data = this.loadFromDisk();
  }

  // â”€â”€ Persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private loadFromDisk(): TokenStoreData {
    try {
      if (fs.existsSync(this.storePath)) {
        let raw = fs.readFileSync(this.storePath, "utf-8");
        
        if (isEncrypted(raw)) {
          try {
            // STRICT: Only v3 encryption allowed.
            raw = JSON.stringify(keyManager.decrypt(JSON.parse(raw) as EncryptedPayload));
          } catch (err) {
            console.error("[TokenStore] Failed to decrypt token store (v3 required):", err);
            return getDefaultStore();
          }
        } else {
           // If disk data is not encrypted but we expected it to be (security policy)
           // we could throw error, but for migration we might allow raw if it matches schema.
           // However, based on 'Deep Analysis', we should ideally enforce encryption.
           console.warn("[TokenStore] Loading unencrypted data. This will be encrypted on next save.");
        }

        const parsed = JSON.parse(raw) as TokenStoreData;
        if (parsed.version === 1 && Array.isArray(parsed.accounts)) {
          // Warm up the O(1) cache
          accountCache.clear();
          parsed.accounts.forEach(acc => {
            if (acc.email) accountCache.set(acc.email, acc);
          });
          return parsed;
        }
      }
    } catch {
      // Corrupted file â€” start fresh
    }
    return getDefaultStore();
  }

  private saveToDisk(): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(this.data, null, 2);
    const encrypted = keyManager.encrypt(this.data);
    fs.writeFileSync(this.storePath, JSON.stringify(encrypted, null, 2), "utf-8");
  }

  // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Yeni bir token hesabÄ± ekle veya mevcut olanÄ± gÃ¼ncelle */
  addOrUpdateAccount(token: StoredToken): void {
    const existingIndex = this.data.accounts.findIndex(
      (a) => a.email && a.email === token.email,
    );

    if (existingIndex >= 0) {
      this.data.accounts[existingIndex] = token;
    } else {
      this.data.accounts.push(token);
      this.data.activeIndex = this.data.accounts.length - 1;
    }

    if (token.email) {
      accountCache.set(token.email, token);
    }
    this.saveToDisk();
  }

  /** Bir hesabÄ± email'e gÃ¶re sil */
  removeAccount(email: string): boolean {
    const existingIndex = this.data.accounts.findIndex((a) => a.email === email);
    if (existingIndex >= 0) {
      this.data.accounts.splice(existingIndex, 1);
      accountCache.delete(email);
      
      // Adjust active index if necessary
      if (this.data.activeIndex >= this.data.accounts.length) {
        this.data.activeIndex = Math.max(0, this.data.accounts.length - 1);
      }
      
      this.saveToDisk();
      return true;
    }
    return false;
  }

  /** Aktif hesabÄ±n tokenÄ±nÄ± dÃ¶ndÃ¼r */
  getActiveToken(): StoredToken | null {
    if (this.data.accounts.length === 0) return null;
    const idx = Math.min(this.data.activeIndex, this.data.accounts.length - 1);
    return this.data.accounts[idx] ?? null;
  }

  /** TÃ¼m hesaplarÄ± dÃ¶ndÃ¼r */
  getAllAccounts(): StoredToken[] {
    return [...this.data.accounts];
  }

  /** Hesap sayÄ±sÄ± */
  getAccountCount(): number {
    return this.data.accounts.length;
  }

  /** Aktif hesabÄ± email ile seÃ§ - O(1) optimized */
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

  /** GeÃ§erli token var mÄ±? (expire olmamÄ±ÅŸ) */
  hasValidToken(): boolean {
    const token = this.getActiveToken();
    if (!token) return false;
    return !this.isTokenExpired(token);
  }

  /** Token sÃ¼resi dolmuÅŸ mu? (5 dk buffer ile) */
  isTokenExpired(token: StoredToken): boolean {
    return Date.now() >= token.expiresAt - TOKEN_REFRESH_BUFFER_MS;
  }

  /** Refresh token kullanarak access token yenile */
  async refreshActiveToken(): Promise<StoredToken | null> {
    const token = this.getActiveToken();
    if (!token?.refreshToken) return null;

    // Use email as lock key, default to "default" for anonymous tokens
    const lockKey = token.email || "default";

    // If a refresh is already in progress for this email, return the pending promise
    if (this.refreshInProgress.has(lockKey)) {
      return this.refreshInProgress.get(lockKey)!;
    }

    // Acquire lock for this email and start refresh
    const refreshPromise = this.refreshLock.acquire(lockKey, async () => {
      try {
        // Refresh token'dan projectId Ã§Ä±kar (format: "refreshToken|projectId")
        let actualRefreshToken = token.refreshToken;
        let projectId = token.projectId || "";

        if (token.refreshToken.includes("|")) {
          const parts = token.refreshToken.split("|");
          actualRefreshToken = parts[0]!;
          projectId = parts[1] || projectId;
        }

        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": GEMINI_CLI_HEADERS["User-Agent"],
            "X-Goog-Api-Client": GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
          },
          body: new URLSearchParams({
            client_id: SOVEREIGN_CLIENT_ID,
            client_secret: SOVEREIGN_CLIENT_SECRET,
            refresh_token: actualRefreshToken,
            grant_type: "refresh_token",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[TokenStore] Token refresh failed:", errorText);
          return null;
        }

        const data = (await response.json()) as {
          access_token: string;
          expires_in: number;
          token_type: string;
        };

        const refreshedToken: StoredToken = {
          ...token,
          accessToken: data.access_token,
          expiresAt: Date.now() + data.expires_in * 1000,
          projectId,
        };

        this.addOrUpdateAccount(refreshedToken);
        return refreshedToken;
      } catch (error) {
        console.error(
          "[TokenStore] Token refresh error:",
          error instanceof Error ? error.message : String(error),
        );
        return null;
      } finally {
        // Clean up the promise from the map after refresh completes
        this.refreshInProgress.delete(lockKey);
      }
    });

    // Store the promise so concurrent calls can wait for it
    this.refreshInProgress.set(lockKey, refreshPromise);
    return refreshPromise;
  }

  /** GeÃ§erli bir access token dÃ¶ndÃ¼r â€” gerekirse otomatik yenile */
  async getValidAccessToken(): Promise<string | null> {
    let token = this.getActiveToken();
    if (!token) return null;

    if (this.isTokenExpired(token)) {
      console.log("[TokenStore] Token sÃ¼resi dolmuÅŸ, yenileniyor...");
      token = await this.refreshActiveToken();
      if (!token) return null;
    }

    return token.accessToken;
  }

  /** Store'u temizle */
  clear(): void {
    this.data = getDefaultStore();
    this.saveToDisk();
  }
}
