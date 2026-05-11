"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAndFixClaudeToolPairing = exports.createSyntheticErrorResponse = exports.injectToolHardeningInstruction = exports.applyToolPairingFixes = exports.matchResponseIdsToContents = exports.assignToolIdsToContents = exports.injectParameterSignatures = exports.detectToolIdMismatches = exports.DEFAULT_THINKING_BUDGET = exports.ThinkingConfigSchema = exports.AlloyUsageMetadataSchema = exports.AlloyApiBodySchema = exports.AlloyApiErrorSchema = exports.cleanJSONSchemaForAlloy = void 0;
exports.isThinkingCapableModel = isThinkingCapableModel;
exports.extractThinkingConfig = extractThinkingConfig;
exports.extractVariantThinkingConfig = extractVariantThinkingConfig;
exports.resolveThinkingConfig = resolveThinkingConfig;
exports.stripAllThinkingBlocks = stripAllThinkingBlocks;
exports.filterUnsignedThinkingBlocks = filterUnsignedThinkingBlocks;
exports.filterMessagesThinkingBlocks = filterMessagesThinkingBlocks;
exports.deepFilterThinkingBlocks = deepFilterThinkingBlocks;
exports.detectShadowThinkingBlocks = detectShadowThinkingBlocks;
exports.transformThinkingParts = transformThinkingParts;
exports.normalizeThinkingConfig = normalizeThinkingConfig;
exports.parseAlloyApiBody = parseAlloyApiBody;
exports.extractUsageMetadata = extractUsageMetadata;
exports.extractUsageFromSsePayload = extractUsageFromSsePayload;
exports.rewriteAlloyPreviewAccessError = rewriteAlloyPreviewAccessError;
exports.isEmptyResponseBody = isEmptyResponseBody;
exports.isMeaningfulSseLine = isMeaningfulSseLine;
exports.recursivelyParseJsonStrings = recursivelyParseJsonStrings;
exports.fixToolResponseGrouping = fixToolResponseGrouping;
const zod_1 = require("zod");
const config_1 = require("./config");
const logger_1 = require("./logger");
const constants_1 = require("../constants");
const image_saver_1 = require("./image-saver");
const log = (0, logger_1.createLogger)("request-helpers");
const ALLOY_PREVIEW_LINK = "https://docs.alloy.dev/preview-features";
var json_schema_cleaner_1 = require("./transform/json-schema-cleaner");
Object.defineProperty(exports, "cleanJSONSchemaForAlloy", { enumerable: true, get: function () { return json_schema_cleaner_1.cleanJSONSchemaForAlloy; } });
exports.AlloyApiErrorSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).and(zod_1.z.object({
    code: zod_1.z.number().optional(),
    message: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
}));
/**
 * Minimal representation of Alloy API responses we touch.
 */
exports.AlloyApiBodySchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).and(zod_1.z.object({
    response: zod_1.z.unknown().optional(),
    error: exports.AlloyApiErrorSchema.optional(),
}));
/**
 * Usage metadata exposed by Alloy responses. Fields are optional to reflect partial payloads.
 */
exports.AlloyUsageMetadataSchema = zod_1.z.object({
    totalTokenCount: zod_1.z.number().optional(),
    promptTokenCount: zod_1.z.number().optional(),
    candidatesTokenCount: zod_1.z.number().optional(),
    cachedContentTokenCount: zod_1.z.number().optional(),
    thoughtsTokenCount: zod_1.z.number().optional(),
});
/**
 * Normalized thinking configuration accepted by Alloy.
 */
exports.ThinkingConfigSchema = zod_1.z.object({
    thinkingBudget: zod_1.z.number().optional(),
    includeThoughts: zod_1.z.boolean().optional(),
});
/**
 * Default token budget for thinking/reasoning. 16000 tokens provides sufficient
 * space for complex reasoning while staying within typical model limits.
 */
exports.DEFAULT_THINKING_BUDGET = 16000;
/**
 * Checks if a model name indicates thinking/reasoning capability.
 * Models with "thinking", "gemini-3", or "opus" in their name support extended thinking.
 */
function isThinkingCapableModel(modelName) {
    const lowerModel = modelName.toLowerCase();
    return lowerModel.includes("thinking")
        || lowerModel.includes("gemini-3")
        || lowerModel.includes("opus");
}
/**
 * Extracts thinking configuration from various possible request locations.
 * Supports both Gemini-style thinkingConfig and Anthropic-style thinking options.
 */
function extractThinkingConfig(requestPayload, rawGenerationConfig, extraBody) {
    const thinkingConfig = rawGenerationConfig?.thinkingConfig
        ?? extraBody?.thinkingConfig
        ?? requestPayload.thinkingConfig;
    if (thinkingConfig && typeof thinkingConfig === "object") {
        const config = thinkingConfig;
        return {
            includeThoughts: Boolean(config.includeThoughts),
            thinkingBudget: typeof config.thinkingBudget === "number" ? config.thinkingBudget : exports.DEFAULT_THINKING_BUDGET,
        };
    }
    // Convert Anthropic-style "thinking" option: { type: "enabled", budgetTokens: N }
    const anthropicThinking = extraBody?.thinking ?? requestPayload.thinking;
    if (anthropicThinking && typeof anthropicThinking === "object") {
        const thinking = anthropicThinking;
        if (thinking.type === "enabled" || thinking.budgetTokens) {
            return {
                includeThoughts: true,
                thinkingBudget: typeof thinking.budgetTokens === "number" ? thinking.budgetTokens : exports.DEFAULT_THINKING_BUDGET,
            };
        }
    }
    return undefined;
}
/**
 * Extracts variant thinking config from Alloy's providerOptions.
 *
 * All Alloy models route through the Google provider, so we only check
 * providerOptions.google. Supports two formats:
 *
 * 1. Gemini 3 native: { google: { thinkingLevel: "high", includeThoughts: true } }
 * 2. Budget-based (Claude/Gemini 2.5): { google: { thinkingConfig: { thinkingBudget: 32000 } } }
 */
