/**
 * Provider Types â€” Unified interface for all AI providers.
 *
 * Both Google Alloy and Claude Code auth flows produce
 * tokens that conform to this interface. The rest of the system
 * (gateway, orchestrator, model router) works with these types only.
 */

// â”€â”€â”€ Provider Enum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const AIProvider = {
  GOOGLE_GEMINI: "google_gemini",
  CLAUDE_CODE: "claude_code",
} as const;

export type AIProvider = (typeof AIProvider)[keyof typeof AIProvider];

// â”€â”€â”€ Unified Token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface UnifiedToken {
  /** Which provider this token belongs to */
  provider: AIProvider;
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for token renewal (may be empty for API key auth) */
  refreshToken: string;
  /** Expiry time in Unix ms (0 = never expires, e.g. API key) */
  expiresAt: number;
  /** User email or identifier */
  email: string;
  /** Provider-specific project/workspace ID */
  projectId?: string;
  /** When this token was first stored */
  createdAt: number;
  /** Models available through this provider */
  availableModels: ProviderModel[];
  /** Current quota/usage info */
  quota?: ProviderQuota;
}

export interface ProviderModel {
  id: string;
  name: string;
  provider: AIProvider;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
  tier: "fast" | "balanced" | "powerful" | "ultimate";
}

export interface ProviderQuota {
  requestsRemaining: number;
  tokensRemaining: number;
  resetsAt: number;
}

// â”€â”€â”€ Provider Adapter Interface â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ProviderAdapter {
  /** Provider identifier */
  readonly provider: AIProvider;

  /** Generate the OAuth/auth URL for login */
  getAuthUrl(): Promise<{ url: string; state: string }>;

  /** Exchange auth code for tokens */
  exchangeCode(code: string, state: string): Promise<UnifiedToken>;

  /** Refresh an expired token */
  refreshToken(token: UnifiedToken): Promise<UnifiedToken>;

  /** Check if a token is still valid */
  isTokenValid(token: UnifiedToken): boolean;

  /** List available models for this provider */
  getAvailableModels(): ProviderModel[];

  /** Get current quota information */
  getQuota(token: UnifiedToken): Promise<ProviderQuota | null>;
}

// â”€â”€â”€ Model Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const GOOGLE_GEMINI_MODELS: ProviderModel[] = [
  {
    id: "google/Alloy-gemini-3-flash",
    name: "Gemini 3 Flash",
    provider: AIProvider.GOOGLE_GEMINI,
    maxTokens: 32_768,
    supportsStreaming: true,
    supportsThinking: false,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
    tier: "fast",
  },
  {
    id: "google/Alloy-gemini-3-1-pro-high",
    name: "Gemini 3.1 Pro (High)",
    provider: AIProvider.GOOGLE_GEMINI,
    maxTokens: 65_536,
    supportsStreaming: true,
    supportsThinking: true,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
    tier: "balanced",
  },
  {
    id: "google/Alloy-claude-sonnet-4-6-thinking",
    name: "Claude Sonnet 4.6 (via AG)",
    provider: AIProvider.GOOGLE_GEMINI,
    maxTokens: 64_000,
    supportsStreaming: true,
    supportsThinking: true,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
    tier: "powerful",
  },
  {
    id: "google/Alloy-claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 (via AG)",
    provider: AIProvider.GOOGLE_GEMINI,
    maxTokens: 128_000,
    supportsStreaming: true,
    supportsThinking: true,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
    tier: "ultimate",
  },
];

export const CLAUDE_CODE_MODELS: ProviderModel[] = [
  {
    // Fastest, cheapest — ideal for simple edits, completions, quick Q&A
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: AIProvider.CLAUDE_CODE,
    maxTokens: 200_000,
    supportsStreaming: true,
    supportsThinking: false,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
    tier: "fast",
  },
  {
    // Best balance — strong coding, extended thinking, 200k context
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: AIProvider.CLAUDE_CODE,
    maxTokens: 200_000,
    supportsStreaming: true,
    supportsThinking: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    tier: "balanced",
  },
  {
    // Most capable — complex reasoning, large refactors, architecture
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: AIProvider.CLAUDE_CODE,
    maxTokens: 200_000,
    supportsStreaming: true,
    supportsThinking: true,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    tier: "powerful",
  },
];

/** Cached model list (hot path — called by ModelRouter on every route) */
let _allModelsCache: ProviderModel[] | null = null;

/** Get all models across all providers (memoized). Call invalidateModelCache() after dynamic changes. */
export function getAllModels(): ProviderModel[] {
  if (!_allModelsCache) {
    _allModelsCache = [...GOOGLE_GEMINI_MODELS, ...CLAUDE_CODE_MODELS];
  }
  return _allModelsCache;
}

/** Invalidate the model cache (call when model list changes at runtime) */
export function invalidateModelCache(): void {
  _allModelsCache = null;
}

/** Get models for a specific provider */
export function getModelsByProvider(provider: AIProvider): ProviderModel[] {
  if (provider === AIProvider.GOOGLE_GEMINI) return [...GOOGLE_GEMINI_MODELS];
  if (provider === AIProvider.CLAUDE_CODE) return [...CLAUDE_CODE_MODELS];
  return [];
}

/** Find a model by ID across all providers */
export function findModelById(modelId: string): ProviderModel | undefined {
  return getAllModels().find((m) => m.id === modelId);
}

/** Get the best model for a given tier and provider */
export function getModelForTier(
  tier: ProviderModel["tier"],
  provider?: AIProvider,
): ProviderModel | undefined {
  const models = provider ? getModelsByProvider(provider) : getAllModels();
  return models.find((m) => m.tier === tier);
}
