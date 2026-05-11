"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testExports = void 0;
exports.prepareAlloyRequest = prepareAlloyRequest;
exports.buildThinkingWarmupBody = buildThinkingWarmupBody;
exports.transformAlloyResponse = transformAlloyResponse;
const node_crypto_1 = __importDefault(require("node:crypto"));
const constants_1 = require("../constants");
const cache_1 = require("./cache");
const config_1 = require("./config");
const streaming_1 = require("./core/streaming");
const signature_store_1 = require("./stores/signature-store");
const debug_1 = require("./debug");
const logger_1 = require("./logger");
const request_helpers_1 = require("./request-helpers");
const constants_2 = require("../constants");
const thinking_recovery_1 = require("./thinking-recovery");
const cross_model_sanitizer_1 = require("./transform/cross-model-sanitizer");
const transform_1 = require("./transform");
const transform_2 = require("./transform");
const recovery_1 = require("./recovery");
const fingerprint_1 = require("./fingerprint");
const log = (0, logger_1.createLogger)("request");
__exportStar(require("./transform/request-thinking-utils"), exports);
const request_thinking_utils_1 = require("./transform/request-thinking-utils");
function prepareAlloyRequest(input, init, accessToken, projectId, endpointOverride, headerStyle = "Alloy", forceThinkingRecovery = false, options) {
    const baseInit = { ...init };
    const headers = new Headers(init?.headers ?? {});
    let resolvedProjectId = projectId?.trim() || "";
    let toolDebugMissing = 0;
    const toolDebugSummaries = [];
    let toolDebugPayload;
    let sessionId;
    let needsSignedThinkingWarmup = false;
    let thinkingRecoveryMessage;
    if (!(0, request_thinking_utils_1.isGenerativeLanguageRequest)(input)) {
        return {
            request: input,
            init: { ...baseInit, headers },
            streaming: false,
            headerStyle,
        };
    }
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.delete("x-api-key");
    const match = input.match(/\/models\/([^:]+):(\w+)/);
    if (!match) {
        return {
            request: input,
            init: { ...baseInit, headers },
            streaming: false,
            headerStyle,
        };
    }
    const [, rawModel = "", rawAction = ""] = match;
    const requestedModel = rawModel;
    const resolved = (0, transform_2.resolveModelForHeaderStyle)(rawModel, headerStyle);
    const effectiveModel = resolved.actualModel;
    const streaming = rawAction === request_thinking_utils_1.STREAM_ACTION;
    const defaultEndpoint = headerStyle === "gemini-cli" ? constants_1.GEMINI_CLI_ENDPOINT : constants_1.ALLOY_ENDPOINT;
    const baseEndpoint = endpointOverride ?? defaultEndpoint;
    const transformedUrl = `${baseEndpoint}/v1internal:${rawAction}${streaming ? "?alt=sse" : ""}`;
    const isClaude = (0, transform_2.isClaudeModel)(resolved.actualModel);
    const isClaudeThinking = (0, transform_2.isClaudeThinkingModel)(resolved.actualModel);
    // Tier-based thinking configuration from model resolver (can be overridden by variant config)
    let tierThinkingBudget = resolved.thinkingBudget;
    let tierThinkingLevel = resolved.thinkingLevel;
    let signatureSessionKey = (0, request_thinking_utils_1.buildSignatureSessionKey)(request_thinking_utils_1.PLUGIN_SESSION_ID, effectiveModel, undefined, (0, request_thinking_utils_1.resolveProjectKey)(projectId));
    let body = baseInit.body;
    if (typeof baseInit.body === "string" && baseInit.body) {
        try {
            const parsedBody = JSON.parse(baseInit.body);
            const isWrapped = typeof parsedBody.project === "string" && "request" in parsedBody;
            if (isWrapped) {
                const wrappedBody = {
                    ...parsedBody,
                    model: effectiveModel,
                };
                // Some callers may already send an Alloy-wrapped body.
                // We still need to sanitize Claude thinking blocks (remove cache_control)
                // and attach a stable sessionId so multi-turn signature caching works.
                const requestRoot = wrappedBody.request;
                const requestObjects = [];
                if (requestRoot && typeof requestRoot === "object") {
                    requestObjects.push(requestRoot);
                    const nested = requestRoot.request;
                    if (nested && typeof nested === "object") {
                        requestObjects.push(nested);
                    }
                }
                const conversationKey = (0, request_thinking_utils_1.resolveConversationKeyFromRequests)(requestObjects);
                // Strip tier suffix from model for cache key to prevent cache misses on tier change
                // e.g., "claude-opus-4-5-thinking-high" -> "claude-opus-4-5-thinking"
                const modelForCacheKey = effectiveModel.replace(/-(minimal|low|medium|high)$/i, "");
                signatureSessionKey = (0, request_thinking_utils_1.buildSignatureSessionKey)(request_thinking_utils_1.PLUGIN_SESSION_ID, modelForCacheKey, conversationKey, (0, request_thinking_utils_1.resolveProjectKey)(parsedBody.project));
                if (requestObjects.length > 0) {
                    sessionId = signatureSessionKey;
                }
                for (const req of requestObjects) {
                    // Use stable session ID for signature caching across multi-turn conversations
                    req.sessionId = signatureSessionKey;
                    (0, request_thinking_utils_1.stripInjectedDebugFromRequestPayload)(req);
                    // Apply signature-based thinking block firewall (Universal Hardeninig)
                    // Ensures only our signed thinking blocks are sent to the model,
                    // preventing cross-model leakage and API rejections.
                    (0, request_helpers_1.deepFilterThinkingBlocks)(req, signatureSessionKey, cache_1.getCachedSignature, isClaude);
                    if (isClaude) {
                        // Step 1: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
                        (0, cross_model_sanitizer_1.sanitizeCrossModelPayloadInPlace)(req, { targetModel: effectiveModel });
                        // Step 2: Inject signed thinking from cache (after firewall filtering)
                        if (isClaudeThinking && Array.isArray(req.contents)) {
                            req.contents = (0, request_thinking_utils_1.ensureThinkingBeforeToolUseInContents)(req.contents, signatureSessionKey);
                        }
                        if (isClaudeThinking && Array.isArray(req.messages)) {
                            req.messages = (0, request_thinking_utils_1.ensureThinkingBeforeToolUseInMessages)(req.messages, signatureSessionKey);
                        }
                        // Step 3: Apply tool pairing fixes (ID assignment, response matching, orphan recovery)
                        (0, request_helpers_1.applyToolPairingFixes)(req, true);
                    }
                }
                if (isClaudeThinking && sessionId) {
                    const hasToolUse = requestObjects.some((req) => (Array.isArray(req.contents) && (0, request_thinking_utils_1.hasToolUseInContents)(req.contents)) ||
                        (Array.isArray(req.messages) && (0, request_thinking_utils_1.hasToolUseInMessages)(req.messages)));
                    const hasSignedThinking = requestObjects.some((req) => (Array.isArray(req.contents) && (0, request_thinking_utils_1.hasSignedThinkingInContents)(req.contents)) ||
                        (Array.isArray(req.messages) && (0, request_thinking_utils_1.hasSignedThinkingInMessages)(req.messages)));
                    const hasCachedThinking = signature_store_1.defaultSignatureStore.has(signatureSessionKey);
                    needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking;
                }
                body = JSON.stringify(wrappedBody);
            }
            else {
                const requestPayload = { ...parsedBody };
                const rawGenerationConfig = requestPayload.generationConfig;
                const extraBody = requestPayload.extra_body;
                const variantConfig = (0, request_helpers_1.extractVariantThinkingConfig)(requestPayload.providerOptions);
                const isGemini3 = effectiveModel.toLowerCase().includes("gemini-3");
                if (variantConfig?.thinkingLevel && isGemini3) {
                    // Gemini 3 native format - use thinkingLevel directly
                    tierThinkingLevel = variantConfig.thinkingLevel;
                    tierThinkingBudget = undefined;
                }
                else if (variantConfig?.thinkingBudget) {
                    if (isGemini3) {
                        // Legacy format for Gemini 3 - convert with deprecation warning
                        log.warn("[Deprecated] Using thinkingBudget for Gemini 3 model. Use thinkingLevel instead.");
                        tierThinkingLevel = variantConfig.thinkingBudget <= 8192 ? "low"
                            : variantConfig.thinkingBudget <= 16384 ? "medium" : "high";
                        tierThinkingBudget = undefined;
                    }
                    else {
                        // Claude / Gemini 2.5 - use budget directly
                        tierThinkingBudget = variantConfig.thinkingBudget;
                        tierThinkingLevel = undefined;
                    }
                }
                if (isClaude) {
                    if (!requestPayload.toolConfig) {
                        requestPayload.toolConfig = {};
                    }
                    if (typeof requestPayload.toolConfig === "object" && requestPayload.toolConfig !== null) {
                        const toolConfig = requestPayload.toolConfig;
                        if (!toolConfig.functionCallingConfig) {
                            toolConfig.functionCallingConfig = {};
                        }
                        if (typeof toolConfig.functionCallingConfig === "object" && toolConfig.functionCallingConfig !== null) {
                            toolConfig.functionCallingConfig.mode = "VALIDATED";
                        }
                    }
                }
                // Resolve thinking configuration based on user settings and model capabilities
                // Image generation models don't support thinking - skip thinking config entirely
                const isImageModel = (0, transform_1.isImageGenerationModel)(effectiveModel);
                const userThinkingConfig = isImageModel ? undefined : (0, request_helpers_1.extractThinkingConfig)(requestPayload, rawGenerationConfig, extraBody);
                const hasAssistantHistory = Array.isArray(requestPayload.contents) &&
                    requestPayload.contents.some((c) => c?.role === "model" || c?.role === "assistant");
                // For claude-sonnet-4-5 (without -thinking suffix), ignore client's thinkingConfig
                // Only claude-sonnet-4-5-thinking-* variants should have thinking enabled
                const isClaudeSonnetNonThinking = effectiveModel.toLowerCase() === "claude-sonnet-4-5";
                const effectiveUserThinkingConfig = (isClaudeSonnetNonThinking || isImageModel) ? undefined : userThinkingConfig;
                // For image models, add imageConfig instead of thinkingConfig
                if (isImageModel) {
                    const imageConfig = (0, transform_1.buildImageGenerationConfig)();
                    const generationConfig = (rawGenerationConfig ?? {});
                    generationConfig.imageConfig = imageConfig;
                    // Remove any thinkingConfig that might have been set
                    delete generationConfig.thinkingConfig;
                    // Set reasonable defaults for image generation
                    if (!generationConfig.candidateCount) {
                        generationConfig.candidateCount = 1;
                    }
                    requestPayload.generationConfig = generationConfig;
                    // Add safety settings for image generation (permissive to allow creative content)
                    if (!requestPayload.safetySettings) {
                        requestPayload.safetySettings = [
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
                            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_ONLY_HIGH" },
                        ];
                    }
                    // Image models don't support tools - remove them entirely
                    delete requestPayload.tools;
                    delete requestPayload.toolConfig;
                    // Replace system instruction with a simple image generation prompt
                    // Image models should not receive agentic coding assistant instructions
                    requestPayload.systemInstruction = {
                        parts: [{ text: "You are an AI image generator. Generate images based on user descriptions. Focus on creating high-quality, visually appealing images that match the user's request." }]
                    };
                }
                else {
                    const finalThinkingConfig = (0, request_helpers_1.resolveThinkingConfig)(effectiveUserThinkingConfig, isClaudeSonnetNonThinking ? false : (resolved.isThinkingModel ?? (0, request_helpers_1.isThinkingCapableModel)(effectiveModel)), isClaude, hasAssistantHistory);
                    const normalizedThinking = (0, request_helpers_1.normalizeThinkingConfig)(finalThinkingConfig);
                    if (normalizedThinking) {
                        // Use tier-based thinking budget if specified via model suffix, otherwise fall back to user config
                        const thinkingBudget = tierThinkingBudget ?? normalizedThinking.thinkingBudget;
                        // Build thinking config based on model type
                        let thinkingConfig;
                        if (isClaudeThinking) {
                            // Claude uses snake_case keys
                            thinkingConfig = {
                                include_thoughts: normalizedThinking.includeThoughts ?? true,
                                ...(typeof thinkingBudget === "number" && thinkingBudget > 0
                                    ? { thinking_budget: thinkingBudget }
                                    : {}),
                            };
                        }
                        else if (tierThinkingLevel) {
                            // Gemini 3 uses thinkingLevel string (low/medium/high)
                            thinkingConfig = {
                                includeThoughts: normalizedThinking.includeThoughts,
                                thinkingLevel: tierThinkingLevel,
                            };
                        }
                        else {
                            // Gemini 2.5 and others use numeric budget
                            thinkingConfig = {
                                includeThoughts: normalizedThinking.includeThoughts,
                                ...(typeof thinkingBudget === "number" && thinkingBudget > 0 ? { thinkingBudget } : {}),
                            };
                        }
                        if (rawGenerationConfig) {
                            rawGenerationConfig.thinkingConfig = thinkingConfig;
                            if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
                                const currentMax = (rawGenerationConfig.maxOutputTokens ?? rawGenerationConfig.max_output_tokens);
                                if (!currentMax || currentMax <= thinkingBudget) {
                                    rawGenerationConfig.maxOutputTokens = transform_2.CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
                                    if (rawGenerationConfig.max_output_tokens !== undefined) {
                                        delete rawGenerationConfig.max_output_tokens;
                                    }
                                }
                            }
                            requestPayload.generationConfig = rawGenerationConfig;
                        }
                        else {
                            const generationConfig = { thinkingConfig };
                            if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
                                generationConfig.maxOutputTokens = transform_2.CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
                            }
                            requestPayload.generationConfig = generationConfig;
                        }
                    }
                    else if (rawGenerationConfig?.thinkingConfig) {
                        delete rawGenerationConfig.thinkingConfig;
                        requestPayload.generationConfig = rawGenerationConfig;
                    }
                } // End of else block for non-image models
                // Clean up thinking fields from extra_body
                if (extraBody) {
                    delete extraBody.thinkingConfig;
                    delete extraBody.thinking;
                }
                delete requestPayload.thinkingConfig;
                delete requestPayload.thinking;
                if ("system_instruction" in requestPayload) {
                    requestPayload.systemInstruction = requestPayload.system_instruction;
                    delete requestPayload.system_instruction;
                }
                if (isClaudeThinking && Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0) {
                    const hint = "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";
                    const existing = requestPayload.systemInstruction;
                    if (typeof existing === "string") {
                        requestPayload.systemInstruction = existing.trim().length > 0 ? `${existing}\n\n${hint}` : hint;
                    }
                    else if (existing && typeof existing === "object") {
                        const sys = existing;
                        const partsValue = sys.parts;
                        if (Array.isArray(partsValue)) {
                            const parts = partsValue;
                            let appended = false;
                            for (let i = parts.length - 1; i >= 0; i--) {
                                const part = parts[i];
                                if (part && typeof part === "object") {
                                    const partRecord = part;
                                    const text = partRecord.text;
                                    if (typeof text === "string") {
                                        partRecord.text = `${text}\n\n${hint}`;
                                        appended = true;
                                        break;
                                    }
                                }
                            }
                            if (!appended) {
                                parts.push({ text: hint });
                            }
                        }
                        else {
                            sys.parts = [{ text: hint }];
                        }
                        requestPayload.systemInstruction = sys;
                    }
                    else if (Array.isArray(requestPayload.contents)) {
                        requestPayload.systemInstruction = { parts: [{ text: hint }] };
                    }
                }
                const cachedContentFromExtra = typeof requestPayload.extra_body === "object" && requestPayload.extra_body
                    ? requestPayload.extra_body.cached_content ??
                        requestPayload.extra_body.cachedContent
                    : undefined;
                const cachedContent = requestPayload.cached_content ??
                    requestPayload.cachedContent ??
                    cachedContentFromExtra;
                if (cachedContent) {
                    requestPayload.cachedContent = cachedContent;
                }
                delete requestPayload.cached_content;
                delete requestPayload.cachedContent;
                if (requestPayload.extra_body && typeof requestPayload.extra_body === "object") {
                    delete requestPayload.extra_body.cached_content;
                    delete requestPayload.extra_body.cachedContent;
                    if (Object.keys(requestPayload.extra_body).length === 0) {
                        delete requestPayload.extra_body;
                    }
                }
                // Normalize tools. For Claude models, keep full function declarations (names + schemas).
                const hasTools = Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0;
                if (hasTools) {
                    if (isClaude) {
                        const functionDeclarations = [];
                        const passthroughTools = [];
                        const normalizeSchema = (schema) => {
                            const createPlaceholderSchema = (base = {}) => ({
                                ...base,
                                type: "object",
                                properties: {
                                    [constants_1.EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                                        type: "boolean",
                                        description: constants_1.EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
                                    },
                                },
                                required: [constants_1.EMPTY_SCHEMA_PLACEHOLDER_NAME],
                            });
                            if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
                                toolDebugMissing += 1;
                                return createPlaceholderSchema();
                            }
                            const cleaned = (0, request_helpers_1.cleanJSONSchemaForAlloy)(schema);
                            if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
                                toolDebugMissing += 1;
                                return createPlaceholderSchema();
                            }
                            // Claude VALIDATED mode requires tool parameters to be an object schema
                            // with at least one property.
                            const hasProperties = cleaned.properties &&
                                typeof cleaned.properties === "object" &&
                                Object.keys(cleaned.properties).length > 0;
                            cleaned.type = "object";
                            if (!hasProperties) {
                                cleaned.properties = {
                                    [constants_1.EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                                        type: "boolean",
                                        description: constants_1.EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
                                    },
                                };
                                cleaned.required = Array.isArray(cleaned.required)
                                    ? Array.from(new Set([...cleaned.required, constants_1.EMPTY_SCHEMA_PLACEHOLDER_NAME]))
                                    : [constants_1.EMPTY_SCHEMA_PLACEHOLDER_NAME];
                            }
                            return cleaned;
                        };
                        requestPayload.tools.forEach((tool) => {
                            const pushDeclaration = (decl, source) => {
                                const schema = decl.parameters ||
                                    decl.parametersJsonSchema ||
                                    decl.input_schema ||
                                    decl.inputSchema ||
                                    tool.parameters ||
                                    tool.parametersJsonSchema ||
                                    tool.input_schema ||
                                    tool.inputSchema ||
                                    (tool.function?.inputSchema) ||
                                    (tool.custom?.parameters) ||
                                    (tool.custom?.parametersJsonSchema) ||
                                    (tool.custom?.input_schema);
                                let name = decl.name ||
                                    tool.name ||
                                    (tool.function?.name) ||
                                    (tool.custom?.name) ||
                                    `tool-${functionDeclarations.length}`;
                                // Sanitize tool name: must be alphanumeric with underscores, no special chars
                                name = String(name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
                                const description = decl.description ||
                                    tool.description ||
                                    (tool.function?.description) ||
                                    (tool.custom?.description) ||
                                    "";
                                functionDeclarations.push({
                                    name,
                                    description: String(description || ""),
                                    parameters: normalizeSchema(schema),
                                });
                                toolDebugSummaries.push(`decl=${name},src=${source},hasSchema=${schema ? "y" : "n"}`);
                            };
                            if (Array.isArray(tool.functionDeclarations) && tool.functionDeclarations.length > 0) {
                                tool.functionDeclarations.forEach((decl) => pushDeclaration(decl, "functionDeclarations"));
                                return;
                            }
                            // Fall back to function/custom style definitions.
                            if (tool.function ||
                                tool.custom ||
                                tool.parameters ||
                                tool.input_schema ||
                                tool.inputSchema) {
                                pushDeclaration(tool.function ?? tool.custom ?? tool, "function/custom");
                                return;
                            }
                            // Preserve any non-function tool entries (e.g., codeExecution) untouched.
                            passthroughTools.push(tool);
                        });
                        const finalTools = [];
                        if (functionDeclarations.length > 0) {
                            finalTools.push({ functionDeclarations });
                        }
                        requestPayload.tools = finalTools.concat(passthroughTools);
                    }
                    else {
                        // Gemini-specific tool normalization and feature injection
                        const geminiResult = (0, transform_1.applyGeminiTransforms)(requestPayload, {
                            model: effectiveModel,
                            normalizedThinking: undefined, // Thinking config already applied above (lines 816-880)
                            tierThinkingBudget,
                            tierThinkingLevel: tierThinkingLevel,
                        });
                        toolDebugMissing = geminiResult.toolDebugMissing;
                        toolDebugSummaries.push(...geminiResult.toolDebugSummaries);
                    }
                    try {
                        toolDebugPayload = JSON.stringify(requestPayload.tools);
                    }
                    catch {
                        toolDebugPayload = undefined;
                    }
                    // Apply Claude tool hardening (ported from LLM-API-Key-Proxy)
                    // Injects parameter signatures into descriptions and adds system instruction
                    // Can be disabled via config.claude_tool_hardening = false to reduce context size
                    const enableToolHardening = options?.claudeToolHardening ?? true;
                    if (enableToolHardening && isClaude && Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0) {
                        // Inject parameter signatures into tool descriptions
                        requestPayload.tools = (0, request_helpers_1.injectParameterSignatures)(requestPayload.tools, constants_2.CLAUDE_DESCRIPTION_PROMPT);
                        // Inject tool hardening system instruction
                        (0, request_helpers_1.injectToolHardeningInstruction)(requestPayload, constants_2.CLAUDE_TOOL_SYSTEM_INSTRUCTION);
                    }
                }
                const conversationKey = (0, request_thinking_utils_1.resolveConversationKey)(requestPayload);
                signatureSessionKey = (0, request_thinking_utils_1.buildSignatureSessionKey)(request_thinking_utils_1.PLUGIN_SESSION_ID, effectiveModel, conversationKey, (0, request_thinking_utils_1.resolveProjectKey)(projectId));
                // For Claude models, filter out unsigned thinking blocks (required by Claude API)
                // Attempts to restore signatures from cache for multi-turn conversations
                // Handle both Gemini-style contents[] and Anthropic-style messages[] payloads.
                // Apply signature-based thinking block firewall (Universal Hardeninig)
                (0, request_helpers_1.deepFilterThinkingBlocks)(requestPayload, signatureSessionKey, cache_1.getCachedSignature, isClaude);
                if (isClaude) {
                    // Step 1: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
                    (0, cross_model_sanitizer_1.sanitizeCrossModelPayloadInPlace)(requestPayload, { targetModel: effectiveModel });
                    // Step 2: Inject signed thinking from cache (after firewall filtering)
                    if (isClaudeThinking && Array.isArray(requestPayload.contents)) {
                        requestPayload.contents = (0, request_thinking_utils_1.ensureThinkingBeforeToolUseInContents)(requestPayload.contents, signatureSessionKey);
                    }
                    if (isClaudeThinking && Array.isArray(requestPayload.messages)) {
                        requestPayload.messages = (0, request_thinking_utils_1.ensureThinkingBeforeToolUseInMessages)(requestPayload.messages, signatureSessionKey);
                    }
                    // Step 3: Check if warmup needed (AFTER injection attempt)
                    if (isClaudeThinking) {
                        const hasToolUse = (Array.isArray(requestPayload.contents) && (0, request_thinking_utils_1.hasToolUseInContents)(requestPayload.contents)) ||
                            (Array.isArray(requestPayload.messages) && (0, request_thinking_utils_1.hasToolUseInMessages)(requestPayload.messages));
                        const hasSignedThinking = (Array.isArray(requestPayload.contents) && (0, request_thinking_utils_1.hasSignedThinkingInContents)(requestPayload.contents)) ||
                            (Array.isArray(requestPayload.messages) && (0, request_thinking_utils_1.hasSignedThinkingInMessages)(requestPayload.messages));
                        const hasCachedThinking = signature_store_1.defaultSignatureStore.has(signatureSessionKey);
                        needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking;
                    }
                }
                // For Claude models, ensure functionCall/tool use parts carry IDs (required by Anthropic).
                // We use a two-pass approach: first collect all functionCalls and assign IDs,
                // then match functionResponses to their corresponding calls using a FIFO queue per function name.
                if (isClaude && Array.isArray(requestPayload.contents)) {
                    let toolCallCounter = 0;
                    // Track pending call IDs per function name as a FIFO queue
                    const pendingCallIdsByName = new Map();
                    // First pass: assign IDs to all functionCalls and collect them
                    requestPayload.contents = (requestPayload.contents.map((content) => {
                        if (!content || !Array.isArray(content.parts)) {
                            return content;
                        }
                        const newParts = content.parts.map((part) => {
                            if (part && typeof part === "object" && part.functionCall) {
                                const call = { ...part.functionCall };
                                if (!call.id) {
                                    call.id = `tool-call-${++toolCallCounter}`;
                                }
                                const nameKey = typeof call.name === "string" ? call.name : `tool-${toolCallCounter}`;
                                // Push to the queue for this function name
                                const queue = pendingCallIdsByName.get(nameKey) || [];
                                queue.push(call.id);
                                pendingCallIdsByName.set(nameKey, queue);
                                return { ...part, functionCall: call };
                            }
                            return part;
                        });
                        return { ...content, parts: newParts };
                    }));
                    // Second pass: match functionResponses to their corresponding calls (FIFO order)
                    requestPayload.contents = (requestPayload.contents.map((content) => {
                        if (!content || !Array.isArray(content.parts)) {
                            return content;
                        }
                        const newParts = content.parts.map((part) => {
                            if (part && typeof part === "object" && part.functionResponse) {
                                const resp = { ...part.functionResponse };
                                if (!resp.id && typeof resp.name === "string") {
                                    const queue = pendingCallIdsByName.get(resp.name);
                                    if (queue && queue.length > 0) {
                                        const id = queue.shift();
                                        if (id !== undefined) {
                                            resp.id = id;
                                        }
                                        pendingCallIdsByName.set(resp.name, queue);
                                    }
                                }
                                return { ...part, functionResponse: resp };
                            }
                            return part;
                        });
                        return { ...content, parts: newParts };
                    }));
                    // Third pass: Apply orphan recovery for mismatched tool IDs
                    // This handles cases where context compaction or other processes
                    // create ID mismatches between calls and responses.
                    // Ported from LLM-API-Key-Proxy's _fix_tool_response_grouping()
                    requestPayload.contents = (0, request_helpers_1.fixToolResponseGrouping)(requestPayload.contents);
                }
                // Fourth pass: Fix Claude format tool pairing (defense in depth)
                // Handles orphaned tool_use blocks in Claude's messages[] format
                if (Array.isArray(requestPayload.messages)) {
                    requestPayload.messages = (0, request_helpers_1.validateAndFixClaudeToolPairing)(requestPayload.messages);
                }
                // =====================================================================
                // LAST RESORT RECOVERY: "Let it crash and start again"
                // =====================================================================
                // If after all our processing we're STILL in a bad state (tool loop without
                // thinking at turn start), don't try to fix it - just close the turn and
                // start fresh. This prevents permanent session breakage.
                //
                // This handles cases where:
                // - Context compaction stripped thinking blocks
                // - Signature cache miss
                // - Any other corruption we couldn't repair
                // - API error indicated thinking_block_order issue (forceThinkingRecovery=true)
                //
                // The synthetic messages allow Claude to generate fresh thinking on the
                // new turn instead of failing with "Expected thinking but found text".
                if (isClaudeThinking && Array.isArray(requestPayload.contents)) {
                    const conversationState = (0, thinking_recovery_1.analyzeConversationState)(requestPayload.contents);
                    // Force recovery if API returned thinking_block_order error (retry case)
                    // or if proactive check detects we need recovery
                    if (forceThinkingRecovery || (0, thinking_recovery_1.needsThinkingRecovery)(conversationState)) {
                        // Set message for toast notification (shown in plugin.ts, respects quiet mode)
                        thinkingRecoveryMessage = forceThinkingRecovery
                            ? "Thinking recovery: retrying with fresh turn (API error)"
                            : "Thinking recovery: restarting turn (corrupted context)";
                        requestPayload.contents = (0, thinking_recovery_1.closeToolLoopForThinking)(requestPayload.contents);
                        signature_store_1.defaultSignatureStore.delete(signatureSessionKey);
                    }
                }
                if ("model" in requestPayload) {
                    delete requestPayload.model;
                }
                (0, request_thinking_utils_1.stripInjectedDebugFromRequestPayload)(requestPayload);
                const effectiveProjectId = projectId?.trim() || (0, request_thinking_utils_1.generateSyntheticProjectId)();
                resolvedProjectId = effectiveProjectId;
                // Inject Alloy system instruction with role "user" (CLIProxyAPI v6.6.89 compatibility)
                // This sets request.systemInstruction.role = "user" and request.systemInstruction.parts[0].text
                if (headerStyle === "Alloy") {
                    const existingSystemInstruction = requestPayload.systemInstruction;
                    if (existingSystemInstruction && typeof existingSystemInstruction === "object") {
                        const sys = existingSystemInstruction;
                        sys.role = "user";
                        if (Array.isArray(sys.parts) && sys.parts.length > 0) {
                            const firstPart = sys.parts[0];
                            if (firstPart && typeof firstPart.text === "string") {
                                firstPart.text = constants_2.ALLOY_SYSTEM_INSTRUCTION + "\n\n" + firstPart.text;
                            }
                            else {
                                sys.parts = [{ text: constants_2.ALLOY_SYSTEM_INSTRUCTION }, ...sys.parts];
                            }
                        }
                        else {
                            sys.parts = [{ text: constants_2.ALLOY_SYSTEM_INSTRUCTION }];
                        }
                    }
                    else if (typeof existingSystemInstruction === "string") {
                        requestPayload.systemInstruction = {
                            role: "user",
                            parts: [{ text: constants_2.ALLOY_SYSTEM_INSTRUCTION + "\n\n" + existingSystemInstruction }],
                        };
                    }
                    else {
                        requestPayload.systemInstruction = {
                            role: "user",
                            parts: [{ text: constants_2.ALLOY_SYSTEM_INSTRUCTION }],
                        };
                    }
                }
                const wrappedBody = {
                    project: effectiveProjectId,
                    model: effectiveModel,
                    request: requestPayload,
                    requestType: "agent",
                };
                Object.assign(wrappedBody, {
                    userAgent: "Alloy",
                    requestId: "agent-" + node_crypto_1.default.randomUUID(),
                });
                if (wrappedBody.request && typeof wrappedBody.request === 'object') {
                    // Use stable session ID for signature caching across multi-turn conversations
                    sessionId = signatureSessionKey;
                    wrappedBody.request.sessionId = signatureSessionKey;
                }
                body = JSON.stringify(wrappedBody);
            }
        }
        catch (e) {
            console.error("[Alloy:Plugin] Request transform failed:", e);
        }
    }
    if (streaming) {
        headers.set("Accept", "text/event-stream");
    }
    // Add interleaved thinking header for Claude thinking models
    // This enables real-time streaming of thinking tokens
    if (isClaudeThinking) {
        const existing = headers.get("anthropic-beta");
        const interleavedHeader = "interleaved-thinking-2025-05-14";
        if (existing) {
            if (!existing.includes(interleavedHeader)) {
                headers.set("anthropic-beta", `${existing},${interleavedHeader}`);
            }
        }
        else {
            headers.set("anthropic-beta", interleavedHeader);
        }
    }
    // Use randomized headers as the fallback pool
    const selectedHeaders = (0, constants_1.getRandomizedHeaders)(headerStyle);
    if (headerStyle === "Alloy") {
        // Alloy mode: Use fingerprint headers for device identity and quota tracking
        // Fingerprint headers override randomized headers for User-Agent, X-Goog-Api-Client, Client-Metadata
        // and add X-Goog-QuotaUser, X-Client-Device-Id for unique device identity
        const fingerprint = options?.fingerprint ?? (0, fingerprint_1.getSessionFingerprint)();
        const fingerprintHeaders = (0, fingerprint_1.buildFingerprintHeaders)(fingerprint);
        // Apply fingerprint headers (override randomized with fingerprint if available)
        headers.set("User-Agent", fingerprintHeaders["User-Agent"] || selectedHeaders["User-Agent"]);
        headers.set("X-Goog-Api-Client", fingerprintHeaders["X-Goog-Api-Client"] || selectedHeaders["X-Goog-Api-Client"]);
        headers.set("Client-Metadata", fingerprintHeaders["Client-Metadata"] || selectedHeaders["Client-Metadata"]);
        // Add fingerprint-specific headers for device identity (Alloy only)
        const fHeaders = fingerprintHeaders;
        if (fHeaders["X-Goog-QuotaUser"]) {
            headers.set("X-Goog-QuotaUser", fHeaders["X-Goog-QuotaUser"]);
        }
        if (fHeaders["X-Client-Device-Id"]) {
            headers.set("X-Client-Device-Id", fHeaders["X-Client-Device-Id"]);
        }
    }
    else {
        // Gemini CLI mode: Use simple static headers matching Alloy-gemini-auth
        // NO fingerprint headers, NO X-Goog-QuotaUser, NO X-Client-Device-Id
        // This mirrors exactly what https://github.com/jenslys/Alloy-gemini-auth does
        headers.set("User-Agent", selectedHeaders["User-Agent"]);
        headers.set("X-Goog-Api-Client", selectedHeaders["X-Goog-Api-Client"]);
        headers.set("Client-Metadata", selectedHeaders["Client-Metadata"]);
    }
    // Optional debug header to observe tool normalization on the backend if surfaced
    if (toolDebugMissing > 0) {
        headers.set("X-Alloy-Tools-Debug", String(toolDebugMissing));
    }
    return {
        request: transformedUrl,
        init: {
            ...baseInit,
            headers,
            body,
        },
        streaming,
        requestedModel,
        effectiveModel: effectiveModel,
        projectId: resolvedProjectId,
        endpoint: transformedUrl,
        sessionId,
        toolDebugMissing,
        toolDebugSummary: toolDebugSummaries.slice(0, 20).join(" | "),
        toolDebugPayload,
        needsSignedThinkingWarmup,
        headerStyle,
        thinkingRecoveryMessage,
    };
}
function buildThinkingWarmupBody(bodyText, isClaudeThinking) {
    if (!bodyText || !isClaudeThinking) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(bodyText);
    }
    catch {
        return null;
    }
    const warmupPrompt = "Warmup request for thinking signature.";
    const updateRequest = (req) => {
        req.contents = [{ role: "user", parts: [{ text: warmupPrompt }] }];
        delete req.tools;
        delete req.toolConfig;
        const generationConfig = (req.generationConfig ?? {});
        generationConfig.thinkingConfig = {
            include_thoughts: true,
            thinking_budget: request_helpers_1.DEFAULT_THINKING_BUDGET,
        };
        generationConfig.maxOutputTokens = transform_2.CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
        req.generationConfig = generationConfig;
    };
    if (parsed.request && typeof parsed.request === "object") {
        updateRequest(parsed.request);
        const nested = parsed.request.request;
        if (nested && typeof nested === "object") {
            updateRequest(nested);
        }
    }
    else {
        updateRequest(parsed);
    }
    return JSON.stringify(parsed);
}
/**
 * Normalizes Alloy responses: applies retry headers, extracts cache usage into headers,
 * rewrites preview errors, flattens streaming payloads, and logs debug metadata.
 *
 * For streaming SSE responses, uses TransformStream for true real-time incremental streaming.
 * Thinking/reasoning tokens are transformed and forwarded immediately as they arrive.
 */