function extractVariantThinkingConfig(providerOptions) {
    if (!providerOptions)
        return undefined;
    const google = providerOptions.google;
    if (!google)
        return undefined;
    const result = {};
    // Gemini 3 native format: { google: { thinkingLevel: "high", includeThoughts: true } }
    // thinkingLevel takes priority over thinkingBudget - they are mutually exclusive
    if (typeof google.thinkingLevel === "string") {
        result.thinkingLevel = google.thinkingLevel;
        result.includeThoughts = typeof google.includeThoughts === "boolean" ? google.includeThoughts : undefined;
    }
    else if (google.thinkingConfig && typeof google.thinkingConfig === "object") {
        // Budget-based format (Claude/Gemini 2.5): { google: { thinkingConfig: { thinkingBudget } } }
        // Only used when thinkingLevel is not present
        const tc = google.thinkingConfig;
        if (typeof tc.thinkingBudget === "number") {
            result.thinkingBudget = tc.thinkingBudget;
        }
    }
    // Extract Google Search config
    if (google.googleSearch && typeof google.googleSearch === "object") {
        const search = google.googleSearch;
        result.googleSearch = {
            mode: search.mode === 'auto' || search.mode === 'off' ? search.mode : undefined,
            threshold: typeof search.threshold === 'number' ? search.threshold : undefined,
        };
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
/**
 * Determines the final thinking configuration based on model capabilities and user settings.
 * For Claude thinking models, we keep thinking enabled even in multi-turn conversations.
 * The filterUnsignedThinkingBlocks function will handle signature validation/restoration.
 */
function resolveThinkingConfig(userConfig, isThinkingModel, _isClaudeModel, _hasAssistantHistory) {
    // For thinking-capable models (including Claude thinking models), enable thinking by default
    // The signature validation/restoration is handled by filterUnsignedThinkingBlocks
    if (isThinkingModel && !userConfig) {
        return { includeThoughts: true, thinkingBudget: exports.DEFAULT_THINKING_BUDGET };
    }
    return userConfig;
}
/**
 * Checks if a part is a thinking/reasoning block (Anthropic or Gemini style).
 */
function isThinkingPart(part) {
    return part.type === "thinking"
        || part.type === "redacted_thinking"
        || part.type === "reasoning"
        || part.thinking !== undefined
        || part.thought === true;
}
/**
 * Checks if a part has a signature field (thinking block signature).
 * Used to detect foreign thinking blocks that might have unknown type values.
 */
function hasSignatureField(part) {
    return part.signature !== undefined || part.thoughtSignature !== undefined;
}
/**
 * Checks if a part is a tool block (tool_use or tool_result).
 * Tool blocks must never be filtered - they're required for tool call/result pairing.
 * Handles multiple formats:
 * - Anthropic: { type: "tool_use" }, { type: "tool_result", tool_use_id }
 * - Nested: { tool_result: { tool_use_id } }, { tool_use: { id } }
 * - Gemini: { functionCall }, { functionResponse }
 */
function isToolBlock(part) {
    return part.type === "tool_use"
        || part.type === "tool_result"
        || part.tool_use_id !== undefined
        || part.tool_call_id !== undefined
        || part.tool_result !== undefined
        || part.tool_use !== undefined
        || part.toolUse !== undefined
        || part.functionCall !== undefined
        || part.functionResponse !== undefined;
}
/**
 * Unconditionally strips ALL thinking/reasoning blocks from a content array.
 * Used for Claude models to avoid signature validation errors entirely.
 * Claude will generate fresh thinking for each turn.
 */
function stripAllThinkingBlocks(contentArray) {
    return contentArray.filter(item => {
        if (!item || typeof item !== "object")
            return true;
        const block = item;
        if (isToolBlock(block))
            return true;
        if (isThinkingPart(block))
            return false;
        if (hasSignatureField(block))
            return false;
        return true;
    });
}
/**
 * Removes trailing thinking blocks from a content array.
 * Claude API requires that assistant messages don't end with thinking blocks.
 * Only removes unsigned thinking blocks; preserves those with valid signatures.
 */
function removeTrailingThinkingBlocks(contentArray, sessionId, getCachedSignatureFn) {
    const result = [...contentArray];
    while (result.length > 0) {
        const lastPart = result[result.length - 1];
        if (!lastPart || typeof lastPart !== "object")
            break;
        const block = lastPart;
        if (!isThinkingPart(block))
            break;
        const isValid = sessionId && getCachedSignatureFn
            ? isOurCachedSignature(block, sessionId, getCachedSignatureFn)
            : hasValidSignature(block);
        if (isValid) {
            break;
        }
        result.pop();
    }
    return result;
}
/**
 * Checks if a thinking part has a valid signature.
 * A valid signature is a non-empty string with at least 50 characters.
 */
function hasValidSignature(part) {
    const signature = part.thought === true ? part.thoughtSignature : part.signature;
    return typeof signature === "string" && signature.length >= 50;
}
/**
 * Gets the signature from a thinking part, if present.
 */
function getSignature(part) {
    const signature = part.thought === true ? part.thoughtSignature : part.signature;
    return typeof signature === "string" ? signature : undefined;
}
/**
 * Checks if a thinking part's signature was generated by our plugin (exists in our cache).
 * This prevents accepting signatures from other providers (e.g., direct Anthropic API, OpenAI)
 * which would cause "Invalid signature" errors when sent to Alloy Claude.
 */
function isOurCachedSignature(part, sessionId, getCachedSignatureFn) {
    if (!sessionId || !getCachedSignatureFn) {
        return false;
    }
    const text = getThinkingText(part);
    if (!text) {
        return false;
    }
    const partSignature = getSignature(part);
    if (!partSignature) {
        return false;
    }
    const cachedSignature = getCachedSignatureFn(sessionId, text);
    return cachedSignature === partSignature;
}
/**
 * Gets the text content from a thinking part.
 */
function getThinkingText(part) {
    if (typeof part.text === "string")
        return part.text;
    if (typeof part.thinking === "string")
        return part.thinking;
    if (part.text && typeof part.text === "object") {
        const maybeText = part.text.text;
        if (typeof maybeText === "string")
            return maybeText;
    }
    if (part.thinking && typeof part.thinking === "object") {
        const maybeText = part.thinking.text ?? part.thinking.thinking;
        if (typeof maybeText === "string")
            return maybeText;
    }
    return "";
}
/**
 * Recursively strips cache_control and providerOptions from any object.
 * These fields can be injected by SDKs, but Claude rejects them inside thinking blocks.
 */
function stripCacheControlRecursively(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj !== "object")
        return obj;
    if (Array.isArray(obj))
        return obj.map(item => stripCacheControlRecursively(item));
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key === "cache_control" || key === "providerOptions")
            continue;
        result[key] = stripCacheControlRecursively(value);
    }
    return result;
}
/**
 * Sanitizes a thinking part by keeping only the allowed fields.
 * In particular, ensures `thinking` is a string (not an object with cache_control).
 * Returns null if the thinking block has no valid content.
 */
