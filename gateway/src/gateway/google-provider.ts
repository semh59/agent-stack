import { AIProvider, type ProviderAdapter, type ProviderModel, type ProviderQuota, type UnifiedToken, GOOGLE_GEMINI_MODELS } from "./provider-types";
import { authorizeGoogleGemini, exchangeGoogleGemini } from "../google-gemini/oauth";
import { calculateTokenExpiry } from "../plugin/auth";

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly provider = AIProvider.GOOGLE_GEMINI;

  async getAuthUrl(): Promise<{ url: string; state: string }> {
    const auth = await authorizeGoogleGemini();
    return { url: auth.url, state: auth.state };
  }

  async exchangeCode(code: string, state: string): Promise<UnifiedToken> {
    const result = await exchangeGoogleGemini(code, state);
    if (result.type === "failed") {
      throw new Error(result.error);
    }

    return {
      provider: this.provider,
      accessToken: result.access,
      refreshToken: result.refresh,
      expiresAt: result.expires,
      email: result.email || "gemini-user@alloy.ai",
      projectId: result.projectId,
      createdAt: Date.now(),
      availableModels: GOOGLE_GEMINI_MODELS,
    };
  }

  async refreshToken(token: UnifiedToken): Promise<UnifiedToken> {
    // Current TokenStore handles refresh for Google, 
    // but in a unified world, we might want to move it here.
    // For now, we'll keep the existing logic in TokenStore if needed,
    // or implement it here as well.
    return token; 
  }

  isTokenValid(token: UnifiedToken): boolean {
    const buffer = 5 * 60 * 1000;
    return Date.now() < token.expiresAt - buffer;
  }

  getAvailableModels(): ProviderModel[] {
    return [...GOOGLE_GEMINI_MODELS];
  }

  async getQuota(token: UnifiedToken): Promise<ProviderQuota | null> {
    // Google doesn't have a simple quota API in the same way Claude does via headers on this specific flow,
    // but we can add logic here later.
    return null;
  }
}
