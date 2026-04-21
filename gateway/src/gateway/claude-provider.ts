/**
 * Claude Code Auth Provider â€” OAuth + API Key Dual Mode
 *
 * Authenticates with Anthropic's Claude Code via:
 *   1. OAuth (primary) â€” Claude Code's native OAuth flow
 *   2. API Key (fallback) â€” direct API key validation
 *
 * Auth Flow (OAuth):
 *   1. Redirect user to Claude Code consent page
 *   2. Callback with authorization code
 *   3. Exchange code for access_token + refresh_token
 *   4. Wrap in UnifiedToken
 *
 * Auth Flow (API Key Fallback):
 *   1. User provides Claude API key
 *   2. Validate against Anthropic API
 *   3. Wrap in UnifiedToken (no refresh, never expires)
 */

import { randomBytes } from "node:crypto";
import {
  AIProvider,
  CLAUDE_CODE_MODELS,
  type ProviderAdapter,
  type ProviderModel,
  type ProviderQuota,
  type UnifiedToken,
} from "./provider-types";

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Claude Code OAuth endpoints  
const CLAUDE_OAUTH_AUTHORIZE = "https://console.anthropic.com/oauth/authorize";
const CLAUDE_OAUTH_TOKEN = "https://console.anthropic.com/oauth/token";

// OAuth client config â€” set via env vars in production
const CLAUDE_CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID ?? "";
const CLAUDE_CLIENT_SECRET = process.env.CLAUDE_OAUTH_CLIENT_SECRET ?? "";
const CLAUDE_REDIRECT_URI = process.env.CLAUDE_OAUTH_REDIRECT_URI ?? "http://localhost:51121/oauth-callback";
const CLAUDE_SCOPES = "read write";

// Key prefix detection
const CLAUDE_PRO_KEY_PREFIX = "sk-ant-";
const CLAUDE_ADMIN_KEY_PREFIX = "sk-admin-";

// â”€â”€â”€ Auth Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ClaudeAuthMode = "oauth" | "api_key";