function sanitizeThinkingPart(part) {
    // Gemini-style thought blocks: { thought: true, text, thoughtSignature }
    if (part.thought === true) {
        let textContent = part.text;
        if (typeof textContent === "object" && textContent !== null) {
            const maybeText = textContent.text;
            textContent = typeof maybeText === "string" ? maybeText : undefined;
        }
        const hasContent = typeof textContent === "string" && textContent.trim().length > 0;
        if (!hasContent && !part.thoughtSignature) {
            return null;
        }
        const sanitized = { thought: true };
        if (textContent !== undefined)
            sanitized.text = textContent;
        if (part.thoughtSignature !== undefined)
            sanitized.thoughtSignature = part.thoughtSignature;
        return sanitized;
    }
    // Anthropic-style thinking/redacted_thinking blocks: { type: "thinking"|"redacted_thinking", thinking, signature }
    if (part.type === "thinking" || part.type === "redacted_thinking" || part.thinking !== undefined) {
        let thinkingContent = part.thinking ?? part.text;
        if (thinkingContent !== undefined && typeof thinkingContent === "object" && thinkingContent !== null) {
            const maybeText = thinkingContent.text ?? thinkingContent.thinking;
            thinkingContent = typeof maybeText === "string" ? maybeText : undefined;
        }
        const hasContent = typeof thinkingContent === "string" && thinkingContent.trim().length > 0;
        if (!hasContent && !part.signature) {
            return null;
        }
        const sanitized = { type: part.type === "redacted_thinking" ? "redacted_thinking" : "thinking" };
        if (thinkingContent !== undefined)
            sanitized.thinking = thinkingContent;
        if (part.signature !== undefined)
            sanitized.signature = part.signature;
        return sanitized;
    }
    // Reasoning blocks (Alloy format): { type: "reasoning", text, signature }
    if (part.type === "reasoning") {
        let textContent = part.text;
        if (typeof textContent === "object" && textContent !== null) {
            const maybeText = textContent.text;
            textContent = typeof maybeText === "string" ? maybeText : undefined;
        }
        const hasContent = typeof textContent === "string" && textContent.trim().length > 0;
        if (!hasContent && !part.signature) {
            return null;
        }
        const sanitized = { type: "reasoning" };
        if (textContent !== undefined)
            sanitized.text = textContent;
        if (part.signature !== undefined)
            sanitized.signature = part.signature;
        return sanitized;
    }
    // Fallback: strip cache_control recursively.
    return stripCacheControlRecursively(part);
}
function findLastAssistantIndex(contents, roleValue) {
    for (let i = contents.length - 1; i >= 0; i--) {
        const content = contents[i];
        if (content && typeof content === "object" && content.role === roleValue) {
            return i;
        }
    }
    return -1;
}
function filterContentArray(contentArray, sessionId, getCachedSignatureFn, isClaudeModel, isLastAssistantMessage = false) {
    // For Claude models, strip thinking blocks by default for reliability
    // User can opt-in to keep thinking via config: { "keep_thinking": true }
    if (isClaudeModel && !(0, config_1.getKeepThinking)()) {
        return stripAllThinkingBlocks(contentArray);
    }
    const filtered = [];
    for (const item of contentArray) {
        if (!item || typeof item !== "object") {
            filtered.push(item);
            continue;
        }
        const block = item;
        if (isToolBlock(block)) {
            filtered.push(item);
            continue;
        }
        const isThinking = isThinkingPart(block);
        const hasSignature = hasSignatureField(block);
        if (!isThinking && !hasSignature) {
            filtered.push(item);
            continue;
        }
        // For the LAST assistant message with thinking blocks:
        // - If signature is OUR cached signature, pass through unchanged
        // - Otherwise inject sentinel to bypass Alloy validation
        if (isLastAssistantMessage && (isThinking || hasSignature)) {
            // First check if it's our cached signature
            if (isOurCachedSignature(block, sessionId, getCachedSignatureFn)) {
                const sanitized = sanitizeThinkingPart(block);
                if (sanitized)
                    filtered.push(sanitized);
                continue;
            }
            // Not our signature (or no signature) - inject sentinel
            const thinkingText = getThinkingText(block) || "";
            log.debug(`Injecting sentinel for last-message thinking block`);
            const sentinelPart = {
                type: block.type || "thinking",
                thinking: thinkingText,
                signature: constants_1.SKIP_THOUGHT_SIGNATURE,
            };
            filtered.push(sentinelPart);
            continue;
        }
        if (isOurCachedSignature(block, sessionId, getCachedSignatureFn)) {
            const sanitized = sanitizeThinkingPart(block);
            if (sanitized)
                filtered.push(sanitized);
            continue;
        }
        if (sessionId && getCachedSignatureFn) {
            const text = getThinkingText(block);
            if (text) {
                const cachedSignature = getCachedSignatureFn(sessionId, text);
                if (cachedSignature && cachedSignature.length >= 50) {
                    const restoredPart = { ...block };
                    if (block.thought === true) {
                        restoredPart.thoughtSignature = cachedSignature;
                    }
                    else {
                        restoredPart.signature = cachedSignature;
                    }
                    const sanitized = sanitizeThinkingPart(restoredPart);
                    if (sanitized)
                        filtered.push(sanitized);
                    continue;
                }
            }
        }
    }
    return filtered;
}
/**
 * Filters thinking blocks from contents unless the signature matches our cache.
 * Attempts to restore signatures from cache for thinking blocks that lack signatures.
 *
 * @param contents - The contents array from the request
 * @param sessionId - Optional session ID for signature cache lookup
 * @param getCachedSignatureFn - Optional function to retrieve cached signatures
 */
