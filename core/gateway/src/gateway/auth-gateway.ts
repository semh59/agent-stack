/**
 * Auth Gateway â€” Dual-Provider Authentication Orchestration
 *
 * Manages authentication across both Google Alloy and Claude Code.
 * Provides a unified interface for the Gateway server to:
 *   1. Initiate login for either provider
 *   2. Handle auth callbacks
 *   3. Store and retrieve unified tokens
 *   4. Auto-refresh expired tokens
 *   5. Switch between providers seamlessly
 */

import { GoogleGeminiProvider } from "./google-provider";
import { ClaudeCodeProvider } from "./claude-provider";
import {
  AIProvider,
  type ProviderAdapter,
  type ProviderModel,
  type UnifiedToken,
} from "./provider-types";
import type { TokenStore } from "./token-store";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AuthGatewayOptions {
  /** Token store for Google tokens (existing infrastructure) */
  tokenStore: TokenStore;
  /** Default provider if user hasn't chosen */
  defaultProvider?: AIProvider;
}

export interface AuthSession {
  provider: AIProvider;
  state: string;
  url: string;
  createdAt: number;
}

// â”€â”€â”€ Auth Gateway â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class AuthGateway {
  private readonly providers: Map<AIProvider, ProviderAdapter>;
  private readonly tokenStore: TokenStore;
  private readonly unifiedTokens: Map<string, UnifiedToken> = new Map();
  private readonly pendingAuthSessions: Map<string, AuthSession> = new Map();
  private activeProvider: AIProvider;

  constructor(options: AuthGatewayOptions) {
    this.tokenStore = options.tokenStore;
    this.activeProvider = options.defaultProvider ?? AIProvider.GOOGLE_GEMINI;

    // Register providers
    this.providers = new Map();
    this.providers.set(AIProvider.GOOGLE_GEMINI, new GoogleGeminiProvider());
    this.providers.set(AIProvider.CLAUDE_CODE, new ClaudeCodeProvider());

    // Hydrate existing Google tokens into unified format
    this.hydrateGoogleTokens();
  }

  // â”€â”€ Provider Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Get the currently active provider */
  getActiveProvider(): AIProvider {
    return this.activeProvider;
  }

  /** Switch the active provider */
  setActiveProvider(provider: AIProvider): boolean {
    if (!this.providers.has(provider)) return false;
    this.activeProvider = provider;
    return true;
  }

  /** Get all registered providers */
  getRegisteredProviders(): AIProvider[] {
    return [...this.providers.keys()];
  }

  /** Check if a specific provider has valid tokens */
  hasValidTokenForProvider(provider: AIProvider): boolean {
    for (const token of this.unifiedTokens.values()) {
      if (token.provider === provider) {
        const adapter = this.providers.get(provider);
        if (adapter?.isTokenValid(token)) return true;
      }
    }
    return false;
  }

  // â”€â”€ Auth Flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Initiate login for a specific provider.
   * Returns the auth URL and state for CSRF validation.
   */
  async initiateLogin(provider: AIProvider): Promise<AuthSession> {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const { url, state } = await adapter.getAuthUrl();
    const session: AuthSession = {
      provider,
      state,
      url,
      createdAt: Date.now(),
    };

    this.pendingAuthSessions.set(state, session);

    // Clean up old pending sessions (older than 15 min)
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [key, sess] of this.pendingAuthSessions) {
      if (sess.createdAt < cutoff) {
        this.pendingAuthSessions.delete(key);
      }
    }

    return session;
  }

  /**
   * Complete the auth flow with the code from the callback.
   */
  async completeLogin(code: string, state: string): Promise<UnifiedToken> {
    const session = this.pendingAuthSessions.get(state);
    if (!session) {
      throw new Error("Invalid or expired auth state (CSRF check failed)");
    }

    this.pendingAuthSessions.delete(state);

    const adapter = this.providers.get(session.provider);
    if (!adapter) {
      throw new Error(`Provider not found: ${session.provider}`);
    }

    const token = await adapter.exchangeCode(code, state);

    // Store the unified token
    this.unifiedTokens.set(token.email, token);
    this.activeProvider = session.provider;

    // For Google, also sync to the legacy TokenStore
    if (session.provider === AIProvider.GOOGLE_GEMINI) {
      this.tokenStore.addOrUpdateAccount(token);
    }

    return token;
  }

  // â”€â”€ Token Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Get a valid access token for the active provider, auto-refreshing if needed */
  async getValidToken(): Promise<UnifiedToken | null> {
    return this.getValidTokenForProvider(this.activeProvider);
  }

  /** Get a valid token for a specific provider */
  async getValidTokenForProvider(provider: AIProvider): Promise<UnifiedToken | null> {
    const adapter = this.providers.get(provider);
    if (!adapter) return null;

    // Find a token for this provider
    for (const [key, token] of this.unifiedTokens) {
      if (token.provider !== provider) continue;

      if (adapter.isTokenValid(token)) {
        return token;
      }

      // Try to refresh
      try {
        const refreshed = await adapter.refreshToken(token);
        this.unifiedTokens.set(key, refreshed);

        // Sync Google refreshes to legacy store
        if (provider === AIProvider.GOOGLE_GEMINI) {
          this.tokenStore.addOrUpdateAccount(refreshed);
        }

        return refreshed;
      } catch (error) {
        console.error(
          `[AuthGateway] Token refresh failed for ${provider}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return null;
  }

  /** Get all stored tokens */
  getAllTokens(): UnifiedToken[] {
    return [...this.unifiedTokens.values()];
  }

  /** Get tokens grouped by provider */
  getTokensByProvider(): Map<AIProvider, UnifiedToken[]> {
    const grouped = new Map<AIProvider, UnifiedToken[]>();
    for (const token of this.unifiedTokens.values()) {
      const list = grouped.get(token.provider) ?? [];
      list.push(token);
      grouped.set(token.provider, list);
    }
    return grouped;
  }

  /** Remove a token by email */
  removeToken(email: string): boolean {
    const token = this.unifiedTokens.get(email);
    if (!token) return false;

    this.unifiedTokens.delete(email);

    // Also remove from legacy store if Google
    if (token.provider === AIProvider.GOOGLE_GEMINI) {
      this.tokenStore.removeAccount(email);
    }

    return true;
  }

  // â”€â”€ Model Access â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Get all models available with current valid tokens */
  getAvailableModels(): ProviderModel[] {
    const models: ProviderModel[] = [];
    for (const [provider, adapter] of this.providers) {
      if (this.hasValidTokenForProvider(provider)) {
        models.push(...adapter.getAvailableModels());
      }
    }
    return models;
  }

  /** Get the best model for a given tier, considering available providers */
  getBestModelForTier(tier: ProviderModel["tier"]): ProviderModel | null {
    const activeAdapter = this.providers.get(this.activeProvider);
    if (activeAdapter && this.hasValidTokenForProvider(this.activeProvider)) {
      const model = activeAdapter.getAvailableModels().find((m) => m.tier === tier);
      if (model) return model;
    }

    // Fallback to any available provider
    for (const [provider, adapter] of this.providers) {
      if (provider === this.activeProvider) continue;
      if (!this.hasValidTokenForProvider(provider)) continue;
      const model = adapter.getAvailableModels().find((m) => m.tier === tier);
      if (model) return model;
    }

    return null;
  }

  // â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Convert existing Google TokenStore entries to UnifiedTokens.
   * Called once at construction to bridge the legacy system.
   */
  private hydrateGoogleTokens(): void {
    const accounts = this.tokenStore.getAllAccounts();
    for (const account of accounts) {
      if (!account.email) continue;

      const unified: UnifiedToken = {
        provider: AIProvider.GOOGLE_GEMINI,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        expiresAt: account.expiresAt,
        email: account.email,
        projectId: account.projectId,
        createdAt: account.createdAt,
        availableModels: this.providers.get(AIProvider.GOOGLE_GEMINI)?.getAvailableModels() ?? [],
      };
      this.unifiedTokens.set(account.email, unified);
    }
  }
}