// â”€â”€â”€ Claude Provider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class ClaudeCodeProvider implements ProviderAdapter {
  readonly provider = AIProvider.CLAUDE_CODE;
  private authMode: ClaudeAuthMode;

  constructor(mode?: ClaudeAuthMode) {
    // Auto-detect: if OAuth client is configured, use OAuth; otherwise API key
    this.authMode = mode ?? (CLAUDE_CLIENT_ID ? "oauth" : "api_key");
  }

  getAuthMode(): ClaudeAuthMode {
    return this.authMode;
  }

  setAuthMode(mode: ClaudeAuthMode): void {
    this.authMode = mode;
  }

  /**
   * Generate auth URL.
   * - OAuth mode: redirect to Claude Code consent page
   * - API Key mode: return a special URL that the UI renders as an input form
   */
  async getAuthUrl(): Promise<{ url: string; state: string }> {
    const state = randomBytes(32).toString("hex");

    if (this.authMode === "oauth" && CLAUDE_CLIENT_ID) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: CLAUDE_CLIENT_ID,
        redirect_uri: CLAUDE_REDIRECT_URI,
        scope: CLAUDE_SCOPES,
        state,
      });
      return {
        url: `${CLAUDE_OAUTH_AUTHORIZE}?${params.toString()}`,
        state,
      };
    }

    // API Key fallback â€” UI shows an input form
    return {
      url: `alloy://auth/claude-code?mode=api_key&state=${state}`,
      state,
    };
  }

  /**
   * Exchange authorization code (or API key) for tokens.
   *
   * @param code - OAuth auth code OR API key (depending on mode)
   * @param state - CSRF state
   */
  async exchangeCode(code: string, state: string): Promise<UnifiedToken> {
    const value = code.trim();
    if (!value) {
      throw new Error("Claude auth code/key is required");
    }

    // API key mode: starts with sk-ant- or sk-admin-
    if (this.isApiKey(value)) {
      return this.exchangeApiKey(value);
    }

    // OAuth mode: exchange authorization code for tokens
    return this.exchangeOAuthCode(value, state);
  }

  /**
   * Refresh token.
   * - OAuth mode: use refresh_token grant
   * - API key mode: re-validate the key
   */
  async refreshToken(token: UnifiedToken): Promise<UnifiedToken> {
    // API keys don't need refresh (they don't expire)
    if (!token.refreshToken) {
      const validation = await this.validateApiKey(token.accessToken);
      if (!validation.valid) {
        throw new Error("Claude API key has been revoked or is invalid");
      }
      return { ...token, quota: validation.quota ?? token.quota };
    }

    // OAuth token refresh
    return this.refreshOAuthToken(token);
  }

  /**
   * Check if token is valid.
   * - API keys (expiresAt = 0): always valid if present
   * - OAuth tokens: check expiry
   */
  isTokenValid(token: UnifiedToken): boolean {
    if (!token.accessToken) return false;
    if (token.expiresAt === 0) return true; // API key â€” never expires
    const buffer = 5 * 60 * 1000; // 5 min buffer
    return Date.now() < token.expiresAt - buffer;
  }

  getAvailableModels(): ProviderModel[] {
    return [...CLAUDE_CODE_MODELS];
  }

  async getQuota(token: UnifiedToken): Promise<ProviderQuota | null> {
    try {
      const validation = await this.validateApiKey(token.accessToken);
      return validation.quota ?? null;
    } catch {
      return null;
    }
  }

  // â”€â”€â”€ OAuth Flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async exchangeOAuthCode(code: string, _state: string): Promise<UnifiedToken> {
    const response = await fetch(CLAUDE_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: CLAUDE_CLIENT_ID,
        client_secret: CLAUDE_CLIENT_SECRET,
        redirect_uri: CLAUDE_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude OAuth token exchange failed: ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    // Fetch user profile to get email
    const profile = await this.fetchProfile(data.access_token);

    return {
      provider: AIProvider.CLAUDE_CODE,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      email: profile.email || "claude-oauth@anthropic",
      projectId: profile.organizationId,
      createdAt: Date.now(),
      availableModels: CLAUDE_CODE_MODELS,
    };
  }

  private async refreshOAuthToken(token: UnifiedToken): Promise<UnifiedToken> {
    const response = await fetch(CLAUDE_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
        client_id: CLAUDE_CLIENT_ID,
        client_secret: CLAUDE_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude OAuth token refresh failed: ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || token.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  private async fetchProfile(accessToken: string): Promise<{
    email: string;
    organizationId?: string;
  }> {
    try {
      const response = await fetch(`${ANTHROPIC_API_BASE}/v1/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          email?: string;
          organization_id?: string;
        };
        return {
          email: data.email || "",
          organizationId: data.organization_id,
        };
      }
    } catch {
      // Profile endpoint might not exist â€” graceful fallback
    }
    return { email: "" };
  }

  // â”€â”€â”€ API Key Flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async exchangeApiKey(apiKey: string): Promise<UnifiedToken> {
    const validation = await this.validateApiKey(apiKey);
    if (!validation.valid) {
      throw new Error(`Invalid Claude API key: ${validation.error}`);
    }

    const keyType = this.detectKeyType(apiKey);

    return {
      provider: AIProvider.CLAUDE_CODE,
      accessToken: apiKey,
      refreshToken: "", // API keys don't have refresh tokens
      expiresAt: 0, // API keys don't expire
      email: validation.email || "claude-user@alloy.ai",
      projectId: validation.organizationId,
      createdAt: Date.now(),
      availableModels: CLAUDE_CODE_MODELS,
      quota: validation.quota ?? undefined,
    };
  }

  private async validateApiKey(apiKey: string): Promise<{
    valid: boolean;
    error?: string;
    email?: string;
    organizationId?: string;
    quota?: ProviderQuota;
  }> {
    try {
      const response = await fetch(`${ANTHROPIC_API_BASE}/v1/models`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 401) return { valid: false, error: "Invalid API key" };
      if (response.status === 403) return { valid: false, error: "Key lacks permissions" };

      if (!response.ok) {
        return { valid: true, email: `claude-${this.detectKeyType(apiKey)}@validated` };
      }

      const requestsRemaining = parseInt(
        response.headers.get("x-ratelimit-remaining-requests") || "-1",
        10,
      );
      const tokensRemaining = parseInt(
        response.headers.get("x-ratelimit-remaining-tokens") || "-1",
        10,
      );
      const resetAt = response.headers.get("x-ratelimit-reset-requests");

      const quota: ProviderQuota | undefined =
        requestsRemaining >= 0
          ? {
              requestsRemaining,
              tokensRemaining: tokensRemaining >= 0 ? tokensRemaining : 1_000_000,
              resetsAt: resetAt ? new Date(resetAt).getTime() : Date.now() + 60_000,
            }
          : undefined;

      return {
        valid: true,
        email: `claude-${this.detectKeyType(apiKey)}@anthropic`,
        quota,
      };
    } catch {
      // Network error: assume valid (can't verify, don't reject)
      return { valid: true, email: `claude-unvalidated@offline` };
    }
  }

  // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private isApiKey(value: string): boolean {
    return (
      value.startsWith(CLAUDE_PRO_KEY_PREFIX) ||
      value.startsWith(CLAUDE_ADMIN_KEY_PREFIX) ||
      value.startsWith("sk-")
    );
  }

  private detectKeyType(apiKey: string): string {
    if (apiKey.startsWith(CLAUDE_ADMIN_KEY_PREFIX)) return "admin";
    if (apiKey.startsWith(CLAUDE_PRO_KEY_PREFIX)) return "pro";
    return "standard";
  }
}