function filterUnsignedThinkingBlocks(contents, sessionId, getCachedSignatureFn, isClaudeModel) {
    const lastAssistantIdx = findLastAssistantIndex(contents, "model");
    return contents.map((content, idx) => {
        if (!content || typeof content !== "object") {
            return content;
        }
        const isLastAssistant = idx === lastAssistantIdx;
        if (Array.isArray(content.parts)) {
            const filteredParts = filterContentArray(content.parts, sessionId, getCachedSignatureFn, isClaudeModel, isLastAssistant);
            const trimmedParts = content.role === "model" && !isClaudeModel
                ? removeTrailingThinkingBlocks(filteredParts, sessionId, getCachedSignatureFn)
                : filteredParts;
            return { ...content, parts: trimmedParts };
        }
        if (Array.isArray(content.content)) {
            const isAssistantRole = content.role === "assistant";
            const isLastAssistantContent = idx === lastAssistantIdx ||
                (isAssistantRole && idx === findLastAssistantIndex(contents, "assistant"));
            const filteredContent = filterContentArray(content.content, sessionId, getCachedSignatureFn, isClaudeModel, isLastAssistantContent);
            const trimmedContent = isAssistantRole && !isClaudeModel
                ? removeTrailingThinkingBlocks(filteredContent, sessionId, getCachedSignatureFn)
                : filteredContent;
            return { ...content, content: trimmedContent };
        }
        return content;
    });
}
/**
 * Filters thinking blocks from Anthropic-style messages[] payloads using cached signatures.
 */
function filterMessagesThinkingBlocks(messages, sessionId, getCachedSignatureFn, isClaudeModel) {
    const lastAssistantIdx = findLastAssistantIndex(messages, "assistant");
    return messages.map((message, idx) => {
        if (!message || typeof message !== "object") {
            return message;
        }
        if (Array.isArray(message.content)) {
            const isAssistantRole = message.role === "assistant";
            const isLastAssistant = isAssistantRole && idx === lastAssistantIdx;
            const filteredContent = filterContentArray(message.content, sessionId, getCachedSignatureFn, isClaudeModel, isLastAssistant);
            const trimmedContent = isAssistantRole && !isClaudeModel
                ? removeTrailingThinkingBlocks(filteredContent, sessionId, getCachedSignatureFn)
                : filteredContent;
            return { ...message, content: trimmedContent };
        }
        return message;
    });
}
function deepFilterThinkingBlocks(payload, sessionId, getCachedSignatureFn, isClaudeModel) {
    const visited = new WeakSet();
    const walk = (value) => {
        if (!value || typeof value !== "object") {
            return;
        }
        if (visited.has(value)) {
            return;
        }
        visited.add(value);
        if (Array.isArray(value)) {
            value.forEach((item) => walk(item));
            return;
        }
        const obj = value;
        if (Array.isArray(obj.contents)) {
            obj.contents = filterUnsignedThinkingBlocks(obj.contents, sessionId, getCachedSignatureFn, isClaudeModel);
        }
        if (Array.isArray(obj.messages)) {
            obj.messages = filterMessagesThinkingBlocks(obj.messages, sessionId, getCachedSignatureFn, isClaudeModel);
        }
        Object.keys(obj).forEach((key) => walk(obj[key]));
    };
    walk(payload);
    // Second pass: Shadow Block Detector (strips deceptive thinking-like JSON from text parts)
    return detectShadowThinkingBlocks(payload);
}
/**
 * Shadow Block Detector: Detects and strips deceptive JSON objects that mimic
 * thinking blocks but are hidden within text parts. This prevents deceptive
 * thinking injection attacks.
 */
