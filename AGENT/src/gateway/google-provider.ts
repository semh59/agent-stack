/**
 * Google Antigravity Auth Provider
 *
 * Wraps the existing Google OAuth 2.0 + PKCE infrastructure
 * into a ProviderAdapter for the unified dual-provider architecture.
 *
 * Auth Flow (existing, wrapped):
 *   1. authorizeAntigravity() → OAuth consent URL
 *   2. User approves → callback with code
 *   3. exchangeAntigravity(code, state) → tokens
 *   4. Wrap in UnifiedToken
 */

import { authorizeAntigravity, exchangeAntigravity } from "../antigravity/oauth";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  GEMINI_CLI_HEADERS,
} from "../constants";
import {
  AIProvider,
  GOOGLE_ANTIGRAVITY_MODELS,
  type ProviderAdapter,
  type ProviderModel,
  type ProviderQuota,
  type UnifiedToken,
} from "./provider-types";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 min buffer

export class GoogleAntigravityProvider implements ProviderAdapter {
  readonly provider = AIProvider.GOOGLE_ANTIGRAVITY;

  /**
   * Generate the Google OAuth consent URL.
   * Delegates to existing authorizeAntigravity().
   */
  async getAuthUrl(): Promise<{ url: string; state: string }> {
    const result = await authorizeAntigravity();
    return {
      url: result.url,
      state: result.state,
    };
  }

  /**
   * Exchange auth code for tokens.
   * Delegates to existing exchangeAntigravity().
   */
  async exchangeCode(code: string, state: string): Promise<UnifiedToken> {
    const result = await exchangeAntigravity(code, state);

    if (result.type === "failed") {
      throw new Error(`Google OAuth exchange failed: ${result.error}`);
    }

    const now = Date.now();

    return {
      provider: AIProvider.GOOGLE_ANTIGRAVITY,
      accessToken: result.access,
      refreshToken: result.refresh,
      expiresAt: result.expires,
      email: result.email || "",
      projectId: result.projectId,
      createdAt: now,
      availableModels: GOOGLE_ANTIGRAVITY_MODELS,
    };
  }

  /**
   * Refresh expired access token using Google's token endpoint.
   */
  async refreshToken(token: UnifiedToken): Promise<UnifiedToken> {
    if (!token.refreshToken) {
      throw new Error("No refresh token available for Google Antigravity");
    }

    let actualRefreshToken = token.refreshToken;
    let projectId = token.projectId || "";

    // Handle composite refresh token format: "refreshToken|projectId"
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
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        refresh_token: actualRefreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google token refresh failed: ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      projectId,
    };
  }

  /**
   * Check if token is still valid (with 5-min buffer).
   */
  isTokenValid(token: UnifiedToken): boolean {
    if (!token.accessToken) return false;
    return Date.now() < token.expiresAt - TOKEN_REFRESH_BUFFER_MS;
  }

  getAvailableModels(): ProviderModel[] {
    return [...GOOGLE_ANTIGRAVITY_MODELS];
  }

  async getQuota(_token: UnifiedToken): Promise<ProviderQuota | null> {
    // Google Antigravity doesn't expose quota via API headers.
    // We track it locally via BudgetTracker.
    return null;
  }
}