async function transformAlloyResponse(response, streaming, debugContext, requestedModel, projectId, endpoint, effectiveModel, sessionId, toolDebugMissing, toolDebugSummary, toolDebugPayload, debugLines) {
    const contentType = response.headers.get("content-type") ?? "";
    const isJsonResponse = contentType.includes("application/json");
    const isEventStreamResponse = contentType.includes("text/event-stream");
    // Generate text for thinking injection:
    // - If debug=true: inject full debug logs
    // - If keep_thinking=true (but no debug): inject placeholder to trigger signature caching
    // Both use the same injection path (injectDebugThinking) for consistent behavior
    const debugText = (0, debug_1.isDebugEnabled)() && Array.isArray(debugLines) && debugLines.length > 0
        ? (0, request_thinking_utils_1.formatDebugLinesForThinking)(debugLines)
        : (0, config_1.getKeepThinking)()
            ? request_thinking_utils_1.SYNTHETIC_THINKING_PLACEHOLDER
            : undefined;
    const cacheSignatures = (0, request_thinking_utils_1.shouldCacheThinkingSignatures)(effectiveModel);
    if (!isJsonResponse && !isEventStreamResponse) {
        (0, debug_1.logAlloyDebugResponse)(debugContext, response, {
            note: "Non-JSON response (body omitted)",
        });
        return response;
    }
    // For successful streaming responses, use TransformStream to transform SSE events
    // while maintaining real-time streaming (no buffering of entire response).
    // This enables thinking tokens to be displayed as they arrive, like the Codex plugin.
    if (streaming && response.ok && isEventStreamResponse && response.body) {
        const headers = new Headers(response.headers);
        (0, debug_1.logAlloyDebugResponse)(debugContext, response, {
            note: "Streaming SSE response (real-time transform)",
        });
        const streamingTransformer = (0, streaming_1.createStreamingTransformer)(signature_store_1.defaultSignatureStore, {
            onCacheSignature: cache_1.cacheSignature,
            onInjectDebug: request_thinking_utils_1.injectDebugThinking,
            // onInjectSyntheticThinking removed - keep_thinking now uses debugText path
            transformThinkingParts: request_helpers_1.transformThinkingParts,
        }, {
            signatureSessionKey: sessionId,
            debugText,
            cacheSignatures,
            displayedThinkingHashes: effectiveModel && (0, transform_1.isGemini3Model)(effectiveModel) ? request_thinking_utils_1.sessionDisplayedThinkingHashes : undefined,
            // injectSyntheticThinking removed - keep_thinking now unified with debug via debugText
        });
        return new Response(response.body.pipeThrough(streamingTransformer), {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }
    try {
        const headers = new Headers(response.headers);
        const text = await response.text();
        if (!response.ok) {
            let errorBody;
            try {
                errorBody = JSON.parse(text);
            }
            catch {
                errorBody = { error: { message: text } };
            }
            // Inject Debug Info
            if (errorBody?.error) {
                const debugInfo = `\n\n[Debug Info]\nRequested Model: ${requestedModel || "Unknown"}\nEffective Model: ${effectiveModel || "Unknown"}\nProject: ${projectId || "Unknown"}\nEndpoint: ${endpoint || "Unknown"}\nStatus: ${response.status}\nRequest ID: ${headers.get("x-request-id") || "N/A"}${toolDebugMissing !== undefined ? `\nTool Debug Missing: ${toolDebugMissing}` : ""}${toolDebugSummary ? `\nTool Debug Summary: ${toolDebugSummary}` : ""}${toolDebugPayload ? `\nTool Debug Payload: ${toolDebugPayload}` : ""}`;
                const injectedDebug = debugText ? `\n\n${debugText}` : "";
                errorBody.error.message = (errorBody.error.message || "Unknown error") + debugInfo + injectedDebug;
                // Check if this is a recoverable thinking error - throw to trigger retry
                const errorType = (0, recovery_1.detectErrorType)(errorBody.error.message || "");
                if (errorType === "thinking_block_order") {
                    const recoveryError = new Error("THINKING_RECOVERY_NEEDED");
                    recoveryError.recoveryType = errorType;
                    recoveryError.originalError = errorBody;
                    recoveryError.debugInfo = debugInfo;
                    throw recoveryError;
                }
                // Detect context length / prompt too long errors - signal to caller for toast
                const errorMessage = errorBody.error.message?.toLowerCase() || "";
                if (errorMessage.includes("prompt is too long") ||
                    errorMessage.includes("context length exceeded") ||
                    errorMessage.includes("context_length_exceeded") ||
                    errorMessage.includes("maximum context length")) {
                    headers.set("x-Alloy-context-error", "prompt_too_long");
                }
                // Detect tool pairing errors - signal to caller for toast
                if (errorMessage.includes("tool_use") &&
                    errorMessage.includes("tool_result") &&
                    (errorMessage.includes("without") || errorMessage.includes("immediately after"))) {
                    headers.set("x-Alloy-context-error", "tool_pairing");
                }
                return new Response(JSON.stringify(errorBody), {
                    status: response.status,
                    statusText: response.statusText,
                    headers
                });
            }
            if (errorBody?.error?.details && Array.isArray(errorBody.error.details)) {
                const retryInfo = errorBody.error.details.find((detail) => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
                if (typeof retryInfo?.retryDelay === "string") {
                    const match = retryInfo.retryDelay.match(/^([\d.]+)s$/);
                    if (match && match[1]) {
                        const retrySeconds = parseFloat(match[1]);
                        if (!isNaN(retrySeconds) && retrySeconds > 0) {
                            const retryAfterSec = Math.ceil(retrySeconds).toString();
                            const retryAfterMs = Math.ceil(retrySeconds * 1000).toString();
                            headers.set('Retry-After', retryAfterSec);
                            headers.set('retry-after-ms', retryAfterMs);
                        }
                    }
                }
            }
        }
        const usageFromSse = streaming && isEventStreamResponse ? (0, request_helpers_1.extractUsageFromSsePayload)(text) : null;
        const parsed = !streaming || !isEventStreamResponse ? (0, request_helpers_1.parseAlloyApiBody)(text) : null;
        const patched = parsed ? (0, request_helpers_1.rewriteAlloyPreviewAccessError)(parsed, response.status, requestedModel) : null;
        const effectiveBody = patched ?? parsed ?? undefined;
        const usage = usageFromSse ?? (effectiveBody ? (0, request_helpers_1.extractUsageMetadata)(effectiveBody) : null);
        // Log cache stats when available
        if (usage && effectiveModel) {
            (0, debug_1.logCacheStats)(effectiveModel, usage.cachedContentTokenCount ?? 0, 0, // API doesn't provide cache write tokens separately
            usage.promptTokenCount ?? usage.totalTokenCount ?? 0);
        }
        if (usage?.cachedContentTokenCount !== undefined) {
            headers.set("x-Alloy-cached-content-token-count", String(usage.cachedContentTokenCount));
            if (usage.totalTokenCount !== undefined) {
                headers.set("x-Alloy-total-token-count", String(usage.totalTokenCount));
            }
            if (usage.promptTokenCount !== undefined) {
                headers.set("x-Alloy-prompt-token-count", String(usage.promptTokenCount));
            }
            if (usage.candidatesTokenCount !== undefined) {
                headers.set("x-Alloy-candidates-token-count", String(usage.candidatesTokenCount));
            }
        }
        (0, debug_1.logAlloyDebugResponse)(debugContext, response, {
            body: text,
            note: streaming ? "Streaming SSE payload (buffered fallback)" : undefined,
            headersOverride: headers,
        });
        // Note: successful streaming responses are handled above via TransformStream. 
        return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }
    catch (error) {
        return handleAlloyError(error, debugContext, requestedModel, projectId, endpoint);
    }
}
async function handleAlloyError(error, _debugContext, _model, _project, _endpoint) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
}
// ============================================================================
// TEST-ONLY EXPORTS
// Exposes private functions to request.test.ts for unit testing.
// ============================================================================
exports.__testExports = {
    buildSignatureSessionKey: request_thinking_utils_1.buildSignatureSessionKey,
    hashConversationSeed: request_thinking_utils_1.hashConversationSeed,
    extractTextFromContent: request_thinking_utils_1.extractTextFromContent,
    extractConversationSeedFromMessages: request_thinking_utils_1.extractConversationSeedFromMessages,
    extractConversationSeedFromContents: request_thinking_utils_1.extractConversationSeedFromContents,
    resolveProjectKey: request_thinking_utils_1.resolveProjectKey,
    isGeminiToolUsePart: request_thinking_utils_1.isGeminiToolUsePart,
    isGeminiThinkingPart: request_thinking_utils_1.isGeminiThinkingPart,
    ensureThoughtSignature: request_thinking_utils_1.ensureThoughtSignature,
    hasSignedThinkingPart: request_thinking_utils_1.hasSignedThinkingPart,
    hasToolUseInContents: request_thinking_utils_1.hasToolUseInContents,
    hasSignedThinkingInContents: request_thinking_utils_1.hasSignedThinkingInContents,
    hasToolUseInMessages: request_thinking_utils_1.hasToolUseInMessages,
    hasSignedThinkingInMessages: request_thinking_utils_1.hasSignedThinkingInMessages,
    generateSyntheticProjectId: request_thinking_utils_1.generateSyntheticProjectId,
    MIN_SIGNATURE_LENGTH: request_thinking_utils_1.MIN_SIGNATURE_LENGTH,
    transformStreamingPayload: streaming_1.transformStreamingPayload,
    createStreamingTransformer: streaming_1.createStreamingTransformer,
    transformSseLine: streaming_1.transformSseLine,
};
//# sourceMappingURL=request.js.map