function detectShadowThinkingBlocks(payload) {
    const visited = new WeakSet();
    const walk = (value) => {
        if (!value || typeof value !== "object")
            return;
        if (visited.has(value))
            return;
        visited.add(value);
        if (Array.isArray(value)) {
            value.forEach((item, idx) => {
                if (typeof item === 'object' && item !== null) {
                    walk(item);
                }
                else if (typeof item === 'string') {
                    // Detect "Shadow" thinking block strings
                    if (isShadowThinkingString(item)) {
                        log.warn("Shadow thinking block detected and neutralized in array.");
                        value[idx] = "[REDACTED: SHADOW BLOCK]";
                    }
                }
            });
            return;
        }
        const obj = value;
        for (const [key, val] of Object.entries(obj)) {
            if (typeof val === 'string' && (key === 'text' || key === 'content')) {
                if (isShadowThinkingString(val)) {
                    log.warn(`Shadow thinking block detected in field "${key}" and neutralized.`);
                    obj[key] = "[REDACTED: SHADOW BLOCK]";
                }
            }
            else if (typeof val === 'object' && val !== null) {
                walk(val);
            }
        }
    };
    walk(payload);
    return payload;
}
function isShadowThinkingString(text) {
    const trimmed = text.trim();
    if (trimmed.length < 20)
        return false;
    // Check for common thinking block markers within non-thinking parts
    const indicators = [
        /"type":\s*"thinking"/,
        /"type":\s*"reasoning"/,
        /"thought":\s*true/,
        /"thoughtSignature":\s*"/,
        /"signature":\s*"/
    ];
    // If it's pure JSON and has any of these, it's a shadow block
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'object' && parsed !== null) {
                return indicators.some(regex => regex.test(trimmed));
            }
        }
        catch {
            // Not valid JSON, unlikely to be a shadow block unless it's a partial injection
        }
    }
    return false;
}
/**
 * Transforms Gemini-style thought parts (thought: true) and Anthropic-style
 * thinking parts (type: "thinking") to reasoning format.
 * Claude responses through Alloy may use candidates structure with Anthropic-style parts.
 */
function transformGeminiCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return candidate;
    }
    const content = candidate.content;
    if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
        return candidate;
    }
    const thinkingTexts = [];
    const transformedParts = content.parts.map((item) => {
        if (!item || typeof item !== "object") {
            return item;
        }
        const part = item;
        // Handle Gemini-style: thought: true
        if (part.thought === true) {
            const thinkingText = part.text || "";
            thinkingTexts.push(thinkingText);
            const transformed = { ...part, type: "reasoning" };
            if (part.cache_control)
                transformed.cache_control = part.cache_control;
            // Convert signature to providerMetadata format for Alloy
            const sig = part.signature || part.thoughtSignature;
            if (sig) {
                transformed.providerMetadata = {
                    anthropic: { signature: sig }
                };
                delete transformed.signature;
                delete transformed.thoughtSignature;
            }
            return transformed;
        }
        // Handle Anthropic-style in candidates: type: "thinking"
        if (part.type === "thinking") {
            const thinkingText = part.thinking || part.text || "";
            thinkingTexts.push(thinkingText);
            const transformed = {
                ...part,
                type: "reasoning",
                text: thinkingText,
                thought: true,
            };
            if (part.cache_control)
                transformed.cache_control = part.cache_control;
            // Convert signature to providerMetadata format for Alloy
            const sig = part.signature || part.thoughtSignature;
            if (sig) {
                transformed.providerMetadata = {
                    anthropic: { signature: sig }
                };
                delete transformed.signature;
                delete transformed.thoughtSignature;
            }
            return transformed;
        }
        // Handle functionCall: parse JSON strings in args and ensure args is always defined
        if (part.functionCall) {
            const fc = part.functionCall;
            const parsedArgs = fc.args
                ? recursivelyParseJsonStrings(fc.args)
                : {};
            return {
                ...part,
                functionCall: {
                    ...fc,
                    args: parsedArgs,
                },
            };
        }
        // Handle image data (inlineData) - save to disk and return file path
        if (part.inlineData) {
            const id = part.inlineData;
            const result = (0, image_saver_1.processImageData)({
                mimeType: id.mimeType,
                data: id.data,
            });
            if (result) {
                return { text: result };
            }
        }
        return part;
    });
    return {
        ...candidate,
        content: { ...content, parts: transformedParts },
        ...(thinkingTexts.length > 0 ? { reasoning_content: thinkingTexts.join("\n\n") } : {}),
    };
}
/**
 * Transforms thinking/reasoning content in response parts to Alloy's expected format.
 * Handles both Gemini-style (thought: true) and Anthropic-style (type: "thinking") formats.
 * Also extracts reasoning_content for Anthropic-style responses.
 */
