import {
  AIProvider,
  type ProviderAdapter,
  type ProviderModel,
  type ProviderQuota,
  type UnifiedToken,
  getModelsByProvider,
} from "./provider-types";

/**
 * GenericKeyProvider — handles all providers that only require a static API key.
 */
export class GenericKeyProvider implements ProviderAdapter {
  constructor(public readonly provider: AIProvider) {}

  async getAuthUrl(): Promise<{ url: string; state: string }> {
    // These providers don't have OAuth flows in our gateway yet.
    // We return a simple "pseudo-auth" URL that the UI can use to prompt for an API key.
    const origin = process.env.VITE_GATEWAY_URL || "http://localhost:5173";
    return {
      url: `${origin}/#/auth/generic?provider=${this.provider}&mode=api_key`,
      state: "nop",
    };
  }

  async exchangeCode(code: string, _state: string): Promise<UnifiedToken> {
    // For generic providers, "code" is actually the raw API key passed from the UI
    const apiKey = code.trim();
    if (!apiKey) throw new Error(`${this.provider} API key is required`);

    return {
      provider: this.provider,
      accessToken: apiKey,
      refreshToken: "",
      expiresAt: 0, // Never expires
      email: `${this.provider}-user@alloy.ai`,
      createdAt: Date.now(),
      availableModels: this.getAvailableModels(),
    };
  }

  async refreshToken(token: UnifiedToken): Promise<UnifiedToken> {
    return token; // API keys don't refresh
  }

  isTokenValid(token: UnifiedToken): boolean {
    return !!token.accessToken;
  }

  getAvailableModels(): ProviderModel[] {
    return getModelsByProvider(this.provider);
  }

  async getQuota(_token: UnifiedToken): Promise<ProviderQuota | null> {
    return null;
  }
}
