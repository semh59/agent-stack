"use strict";
/**
 * Provider Types â€” Unified interface for all AI providers.
 *
 * Both Google Alloy and Claude Code auth flows produce
 * tokens that conform to this interface. The rest of the system
 * (gateway, orchestrator, model router) works with these types only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROQ_MODELS = exports.SAMBANOVA_MODELS = exports.CLAUDE_CODE_MODELS = exports.GOOGLE_GEMINI_MODELS = exports.AIProvider = void 0;
exports.getAllModels = getAllModels;
exports.invalidateModelCache = invalidateModelCache;
exports.getModelsByProvider = getModelsByProvider;
exports.findModelById = findModelById;
exports.getModelForTier = getModelForTier;
// â”€â”€â”€ Provider Enum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.AIProvider = {
    GOOGLE_GEMINI: "google_gemini",
    CLAUDE_CODE: "claude_code",
    SAMBANOVA: "sambanova",
    GROQ: "groq",
    TOGETHER: "together",
    FIREWORKS: "fireworks",
};
// â”€â”€â”€ Model Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.GOOGLE_GEMINI_MODELS = [
    {
        id: "google/Alloy-gemini-3-flash",
        name: "Gemini 3 Flash",
        provider: exports.AIProvider.GOOGLE_GEMINI,
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
        provider: exports.AIProvider.GOOGLE_GEMINI,
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
        provider: exports.AIProvider.GOOGLE_GEMINI,
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
        provider: exports.AIProvider.GOOGLE_GEMINI,
        maxTokens: 128_000,
        supportsStreaming: true,
        supportsThinking: true,
        costPer1kInput: 0.0,
        costPer1kOutput: 0.0,
        tier: "ultimate",
    },
];
exports.CLAUDE_CODE_MODELS = [
    {
        // Fastest, cheapest — ideal for simple edits, completions, quick Q&A
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        provider: exports.AIProvider.CLAUDE_CODE,
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
        provider: exports.AIProvider.CLAUDE_CODE,
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
        provider: exports.AIProvider.CLAUDE_CODE,
        maxTokens: 200_000,
        supportsStreaming: true,
        supportsThinking: true,
        costPer1kInput: 0.015,
        costPer1kOutput: 0.075,
        tier: "powerful",
    },
];
exports.SAMBANOVA_MODELS = [
    {
        id: "sambanova/Meta-Llama-3.1-70B-Instruct",
        name: "Llama 3.1 70B (SambaNova)",
        provider: exports.AIProvider.SAMBANOVA,
        maxTokens: 64_000,
        supportsStreaming: true,
        supportsThinking: false,
        costPer1kInput: 0.0,
        costPer1kOutput: 0.0,
        tier: "fast",
    },
];
exports.GROQ_MODELS = [
    {
        id: "groq/llama-3.1-70b-versatile",
        name: "Llama 3.1 70B (Groq)",
        provider: exports.AIProvider.GROQ,
        maxTokens: 32_768,
        supportsStreaming: true,
        supportsThinking: false,
        costPer1kInput: 0.0,
        costPer1kOutput: 0.0,
        tier: "fast",
    },
];
/** Cached model list (hot path — called by ModelRouter on every route) */
let _allModelsCache = null;
/** Get all models across all providers (memoized). Call invalidateModelCache() after dynamic changes. */
function getAllModels() {
    if (!_allModelsCache) {
        _allModelsCache = [
            ...exports.GOOGLE_GEMINI_MODELS,
            ...exports.CLAUDE_CODE_MODELS,
            ...exports.SAMBANOVA_MODELS,
            ...exports.GROQ_MODELS,
        ];
    }
    return _allModelsCache;
}
/** Invalidate the model cache (call when model list changes at runtime) */
function invalidateModelCache() {
    _allModelsCache = null;
}
/** Get models for a specific provider */
function getModelsByProvider(provider) {
    if (provider === exports.AIProvider.GOOGLE_GEMINI)
        return [...exports.GOOGLE_GEMINI_MODELS];
    if (provider === exports.AIProvider.CLAUDE_CODE)
        return [...exports.CLAUDE_CODE_MODELS];
    if (provider === exports.AIProvider.SAMBANOVA)
        return [...exports.SAMBANOVA_MODELS];
    if (provider === exports.AIProvider.GROQ)
        return [...exports.GROQ_MODELS];
    return [];
}
/** Find a model by ID across all providers */
function findModelById(modelId) {
    return getAllModels().find((m) => m.id === modelId);
}
/** Get the best model for a given tier and provider */
function getModelForTier(tier, provider) {
    const models = provider ? getModelsByProvider(provider) : getAllModels();
    return models.find((m) => m.tier === tier);
}
//# sourceMappingURL=provider-types.js.map