function transformThinkingParts(response) {
    if (!response || typeof response !== "object") {
        return response;
    }
    const resp = response;
    const result = { ...resp };
    const reasoningTexts = [];
    // Handle Anthropic-style content array (type: "thinking")
    if (Array.isArray(resp.content)) {
        const transformedContent = [];
        for (const item of resp.content) {
            if (item && typeof item === "object" && item.type === "thinking") {
                const block = item;
                const thinkingText = block.thinking || block.text || "";
                reasoningTexts.push(thinkingText);
                const transformed = {
                    ...block,
                    type: "reasoning",
                    text: thinkingText,
                    thought: true,
                };
                // Convert signature to providerMetadata format for Alloy
                const sig = block.signature || block.thoughtSignature;
                if (sig) {
                    transformed.providerMetadata = {
                        anthropic: { signature: sig }
                    };
                    delete transformed.signature;
                    delete transformed.thoughtSignature;
                }
                transformedContent.push(transformed);
            }
            else {
                transformedContent.push(item);
            }
        }
        result.content = transformedContent;
    }
    // Handle Gemini-style candidates array
    if (Array.isArray(resp.candidates)) {
        result.candidates = resp.candidates.map(c => transformGeminiCandidate(c));
    }
    // Add reasoning_content if we found any thinking blocks (for Anthropic-style)
    if (reasoningTexts.length > 0 && !result.reasoning_content) {
        result.reasoning_content = reasoningTexts.join("\n\n");
    }
    return result;
}
/**
 * Ensures thinkingConfig is valid: includeThoughts only allowed when budget > 0.
 */
function normalizeThinkingConfig(config) {
    if (!config || typeof config !== "object") {
        return undefined;
    }
    const record = config;
    const budgetRaw = record.thinkingBudget ?? record.thinking_budget;
    const includeRaw = record.includeThoughts ?? record.include_thoughts;
    const thinkingBudget = typeof budgetRaw === "number" && Number.isFinite(budgetRaw) ? budgetRaw : undefined;
    const includeThoughts = typeof includeRaw === "boolean" ? includeRaw : undefined;
    const enableThinking = thinkingBudget !== undefined && thinkingBudget > 0;
    const finalInclude = enableThinking ? includeThoughts ?? false : false;
    if (!enableThinking && finalInclude === false && thinkingBudget === undefined && includeThoughts === undefined) {
        return undefined;
    }
    const normalized = {};
    if (thinkingBudget !== undefined) {
        normalized.thinkingBudget = thinkingBudget;
    }
    if (finalInclude !== undefined) {
        normalized.includeThoughts = finalInclude;
    }
    return normalized;
}
/**
 * Parses an Alloy API body; handles array-wrapped responses the API sometimes returns.
 */
function parseAlloyApiBody(rawText) {
    try {
        const parsed = JSON.parse(rawText);
        const target = Array.isArray(parsed)
            ? parsed.find((item) => typeof item === "object" && item !== null)
            : parsed;
        if (!target || typeof target !== "object") {
            return null;
        }
        const result = exports.AlloyApiBodySchema.safeParse(target);
        if (!result.success) {
            log.warn("Forensic validation failed for Alloy API body", {
                issues: result.error.issues,
                rawText: rawText.slice(0, 500),
            });
            // Fallback: return raw object if it has either 'response' or 'error' keys
            if ('response' in target || 'error' in target) {
                return target;
            }
            return null;
        }
        return result.data;
    }
    catch {
        return null;
    }
}
/**
 * Extracts usageMetadata from a response object, guarding types.
 */
function extractUsageMetadata(body) {
    const usage = (body.response && typeof body.response === "object"
        ? body.response.usageMetadata
        : undefined);
    if (!usage || typeof usage !== "object") {
        return null;
    }
    const asRecord = usage;
    const toNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
    return {
        totalTokenCount: toNumber(asRecord.totalTokenCount),
        promptTokenCount: toNumber(asRecord.promptTokenCount),
        candidatesTokenCount: toNumber(asRecord.candidatesTokenCount),
        cachedContentTokenCount: toNumber(asRecord.cachedContentTokenCount),
        thoughtsTokenCount: toNumber(asRecord.thoughtsTokenCount),
    };
}
/**
 * Walks SSE lines to find a usage-bearing response chunk.
 */
function extractUsageFromSsePayload(payload) {
    const lines = payload.split("\n");
    for (const line of lines) {
        if (!line.startsWith("data:")) {
            continue;
        }
        const jsonText = line.slice(5).trim();
        if (!jsonText) {
            continue;
        }
        try {
            const parsed = JSON.parse(jsonText);
            if (parsed && typeof parsed === "object") {
                const usage = extractUsageMetadata({ response: parsed.response });
                if (usage) {
                    return usage;
                }
            }
        }
        catch {
            continue;
        }
    }
    return null;
}
/**
 * Enhances 404 errors for Alloy models with a direct preview-access message.
 */
function rewriteAlloyPreviewAccessError(body, status, requestedModel) {
    if (!needsPreviewAccessOverride(status, body, requestedModel)) {
        return null;
    }
    const error = body.error ?? {};
    const trimmedMessage = typeof error.message === "string" ? error.message.trim() : "";
    const messagePrefix = trimmedMessage.length > 0
        ? trimmedMessage
        : "Alloy preview features are not enabled for this account.";
    const enhancedMessage = `${messagePrefix} Request preview access at ${ALLOY_PREVIEW_LINK} before using this model.`;
    return {
        ...body,
        error: {
            ...error,
            message: enhancedMessage,
        },
    };
}
function needsPreviewAccessOverride(status, body, requestedModel) {
    if (status !== 404) {
        return false;
    }
    if (isAlloyModel(requestedModel)) {
        return true;
    }
    const errorMessage = typeof body.error?.message === "string" ? body.error.message : "";
    return isAlloyModel(errorMessage);
}
function isAlloyModel(target) {
    if (!target) {
        return false;
    }
    return /alloy/i.test(target) || /opus/i.test(target) || /claude/i.test(target);
}
/**
 * Checks if a JSON response body represents an empty response.
 */
