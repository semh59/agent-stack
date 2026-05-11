"use strict";
/**
 * Transform Module Index
 *
 * Re-exports transform functions and types for request transformation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripClaudeThinkingFields = exports.stripGeminiThinkingMetadata = exports.getCrossModelFamily = exports.sanitizeCrossModelPayloadInPlace = exports.sanitizeCrossModelPayload = exports.applyGeminiTransforms = exports.normalizeGeminiTools = exports.buildImageGenerationConfig = exports.buildGemini25ThinkingConfig = exports.buildGemini3ThinkingConfig = exports.isImageGenerationModel = exports.isGemini25Model = exports.isGemini3Model = exports.isGeminiModel = exports.CLAUDE_INTERLEAVED_THINKING_HINT = exports.CLAUDE_THINKING_MAX_OUTPUT_TOKENS = exports.applyClaudeTransforms = exports.normalizeClaudeTools = exports.appendClaudeThinkingHint = exports.ensureClaudeMaxOutputTokens = exports.buildClaudeThinkingConfig = exports.configureClaudeToolConfig = exports.isClaudeThinkingModel = exports.isClaudeModel = exports.GEMINI_3_THINKING_LEVELS = exports.THINKING_TIER_BUDGETS = exports.MODEL_FALLBACKS = exports.MODEL_ALIASES = exports.getModelFamily = exports.resolveModelForHeaderStyle = exports.resolveModelWithVariant = exports.resolveModelWithTier = void 0;
// Model resolution
var model_resolver_1 = require("./model-resolver");
Object.defineProperty(exports, "resolveModelWithTier", { enumerable: true, get: function () { return model_resolver_1.resolveModelWithTier; } });
Object.defineProperty(exports, "resolveModelWithVariant", { enumerable: true, get: function () { return model_resolver_1.resolveModelWithVariant; } });
Object.defineProperty(exports, "resolveModelForHeaderStyle", { enumerable: true, get: function () { return model_resolver_1.resolveModelForHeaderStyle; } });
Object.defineProperty(exports, "getModelFamily", { enumerable: true, get: function () { return model_resolver_1.getModelFamily; } });
Object.defineProperty(exports, "MODEL_ALIASES", { enumerable: true, get: function () { return model_resolver_1.MODEL_ALIASES; } });
Object.defineProperty(exports, "MODEL_FALLBACKS", { enumerable: true, get: function () { return model_resolver_1.MODEL_FALLBACKS; } });
Object.defineProperty(exports, "THINKING_TIER_BUDGETS", { enumerable: true, get: function () { return model_resolver_1.THINKING_TIER_BUDGETS; } });
Object.defineProperty(exports, "GEMINI_3_THINKING_LEVELS", { enumerable: true, get: function () { return model_resolver_1.GEMINI_3_THINKING_LEVELS; } });
// Claude transforms
var claude_1 = require("./claude");
Object.defineProperty(exports, "isClaudeModel", { enumerable: true, get: function () { return claude_1.isClaudeModel; } });
Object.defineProperty(exports, "isClaudeThinkingModel", { enumerable: true, get: function () { return claude_1.isClaudeThinkingModel; } });
Object.defineProperty(exports, "configureClaudeToolConfig", { enumerable: true, get: function () { return claude_1.configureClaudeToolConfig; } });
Object.defineProperty(exports, "buildClaudeThinkingConfig", { enumerable: true, get: function () { return claude_1.buildClaudeThinkingConfig; } });
Object.defineProperty(exports, "ensureClaudeMaxOutputTokens", { enumerable: true, get: function () { return claude_1.ensureClaudeMaxOutputTokens; } });
Object.defineProperty(exports, "appendClaudeThinkingHint", { enumerable: true, get: function () { return claude_1.appendClaudeThinkingHint; } });
Object.defineProperty(exports, "normalizeClaudeTools", { enumerable: true, get: function () { return claude_1.normalizeClaudeTools; } });
Object.defineProperty(exports, "applyClaudeTransforms", { enumerable: true, get: function () { return claude_1.applyClaudeTransforms; } });
Object.defineProperty(exports, "CLAUDE_THINKING_MAX_OUTPUT_TOKENS", { enumerable: true, get: function () { return claude_1.CLAUDE_THINKING_MAX_OUTPUT_TOKENS; } });
Object.defineProperty(exports, "CLAUDE_INTERLEAVED_THINKING_HINT", { enumerable: true, get: function () { return claude_1.CLAUDE_INTERLEAVED_THINKING_HINT; } });
// Gemini transforms
var gemini_1 = require("./gemini");
Object.defineProperty(exports, "isGeminiModel", { enumerable: true, get: function () { return gemini_1.isGeminiModel; } });
Object.defineProperty(exports, "isGemini3Model", { enumerable: true, get: function () { return gemini_1.isGemini3Model; } });
Object.defineProperty(exports, "isGemini25Model", { enumerable: true, get: function () { return gemini_1.isGemini25Model; } });
Object.defineProperty(exports, "isImageGenerationModel", { enumerable: true, get: function () { return gemini_1.isImageGenerationModel; } });
Object.defineProperty(exports, "buildGemini3ThinkingConfig", { enumerable: true, get: function () { return gemini_1.buildGemini3ThinkingConfig; } });
Object.defineProperty(exports, "buildGemini25ThinkingConfig", { enumerable: true, get: function () { return gemini_1.buildGemini25ThinkingConfig; } });
Object.defineProperty(exports, "buildImageGenerationConfig", { enumerable: true, get: function () { return gemini_1.buildImageGenerationConfig; } });
Object.defineProperty(exports, "normalizeGeminiTools", { enumerable: true, get: function () { return gemini_1.normalizeGeminiTools; } });
Object.defineProperty(exports, "applyGeminiTransforms", { enumerable: true, get: function () { return gemini_1.applyGeminiTransforms; } });
// Cross-model sanitization
var cross_model_sanitizer_1 = require("./cross-model-sanitizer");
Object.defineProperty(exports, "sanitizeCrossModelPayload", { enumerable: true, get: function () { return cross_model_sanitizer_1.sanitizeCrossModelPayload; } });
Object.defineProperty(exports, "sanitizeCrossModelPayloadInPlace", { enumerable: true, get: function () { return cross_model_sanitizer_1.sanitizeCrossModelPayloadInPlace; } });
Object.defineProperty(exports, "getCrossModelFamily", { enumerable: true, get: function () { return cross_model_sanitizer_1.getModelFamily; } });
Object.defineProperty(exports, "stripGeminiThinkingMetadata", { enumerable: true, get: function () { return cross_model_sanitizer_1.stripGeminiThinkingMetadata; } });
Object.defineProperty(exports, "stripClaudeThinkingFields", { enumerable: true, get: function () { return cross_model_sanitizer_1.stripClaudeThinkingFields; } });
//# sourceMappingURL=index.js.map