function isEmptyResponseBody(text) {
    if (!text || !text.trim()) {
        return true;
    }
    try {
        const parsed = JSON.parse(text);
        // Check for empty candidates
        if (parsed.candidates !== undefined) {
            if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
                return true;
            }
            const firstCandidate = parsed.candidates[0];
            if (!firstCandidate) {
                return true;
            }
            const content = firstCandidate.content;
            if (!content || typeof content !== "object") {
                return true;
            }
            const parts = content.parts;
            if (!Array.isArray(parts) || parts.length === 0) {
                return true;
            }
            const hasContent = parts.some((item) => {
                if (!item || typeof item !== "object")
                    return false;
                const part = item;
                if (typeof part.text === "string" && part.text.length > 0)
                    return true;
                if (part.functionCall)
                    return true;
                if (part.thought === true && typeof part.text === "string")
                    return true;
                return false;
            });
            if (!hasContent) {
                return true;
            }
        }
        // Check for empty choices (OpenAI format)
        if (parsed.choices !== undefined) {
            if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
                return true;
            }
            const firstChoice = parsed.choices[0];
            if (!firstChoice) {
                return true;
            }
            const message = (firstChoice.message || firstChoice.delta);
            if (!message) {
                return true;
            }
            if (!message.content && !message.tool_calls && !message.reasoning_content) {
                return true;
            }
        }
        // Check response wrapper
        if (parsed.response !== undefined) {
            const response = parsed.response;
            if (!response || typeof response !== "object" || visitedInEmptyCheck.has(response)) {
                return true;
            }
            visitedInEmptyCheck.add(response);
            return isEmptyResponseBody(JSON.stringify(response));
        }
        return false;
    }
    catch {
        return true;
    }
}
const visitedInEmptyCheck = new WeakSet();
/**
 * Checks if an SSE line contains meaningful content.
 */
function isMeaningfulSseLine(line) {
    if (!line.startsWith("data: ")) {
        return false;
    }
    const data = line.slice(6).trim();
    if (data === "[DONE]") {
        return false;
    }
    if (!data) {
        return false;
    }
    try {
        const parsed = JSON.parse(data);
        if (parsed.candidates && Array.isArray(parsed.candidates)) {
            for (const candidate of parsed.candidates) {
                const parts = candidate?.content?.parts;
                if (Array.isArray(parts) && parts.length > 0) {
                    for (const item of parts) {
                        const part = item;
                        if (typeof part?.text === "string" && part.text.length > 0)
                            return true;
                        if (part?.functionCall)
                            return true;
                    }
                }
            }
        }
        if (parsed.response?.candidates) {
            return isMeaningfulSseLine(`data: ${JSON.stringify(parsed.response)}`);
        }
        return false;
    }
    catch {
        return false;
    }
}
// ============================================================================
// RECURSIVE JSON STRING AUTO-PARSING (Ported from LLM-API-Key-Proxy)
// ============================================================================
// Keys whose string values should NOT be parsed as JSON
const SKIP_PARSE_KEYS = new Set([
    "oldString", "newString", "content", "filePath", "path", "text", "code",
    "source", "data", "body", "message", "prompt", "input", "output",
    "result", "value", "query", "pattern", "replacement", "template",
    "script", "command", "snippet",
]);
const MAX_RECURSIVE_DEPTH = 10;
function recursivelyParseJsonStrings(obj, skipParseKeys = SKIP_PARSE_KEYS, currentKey) {
    const seen = new WeakMap();
    return recursivelyParseJsonStringsInternal(obj, skipParseKeys, currentKey, seen, 0);
}
function recursivelyParseJsonStringsInternal(obj, skipParseKeys, currentKey, seen, depth) {
    if (depth > MAX_RECURSIVE_DEPTH) {
        return obj;
    }
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (Array.isArray(obj)) {
        const cached = seen.get(obj);
        if (cached)
            return cached;
        const result = [];
        seen.set(obj, result);
        for (const item of obj) {
            result.push(recursivelyParseJsonStringsInternal(item, skipParseKeys, undefined, seen, depth + 1));
        }
        return result;
    }
    if (typeof obj === "object") {
        const objectRef = obj;
        const cached = seen.get(objectRef);
        if (cached)
            return cached;
        const result = {};
        seen.set(objectRef, result);
        for (const [key, value] of Object.entries(objectRef)) {
            result[key] = recursivelyParseJsonStringsInternal(value, skipParseKeys, key, seen, depth + 1);
        }
        return result;
    }
    if (typeof obj !== "string") {
        return obj;
    }
    if (currentKey && skipParseKeys.has(currentKey)) {
        return obj;
    }
    const stripped = obj.trim();
    // Unescape control characters if present
    if ((obj.includes("\\n") || obj.includes("\\t")) && !obj.includes('\\"') && !obj.includes("\\\\")) {
        try {
            return JSON.parse(`"${obj}"`);
        }
        catch { /* Continue */ }
    }
    // Try parsing JSON strings
    if (stripped && (stripped[0] === "{" || stripped[0] === "[")) {
        try {
            let cleaned = stripped;
            if (stripped.startsWith("[") && !stripped.endsWith("]")) {
                const lastBracket = stripped.lastIndexOf("]");
                if (lastBracket > 0)
                    cleaned = stripped.slice(0, lastBracket + 1);
            }
            else if (stripped.startsWith("{") && !stripped.endsWith("}")) {
                const lastBrace = stripped.lastIndexOf("}");
                if (lastBrace > 0)
                    cleaned = stripped.slice(0, lastBrace + 1);
            }
            const parsed = JSON.parse(cleaned);
            if (parsed !== obj) {
                return recursivelyParseJsonStringsInternal(parsed, skipParseKeys, undefined, seen, depth + 1);
            }
        }
        catch { /* Continue */ }
    }
    return obj;
}
/**
 * Groups function calls with their responses, handling ID mismatches.
 */
function fixToolResponseGrouping(contents) {
    if (!Array.isArray(contents) || contents.length === 0) {
        return contents;
    }
    const newContents = [];
    const pendingGroups = [];
    const collectedResponses = new Map();
    for (const content of contents) {
        const role = content.role;
        const parts = content.parts || [];
        const responseParts = parts.filter((p) => p?.functionResponse);
        if (responseParts.length > 0) {
            for (const resp of responseParts) {
                const respId = resp.functionResponse?.id || "";
                if (respId && !collectedResponses.has(respId)) {
                    collectedResponses.set(respId, resp);
                }
            }
            for (let i = pendingGroups.length - 1; i >= 0; i--) {
                const group = pendingGroups[i];
                if (group.ids.every(id => collectedResponses.has(id))) {
                    const groupResponses = group.ids.map(id => {
                        const resp = collectedResponses.get(id);
                        collectedResponses.delete(id);
                        return resp;
                    });
                    newContents.push({ parts: groupResponses, role: "user" });
                    pendingGroups.splice(i, 1);
                    break;
                }
            }
            continue;
        }
        if (role === "model") {
            const funcCalls = parts.filter((p) => p?.functionCall);
            newContents.push(content);
            if (funcCalls.length > 0) {
                const callIds = funcCalls
                    .map((fc) => fc.functionCall?.id || "")
                    .filter(Boolean);
                const funcNames = funcCalls
                    .map((fc) => fc.functionCall?.name || "");
                if (callIds.length > 0) {
                    pendingGroups.push({
                        ids: callIds,
                        funcNames,
                        insertAfterIdx: newContents.length - 1,
                    });
                }
            }
        }
        else {
            newContents.push(content);
        }
    }
    pendingGroups.sort((a, b) => b.insertAfterIdx - a.insertAfterIdx);
    for (const group of pendingGroups) {
        const groupResponses = [];
        for (let i = 0; i < group.ids.length; i++) {
            const expectedId = group.ids[i];
            const expectedName = group.funcNames[i] || "";
            let matchedPart = null;
            if (collectedResponses.has(expectedId)) {
                matchedPart = collectedResponses.get(expectedId);
                collectedResponses.delete(expectedId);
            }
            else if (collectedResponses.size > 0) {
                let matchedId = null;
                for (const [orphanId, orphanResp] of collectedResponses) {
                    if (orphanResp.functionResponse?.name === expectedName) {
                        matchedId = orphanId;
                        break;
                    }
                }
                if (!matchedId) {
                    for (const [orphanId, orphanResp] of collectedResponses) {
                        if (orphanResp.functionResponse?.name === "unknown_function") {
                            matchedId = orphanId;
                            break;
                        }
                    }
                }
                if (!matchedId)
                    matchedId = collectedResponses.keys().next().value ?? null;
                if (matchedId) {
                    matchedPart = collectedResponses.get(matchedId);
                    collectedResponses.delete(matchedId);
                    if (matchedPart.functionResponse) {
                        matchedPart.functionResponse.id = expectedId;
                        if (matchedPart.functionResponse.name === "unknown_function" && expectedName) {
                            matchedPart.functionResponse.name = expectedName;
                        }
                    }
                }
            }
            if (matchedPart) {
                groupResponses.push(matchedPart);
            }
            else {
                groupResponses.push({
                    functionResponse: {
                        name: expectedName || "unknown_function",
                        response: {
                            result: {
                                error: "Tool response was lost during context processing. This is a recovered placeholder.",
                                recovered: true,
                            },
                        },
                        id: expectedId,
                    },
                });
            }
        }
        if (groupResponses.length > 0) {
            newContents.splice(group.insertAfterIdx + 1, 0, {
                parts: groupResponses,
                role: "user",
            });
        }
    }
    return newContents;
}
var tool_hardening_1 = require("./transform/tool-hardening");
Object.defineProperty(exports, "detectToolIdMismatches", { enumerable: true, get: function () { return tool_hardening_1.detectToolIdMismatches; } });
Object.defineProperty(exports, "injectParameterSignatures", { enumerable: true, get: function () { return tool_hardening_1.injectParameterSignatures; } });
Object.defineProperty(exports, "assignToolIdsToContents", { enumerable: true, get: function () { return tool_hardening_1.assignToolIdsToContents; } });
Object.defineProperty(exports, "matchResponseIdsToContents", { enumerable: true, get: function () { return tool_hardening_1.matchResponseIdsToContents; } });
Object.defineProperty(exports, "applyToolPairingFixes", { enumerable: true, get: function () { return tool_hardening_1.applyToolPairingFixes; } });
Object.defineProperty(exports, "injectToolHardeningInstruction", { enumerable: true, get: function () { return tool_hardening_1.injectToolHardeningInstruction; } });
Object.defineProperty(exports, "createSyntheticErrorResponse", { enumerable: true, get: function () { return tool_hardening_1.createSyntheticErrorResponse; } });
Object.defineProperty(exports, "validateAndFixClaudeToolPairing", { enumerable: true, get: function () { return tool_hardening_1.validateAndFixClaudeToolPairing; } });
//# sourceMappingURL=request-helpers.js.map