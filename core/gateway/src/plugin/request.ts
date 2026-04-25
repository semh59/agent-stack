import crypto from "node:crypto";
import {
  ALLOY_ENDPOINT,
  GEMINI_CLI_ENDPOINT,
  EMPTY_SCHEMA_PLACEHOLDER_NAME,
  EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
  getRandomizedHeaders,
} from "../constants";
import type {
  AlloyRequestRoot,
  AlloyTool,
  HeaderStyle,
  MessageContent,
  MessagePart,
} from "./types";
import { cacheSignature, getCachedSignature } from "./cache";
import { getKeepThinking } from "./config";
import {
  createStreamingTransformer,
  transformSseLine,
  transformStreamingPayload,
} from "./core/streaming";
import { defaultSignatureStore } from "./stores/signature-store";
import {
  isDebugEnabled,
  logAlloyDebugResponse,
  logCacheStats,
  type AlloyDebugContext,
} from "./debug";
import { createLogger } from "./logger";
import {
  cleanJSONSchemaForAlloy,
  DEFAULT_THINKING_BUDGET,
  deepFilterThinkingBlocks,
  extractThinkingConfig,
  extractVariantThinkingConfig,
  extractUsageFromSsePayload,
  extractUsageMetadata,
  fixToolResponseGrouping,
  validateAndFixClaudeToolPairing,
  applyToolPairingFixes,
  injectParameterSignatures,
  injectToolHardeningInstruction,
  isThinkingCapableModel,
  normalizeThinkingConfig,
  parseAlloyApiBody,
  resolveThinkingConfig,
  rewriteAlloyPreviewAccessError,
  transformThinkingParts,
  type AlloyApiBody,
} from "./request-helpers";
import {
  CLAUDE_TOOL_SYSTEM_INSTRUCTION,
  CLAUDE_DESCRIPTION_PROMPT,
  ALLOY_SYSTEM_INSTRUCTION,
} from "../constants";
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
} from "./thinking-recovery";
import { sanitizeCrossModelPayloadInPlace } from "./transform/cross-model-sanitizer";
import { isGemini3Model, isImageGenerationModel, buildImageGenerationConfig, applyGeminiTransforms } from "./transform";
import {
  resolveModelForHeaderStyle,
  isClaudeModel,
  isClaudeThinkingModel,
  CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
  type ThinkingTier,
} from "./transform";
import { detectErrorType } from "./recovery";
import { getSessionFingerprint, buildFingerprintHeaders, type Fingerprint } from "./fingerprint";
import type { GoogleSearchConfig } from "./transform/types";

const log = createLogger("request");

export * from "./transform/request-thinking-utils";
import {
  buildSignatureSessionKey,
  shouldCacheThinkingSignatures,
  extractTextFromContent,
  resolveProjectKey,
  resolveConversationKey,
  resolveConversationKeyFromRequests,
  formatDebugLinesForThinking,
  injectDebugThinking,
  stripInjectedDebugFromRequestPayload,
  ensureThinkingBeforeToolUseInContents,
  ensureThinkingBeforeToolUseInMessages,
  hasToolUseInContents,
  hasSignedThinkingInContents,
  hasToolUseInMessages,
  hasSignedThinkingInMessages,
  generateSyntheticProjectId,
  SYNTHETIC_THINKING_PLACEHOLDER,
  isGenerativeLanguageRequest,
  STREAM_ACTION,
  PLUGIN_SESSION_ID,
  sessionDisplayedThinkingHashes,
  hashConversationSeed,
  extractConversationSeedFromMessages,
  extractConversationSeedFromContents,
  isGeminiToolUsePart,
  isGeminiThinkingPart,
  ensureThoughtSignature,
  hasSignedThinkingPart,
  MIN_SIGNATURE_LENGTH
} from "./transform/request-thinking-utils";

// Centralized interfaces moved to types.ts to enable project-wide type safety.

interface RecoveryError extends Error {
  [key: string]: unknown;
  recoveryType?: string;
  originalError?: unknown;
  debugInfo?: unknown;
}
/**
 * Options for request preparation.
 */
export interface PrepareRequestOptions {
  /** Enable Claude tool hardening (parameter signatures + system instruction). Default: true */
  claudeToolHardening?: boolean;
  /** Google Search configuration (global default) */
  googleSearch?: GoogleSearchConfig;
  /** Per-account fingerprint for rate limit mitigation. Falls back to session fingerprint if not provided. */
  fingerprint?: Fingerprint;
}

export function prepareAlloyRequest(
  input: RequestInfo,
  init: RequestInit | undefined,
  accessToken: string,
  projectId: string,
  endpointOverride?: string,
  headerStyle: HeaderStyle = "Alloy",
  forceThinkingRecovery = false,
  options?: PrepareRequestOptions,
): {
  request: RequestInfo;
  init: RequestInit;
  streaming: boolean;
  requestedModel?: string;
  effectiveModel?: string;
  projectId?: string;
  endpoint?: string;
  sessionId?: string;
  toolDebugMissing?: number;
  toolDebugSummary?: string;
  toolDebugPayload?: string;
  needsSignedThinkingWarmup?: boolean;
  headerStyle: HeaderStyle;
  thinkingRecoveryMessage?: string;
} {
  const baseInit: RequestInit = { ...init };
  const headers = new Headers(init?.headers ?? {});
  let resolvedProjectId = projectId?.trim() || "";
  let toolDebugMissing = 0;
  const toolDebugSummaries: string[] = [];
  let toolDebugPayload: string | undefined;
  let sessionId: string | undefined;
  let needsSignedThinkingWarmup = false;
  let thinkingRecoveryMessage: string | undefined;

  if (!isGenerativeLanguageRequest(input)) {
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

  const resolved = resolveModelForHeaderStyle(rawModel, headerStyle);
  const effectiveModel = resolved.actualModel;

  const streaming = rawAction === STREAM_ACTION;
  const defaultEndpoint = headerStyle === "gemini-cli" ? GEMINI_CLI_ENDPOINT : ALLOY_ENDPOINT;
  const baseEndpoint = endpointOverride ?? defaultEndpoint;
  const transformedUrl = `${baseEndpoint}/v1internal:${rawAction}${streaming ? "?alt=sse" : ""}`;

  const isClaude = isClaudeModel(resolved.actualModel);
  const isClaudeThinking = isClaudeThinkingModel(resolved.actualModel);

  // Tier-based thinking configuration from model resolver (can be overridden by variant config)
  let tierThinkingBudget = resolved.thinkingBudget;
  let tierThinkingLevel = resolved.thinkingLevel;
  let signatureSessionKey: string = buildSignatureSessionKey(
    PLUGIN_SESSION_ID,
    effectiveModel,
    undefined,
    resolveProjectKey(projectId),
  );

  let body = baseInit.body;
  if (typeof baseInit.body === "string" && baseInit.body) {
    try {
      const parsedBody = JSON.parse(baseInit.body) as AlloyRequestRoot;
      const isWrapped = typeof parsedBody.project === "string" && "request" in parsedBody;

      if (isWrapped) {
        const wrappedBody = {
          ...parsedBody,
          model: effectiveModel,
        } as AlloyRequestRoot;

        // Some callers may already send an Alloy-wrapped body.
        // We still need to sanitize Claude thinking blocks (remove cache_control)
        // and attach a stable sessionId so multi-turn signature caching works.
        const requestRoot = wrappedBody.request;
        const requestObjects: AlloyRequestRoot[] = [];

        if (requestRoot && typeof requestRoot === "object") {
          requestObjects.push(requestRoot);
          const nested = requestRoot.request;
          if (nested && typeof nested === "object") {
            requestObjects.push(nested);
          }
        }

        const conversationKey = resolveConversationKeyFromRequests(requestObjects);
        // Strip tier suffix from model for cache key to prevent cache misses on tier change
        // e.g., "claude-opus-4-5-thinking-high" -> "claude-opus-4-5-thinking"
        const modelForCacheKey = effectiveModel.replace(/-(minimal|low|medium|high)$/i, "");
        signatureSessionKey = buildSignatureSessionKey(PLUGIN_SESSION_ID, modelForCacheKey, conversationKey, resolveProjectKey(parsedBody.project));

        if (requestObjects.length > 0) {
          sessionId = signatureSessionKey;
        }

        for (const req of requestObjects) {
          // Use stable session ID for signature caching across multi-turn conversations
          req.sessionId = signatureSessionKey;
          stripInjectedDebugFromRequestPayload(req as Record<string, unknown>);

          // Apply signature-based thinking block firewall (Universal Hardeninig)
          // Ensures only our signed thinking blocks are sent to the model,
          // preventing cross-model leakage and API rejections.
          deepFilterThinkingBlocks(req, signatureSessionKey, getCachedSignature, isClaude);

          if (isClaude) {
            // Step 1: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
            sanitizeCrossModelPayloadInPlace(req, { targetModel: effectiveModel });

            // Step 2: Inject signed thinking from cache (after firewall filtering)
            if (isClaudeThinking && Array.isArray(req.contents)) {
              req.contents = ensureThinkingBeforeToolUseInContents(req.contents as unknown[], signatureSessionKey) as MessageContent[];
            }
            if (isClaudeThinking && Array.isArray(req.messages)) {
              req.messages = ensureThinkingBeforeToolUseInMessages(req.messages as unknown as MessageContent[], signatureSessionKey) as unknown as MessageContent[];
            }

            // Step 3: Apply tool pairing fixes (ID assignment, response matching, orphan recovery)
            applyToolPairingFixes(req as Record<string, unknown>, true);
          }
        }

        if (isClaudeThinking && sessionId) {
          const hasToolUse = requestObjects.some((req) =>
            (Array.isArray(req.contents) && hasToolUseInContents(req.contents as unknown[])) ||
            (Array.isArray(req.messages) && hasToolUseInMessages(req.messages as unknown[])),
          );
          const hasSignedThinking = requestObjects.some((req) =>
            (Array.isArray(req.contents) && hasSignedThinkingInContents(req.contents as unknown[])) ||
            (Array.isArray(req.messages) && hasSignedThinkingInMessages(req.messages as unknown[])),
          );
          const hasCachedThinking = defaultSignatureStore.has(signatureSessionKey);
          needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking;
        }

        body = JSON.stringify(wrappedBody);
      } else {
        const requestPayload: AlloyRequestRoot = { ...parsedBody };

        const rawGenerationConfig = requestPayload.generationConfig as Record<string, unknown> | undefined;
        const extraBody = requestPayload.extra_body as Record<string, unknown> | undefined;

        const variantConfig = extractVariantThinkingConfig(
          requestPayload.providerOptions as Record<string, unknown> | undefined
        );
        const isGemini3 = effectiveModel.toLowerCase().includes("gemini-3");

        if (variantConfig?.thinkingLevel && isGemini3) {
          // Gemini 3 native format - use thinkingLevel directly
          tierThinkingLevel = variantConfig.thinkingLevel;
          tierThinkingBudget = undefined;
        } else if (variantConfig?.thinkingBudget) {
          if (isGemini3) {
            // Legacy format for Gemini 3 - convert with deprecation warning
            log.warn("[Deprecated] Using thinkingBudget for Gemini 3 model. Use thinkingLevel instead.");
            tierThinkingLevel = variantConfig.thinkingBudget <= 8192 ? "low"
              : variantConfig.thinkingBudget <= 16384 ? "medium" : "high";
            tierThinkingBudget = undefined;
          } else {
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
            const toolConfig = requestPayload.toolConfig as Record<string, unknown>;
            if (!toolConfig.functionCallingConfig) {
              toolConfig.functionCallingConfig = {};
            }
            if (typeof toolConfig.functionCallingConfig === "object" && toolConfig.functionCallingConfig !== null) {
              (toolConfig.functionCallingConfig as Record<string, unknown>).mode = "VALIDATED";
            }
          }
        }

        // Resolve thinking configuration based on user settings and model capabilities
        // Image generation models don't support thinking - skip thinking config entirely
        const isImageModel = isImageGenerationModel(effectiveModel);
        const userThinkingConfig = isImageModel ? undefined : extractThinkingConfig(requestPayload, rawGenerationConfig, extraBody);
        const hasAssistantHistory = Array.isArray(requestPayload.contents) &&
          (requestPayload.contents as Record<string, unknown>[]).some((c) => c?.role === "model" || c?.role === "assistant");

        // For claude-sonnet-4-5 (without -thinking suffix), ignore client's thinkingConfig
        // Only claude-sonnet-4-5-thinking-* variants should have thinking enabled
        const isClaudeSonnetNonThinking = effectiveModel.toLowerCase() === "claude-sonnet-4-5";
        const effectiveUserThinkingConfig = (isClaudeSonnetNonThinking || isImageModel) ? undefined : userThinkingConfig;

        // For image models, add imageConfig instead of thinkingConfig
        if (isImageModel) {
          const imageConfig = buildImageGenerationConfig();
          const generationConfig = (rawGenerationConfig ?? {}) as Record<string, unknown>;
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
        } else {
          const finalThinkingConfig = resolveThinkingConfig(
            effectiveUserThinkingConfig,
            isClaudeSonnetNonThinking ? false : (resolved.isThinkingModel ?? isThinkingCapableModel(effectiveModel)),
            isClaude,
            hasAssistantHistory,
          );

          const normalizedThinking = normalizeThinkingConfig(finalThinkingConfig);
          if (normalizedThinking) {
            // Use tier-based thinking budget if specified via model suffix, otherwise fall back to user config
            const thinkingBudget = tierThinkingBudget ?? normalizedThinking.thinkingBudget;

            // Build thinking config based on model type
            let thinkingConfig: Record<string, unknown>;

            if (isClaudeThinking) {
              // Claude uses snake_case keys
              thinkingConfig = {
                include_thoughts: normalizedThinking.includeThoughts ?? true,
                ...(typeof thinkingBudget === "number" && thinkingBudget > 0
                  ? { thinking_budget: thinkingBudget }
                  : {}),
              };
            } else if (tierThinkingLevel) {
              // Gemini 3 uses thinkingLevel string (low/medium/high)
              thinkingConfig = {
                includeThoughts: normalizedThinking.includeThoughts,
                thinkingLevel: tierThinkingLevel,
              };
            } else {
              // Gemini 2.5 and others use numeric budget
              thinkingConfig = {
                includeThoughts: normalizedThinking.includeThoughts,
                ...(typeof thinkingBudget === "number" && thinkingBudget > 0 ? { thinkingBudget } : {}),
              };
            }

            if (rawGenerationConfig) {
              rawGenerationConfig.thinkingConfig = thinkingConfig;

              if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
                const currentMax = (rawGenerationConfig.maxOutputTokens ?? rawGenerationConfig.max_output_tokens) as number | undefined;
                if (!currentMax || currentMax <= thinkingBudget) {
                  rawGenerationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
                  if (rawGenerationConfig.max_output_tokens !== undefined) {
                    delete rawGenerationConfig.max_output_tokens;
                  }
                }
              }

              requestPayload.generationConfig = rawGenerationConfig;
            } else {
              const generationConfig: Record<string, unknown> = { thinkingConfig };

              if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
                generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
              }

              requestPayload.generationConfig = generationConfig;
            }
          } else if (rawGenerationConfig?.thinkingConfig) {
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
          requestPayload.systemInstruction = requestPayload.system_instruction as string | Record<string, unknown>;
          delete requestPayload.system_instruction;
        }

        if (isClaudeThinking && Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0) {
          const hint = "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";
          const existing = requestPayload.systemInstruction;

          if (typeof existing === "string") {
            requestPayload.systemInstruction = existing.trim().length > 0 ? `${existing}\n\n${hint}` : hint;
          } else if (existing && typeof existing === "object") {
            const sys = existing as Record<string, unknown>;
            const partsValue = sys.parts;

            if (Array.isArray(partsValue)) {
              const parts = partsValue as unknown[];
              let appended = false;

              for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i];
                if (part && typeof part === "object") {
                  const partRecord = part as Record<string, unknown>;
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
            } else {
              sys.parts = [{ text: hint }];
            }

            requestPayload.systemInstruction = sys as Record<string, unknown>;
          } else if (Array.isArray(requestPayload.contents)) {
            requestPayload.systemInstruction = { parts: [{ text: hint }] } as Record<string, unknown>;
          }
        }

        const cachedContentFromExtra =
          typeof requestPayload.extra_body === "object" && requestPayload.extra_body
            ? (requestPayload.extra_body as Record<string, unknown>).cached_content ??
            (requestPayload.extra_body as Record<string, unknown>).cachedContent
            : undefined;
        const cachedContent =
          (requestPayload.cached_content as string | undefined) ??
          (requestPayload.cachedContent as string | undefined) ??
          (cachedContentFromExtra as string | undefined);
        if (cachedContent) {
          requestPayload.cachedContent = cachedContent;
        }

        delete requestPayload.cached_content;
        delete requestPayload.cachedContent;
        if (requestPayload.extra_body && typeof requestPayload.extra_body === "object") {
          delete (requestPayload.extra_body as Record<string, unknown>).cached_content;
          delete (requestPayload.extra_body as Record<string, unknown>).cachedContent;
          if (Object.keys(requestPayload.extra_body as Record<string, unknown>).length === 0) {
            delete requestPayload.extra_body;
          }
        }

        // Normalize tools. For Claude models, keep full function declarations (names + schemas).
        const hasTools = Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0;

        if (hasTools) {
          if (isClaude) {
            const functionDeclarations: AlloyTool[] = [];
            const passthroughTools: AlloyTool[] = [];

            const normalizeSchema = (schema: unknown) => {
              const createPlaceholderSchema = (base: Record<string, unknown> = {}) => ({
                ...base,
                type: "object",
                properties: {
                  [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                    type: "boolean",
                    description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
                  },
                },
                required: [EMPTY_SCHEMA_PLACEHOLDER_NAME],
              });

              if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
                toolDebugMissing += 1;
                return createPlaceholderSchema();
              }

              const cleaned = cleanJSONSchemaForAlloy(schema);

              if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
                toolDebugMissing += 1;
                return createPlaceholderSchema();
              }

              // Claude VALIDATED mode requires tool parameters to be an object schema
              // with at least one property.
              const hasProperties =
                cleaned.properties &&
                typeof cleaned.properties === "object" &&
                Object.keys(cleaned.properties).length > 0;

              cleaned.type = "object";

              if (!hasProperties) {
                cleaned.properties = {
                  [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                    type: "boolean",
                    description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
                  },
                };
                cleaned.required = Array.isArray(cleaned.required)
                  ? Array.from(new Set([...cleaned.required, EMPTY_SCHEMA_PLACEHOLDER_NAME]))
                  : [EMPTY_SCHEMA_PLACEHOLDER_NAME];
              }

              return cleaned;
            };

            (requestPayload.tools as AlloyTool[]).forEach((tool: AlloyTool) => {
              const pushDeclaration = (decl: AlloyTool, source: string) => {
                const schema =
                  decl.parameters ||
                  decl.parametersJsonSchema ||
                  decl.input_schema ||
                  decl.inputSchema ||
                  tool.parameters ||
                  tool.parametersJsonSchema ||
                  tool.input_schema ||
                  tool.inputSchema ||
                  ((tool.function as AlloyTool)?.inputSchema) ||
                  ((tool.custom as AlloyTool)?.parameters) ||
                  ((tool.custom as AlloyTool)?.parametersJsonSchema) ||
                  ((tool.custom as AlloyTool)?.input_schema);

                let name =
                  decl.name ||
                  tool.name ||
                  ((tool.function as AlloyTool)?.name) ||
                  ((tool.custom as AlloyTool)?.name) ||
                  `tool-${functionDeclarations.length}`;

                // Sanitize tool name: must be alphanumeric with underscores, no special chars
                name = String(name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

                const description =
                  decl.description ||
                  tool.description ||
                  ((tool.function as AlloyTool)?.description) ||
                  ((tool.custom as AlloyTool)?.description) ||
                  "";

                functionDeclarations.push({
                  name,
                  description: String(description || ""),
                  parameters: normalizeSchema(schema) as Record<string, unknown>,
                });

                toolDebugSummaries.push(
                  `decl=${name},src=${source},hasSchema=${schema ? "y" : "n"}`,
                );
              };

              if (Array.isArray(tool.functionDeclarations) && tool.functionDeclarations.length > 0) {
                (tool.functionDeclarations as Record<string, unknown>[]).forEach((decl) => pushDeclaration(decl, "functionDeclarations"));
                return;
              }

              // Fall back to function/custom style definitions.
              if (
                tool.function ||
                tool.custom ||
                tool.parameters ||
                tool.input_schema ||
                tool.inputSchema
              ) {
                pushDeclaration((tool.function as AlloyTool) ?? (tool.custom as AlloyTool) ?? tool, "function/custom");
                return;
              }

              // Preserve any non-function tool entries (e.g., codeExecution) untouched.
              passthroughTools.push(tool);
            });

            const finalTools: AlloyTool[] = [];
            if (functionDeclarations.length > 0) {
              finalTools.push({ functionDeclarations });
            }
            requestPayload.tools = finalTools.concat(passthroughTools);
          } else {
            // Gemini-specific tool normalization and feature injection
            const geminiResult = applyGeminiTransforms(requestPayload, {
              model: effectiveModel,
              normalizedThinking: undefined, // Thinking config already applied above (lines 816-880)
              tierThinkingBudget,
              tierThinkingLevel: tierThinkingLevel as ThinkingTier | undefined,
            });

            toolDebugMissing = geminiResult.toolDebugMissing;
            toolDebugSummaries.push(...geminiResult.toolDebugSummaries);
          }

          try {
            toolDebugPayload = JSON.stringify(requestPayload.tools);
          } catch {
            toolDebugPayload = undefined;
          }

          // Apply Claude tool hardening (ported from LLM-API-Key-Proxy)
          // Injects parameter signatures into descriptions and adds system instruction
          // Can be disabled via config.claude_tool_hardening = false to reduce context size
          const enableToolHardening = options?.claudeToolHardening ?? true;
          if (enableToolHardening && isClaude && Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0) {
            // Inject parameter signatures into tool descriptions
            requestPayload.tools = injectParameterSignatures(
              requestPayload.tools,
              CLAUDE_DESCRIPTION_PROMPT,
            );

            // Inject tool hardening system instruction
            injectToolHardeningInstruction(
              requestPayload as Record<string, unknown>,
              CLAUDE_TOOL_SYSTEM_INSTRUCTION,
            );
          }
        }

        const conversationKey = resolveConversationKey(requestPayload);
        signatureSessionKey = buildSignatureSessionKey(PLUGIN_SESSION_ID, effectiveModel, conversationKey, resolveProjectKey(projectId));

        // For Claude models, filter out unsigned thinking blocks (required by Claude API)
        // Attempts to restore signatures from cache for multi-turn conversations
        // Handle both Gemini-style contents[] and Anthropic-style messages[] payloads.
        // Apply signature-based thinking block firewall (Universal Hardeninig)
        deepFilterThinkingBlocks(requestPayload, signatureSessionKey, getCachedSignature, isClaude);

        if (isClaude) {
          // Step 1: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
          sanitizeCrossModelPayloadInPlace(requestPayload, { targetModel: effectiveModel });

          // Step 2: Inject signed thinking from cache (after firewall filtering)
          if (isClaudeThinking && Array.isArray(requestPayload.contents)) {
            requestPayload.contents = ensureThinkingBeforeToolUseInContents(requestPayload.contents as unknown[], signatureSessionKey) as MessageContent[];
          }
          if (isClaudeThinking && Array.isArray(requestPayload.messages)) {
            requestPayload.messages = ensureThinkingBeforeToolUseInMessages(requestPayload.messages as unknown[], signatureSessionKey) as MessageContent[];
          }

          // Step 3: Check if warmup needed (AFTER injection attempt)
          if (isClaudeThinking) {
            const hasToolUse =
              (Array.isArray(requestPayload.contents) && hasToolUseInContents(requestPayload.contents)) ||
              (Array.isArray(requestPayload.messages) && hasToolUseInMessages(requestPayload.messages));
            const hasSignedThinking =
              (Array.isArray(requestPayload.contents) && hasSignedThinkingInContents(requestPayload.contents)) ||
              (Array.isArray(requestPayload.messages) && hasSignedThinkingInMessages(requestPayload.messages));
            const hasCachedThinking = defaultSignatureStore.has(signatureSessionKey);
            needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking;
          }
        }

        // For Claude models, ensure functionCall/tool use parts carry IDs (required by Anthropic).
        // We use a two-pass approach: first collect all functionCalls and assign IDs,
        // then match functionResponses to their corresponding calls using a FIFO queue per function name.
        if (isClaude && Array.isArray(requestPayload.contents)) {
          let toolCallCounter = 0;
          // Track pending call IDs per function name as a FIFO queue
          const pendingCallIdsByName = new Map<string, string[]>();

          // First pass: assign IDs to all functionCalls and collect them
          requestPayload.contents = ((requestPayload.contents as Record<string, unknown>[]).map((content) => {
            if (!content || !Array.isArray(content.parts)) {
              return content as MessageContent;
            }

            const newParts = (content.parts as MessagePart[]).map((part) => {
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
          })) as unknown as MessageContent[];

          // Second pass: match functionResponses to their corresponding calls (FIFO order)
          requestPayload.contents = ((requestPayload.contents as Record<string, unknown>[]).map((content) => {
            if (!content || !Array.isArray(content.parts)) {
              return content as MessageContent;
            }

            const newParts = (content.parts as MessagePart[]).map((part) => {
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
          })) as unknown as MessageContent[];

          // Third pass: Apply orphan recovery for mismatched tool IDs
          // This handles cases where context compaction or other processes
          // create ID mismatches between calls and responses.
          // Ported from LLM-API-Key-Proxy's _fix_tool_response_grouping()
          requestPayload.contents = fixToolResponseGrouping(requestPayload.contents as MessageContent[]);
        }

        // Fourth pass: Fix Claude format tool pairing (defense in depth)
        // Handles orphaned tool_use blocks in Claude's messages[] format
        if (Array.isArray(requestPayload.messages)) {
          requestPayload.messages = validateAndFixClaudeToolPairing(requestPayload.messages) as unknown as MessageContent[];
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
          const conversationState = analyzeConversationState(requestPayload.contents);

          // Force recovery if API returned thinking_block_order error (retry case)
          // or if proactive check detects we need recovery
          if (forceThinkingRecovery || needsThinkingRecovery(conversationState)) {
            // Set message for toast notification (shown in plugin.ts, respects quiet mode)
            thinkingRecoveryMessage = forceThinkingRecovery
              ? "Thinking recovery: retrying with fresh turn (API error)"
              : "Thinking recovery: restarting turn (corrupted context)";

            requestPayload.contents = closeToolLoopForThinking(requestPayload.contents) as unknown as MessageContent[];

            defaultSignatureStore.delete(signatureSessionKey);
          }
        }

        if ("model" in requestPayload) {
          delete requestPayload.model;
        }

        stripInjectedDebugFromRequestPayload(requestPayload);

        const effectiveProjectId = projectId?.trim() || generateSyntheticProjectId();
        resolvedProjectId = effectiveProjectId;

        // Inject Alloy system instruction with role "user" (CLIProxyAPI v6.6.89 compatibility)
        // This sets request.systemInstruction.role = "user" and request.systemInstruction.parts[0].text
        if (headerStyle === "Alloy") {
          const existingSystemInstruction = requestPayload.systemInstruction;
          if (existingSystemInstruction && typeof existingSystemInstruction === "object") {
            const sys = existingSystemInstruction as Record<string, unknown>;
            sys.role = "user";
            if (Array.isArray(sys.parts) && sys.parts.length > 0) {
              const firstPart = sys.parts[0] as Record<string, unknown>;
              if (firstPart && typeof firstPart.text === "string") {
                firstPart.text = ALLOY_SYSTEM_INSTRUCTION + "\n\n" + firstPart.text;
              } else {
                sys.parts = [{ text: ALLOY_SYSTEM_INSTRUCTION }, ...sys.parts];
              }
            } else {
              sys.parts = [{ text: ALLOY_SYSTEM_INSTRUCTION }];
            }
          } else if (typeof existingSystemInstruction === "string") {
            requestPayload.systemInstruction = {
              role: "user",
              parts: [{ text: ALLOY_SYSTEM_INSTRUCTION + "\n\n" + existingSystemInstruction }],
            };
          } else {
            requestPayload.systemInstruction = {
              role: "user",
              parts: [{ text: ALLOY_SYSTEM_INSTRUCTION }],
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
          requestId: "agent-" + crypto.randomUUID(),
        });
        if (wrappedBody.request && typeof wrappedBody.request === 'object') {
          // Use stable session ID for signature caching across multi-turn conversations
          sessionId = signatureSessionKey;
          (wrappedBody.request as AlloyRequestRoot).sessionId = signatureSessionKey;
        }

        body = JSON.stringify(wrappedBody);
      }
    } catch (e) {
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
    } else {
      headers.set("anthropic-beta", interleavedHeader);
    }
  }

  // Use randomized headers as the fallback pool
  const selectedHeaders = getRandomizedHeaders(headerStyle);

  if (headerStyle === "Alloy") {
    // Alloy mode: Use fingerprint headers for device identity and quota tracking
    // Fingerprint headers override randomized headers for User-Agent, X-Goog-Api-Client, Client-Metadata
    // and add X-Goog-QuotaUser, X-Client-Device-Id for unique device identity
    const fingerprint = options?.fingerprint ?? getSessionFingerprint();
    const fingerprintHeaders = buildFingerprintHeaders(fingerprint);

    // Apply fingerprint headers (override randomized with fingerprint if available)
    headers.set("User-Agent", fingerprintHeaders["User-Agent"] || selectedHeaders["User-Agent"]);
    headers.set("X-Goog-Api-Client", fingerprintHeaders["X-Goog-Api-Client"] || selectedHeaders["X-Goog-Api-Client"]);
    headers.set("Client-Metadata", fingerprintHeaders["Client-Metadata"] || selectedHeaders["Client-Metadata"]);

    // Add fingerprint-specific headers for device identity (Alloy only)
    const fHeaders = fingerprintHeaders as Record<string, string>;
    if (fHeaders["X-Goog-QuotaUser"]) {
      headers.set("X-Goog-QuotaUser", fHeaders["X-Goog-QuotaUser"]);
    }
    if (fHeaders["X-Client-Device-Id"]) {
      headers.set("X-Client-Device-Id", fHeaders["X-Client-Device-Id"]);
    }
  } else {
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

export function buildThinkingWarmupBody(
  bodyText: string | undefined,
  isClaudeThinking: boolean,
): string | null {
  if (!bodyText || !isClaudeThinking) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return null;
  }

  const warmupPrompt = "Warmup request for thinking signature.";

  const updateRequest = (req: Record<string, unknown>) => {
    req.contents = [{ role: "user", parts: [{ text: warmupPrompt }] }];
    delete req.tools;
    delete (req as Record<string, unknown>).toolConfig;

    const generationConfig = (req.generationConfig ?? {}) as Record<string, unknown>;
    generationConfig.thinkingConfig = {
      include_thoughts: true,
      thinking_budget: DEFAULT_THINKING_BUDGET,
    };
    generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
    req.generationConfig = generationConfig;
  };

    if (parsed.request && typeof parsed.request === "object") {
      updateRequest(parsed.request as Record<string, unknown>);
      const nested = (parsed.request as AlloyRequestRoot).request;
    if (nested && typeof nested === "object") {
      updateRequest(nested as Record<string, unknown>);
    }
  } else {
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
export async function transformAlloyResponse(
  response: Response,
  streaming: boolean,
  debugContext?: AlloyDebugContext | null,
  requestedModel?: string,
  projectId?: string,
  endpoint?: string,
  effectiveModel?: string,
  sessionId?: string,
  toolDebugMissing?: number,
  toolDebugSummary?: string,
  toolDebugPayload?: string,
  debugLines?: string[],
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJsonResponse = contentType.includes("application/json");
  const isEventStreamResponse = contentType.includes("text/event-stream");

  // Generate text for thinking injection:
  // - If debug=true: inject full debug logs
  // - If keep_thinking=true (but no debug): inject placeholder to trigger signature caching
  // Both use the same injection path (injectDebugThinking) for consistent behavior
  const debugText =
    isDebugEnabled() && Array.isArray(debugLines) && debugLines.length > 0
      ? formatDebugLinesForThinking(debugLines)
      : getKeepThinking()
        ? SYNTHETIC_THINKING_PLACEHOLDER
        : undefined;
  const cacheSignatures = shouldCacheThinkingSignatures(effectiveModel);

  if (!isJsonResponse && !isEventStreamResponse) {
    logAlloyDebugResponse(debugContext, response, {
      note: "Non-JSON response (body omitted)",
    });
    return response;
  }

  // For successful streaming responses, use TransformStream to transform SSE events
  // while maintaining real-time streaming (no buffering of entire response).
  // This enables thinking tokens to be displayed as they arrive, like the Codex plugin.
  if (streaming && response.ok && isEventStreamResponse && response.body) {
    const headers = new Headers(response.headers);

    logAlloyDebugResponse(debugContext, response, {
      note: "Streaming SSE response (real-time transform)",
    });

    const streamingTransformer = createStreamingTransformer(
      defaultSignatureStore,
      {
        onCacheSignature: cacheSignature,
        onInjectDebug: injectDebugThinking,
        // onInjectSyntheticThinking removed - keep_thinking now uses debugText path
        transformThinkingParts,
      },
      {
        signatureSessionKey: sessionId,
        debugText,
        cacheSignatures,
        displayedThinkingHashes: effectiveModel && isGemini3Model(effectiveModel) ? sessionDisplayedThinkingHashes : undefined,
        // injectSyntheticThinking removed - keep_thinking now unified with debug via debugText
      },
    );
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
      } catch {
        errorBody = { error: { message: text } };
      }

      // Inject Debug Info
      if (errorBody?.error) {
        const debugInfo = `\n\n[Debug Info]\nRequested Model: ${requestedModel || "Unknown"}\nEffective Model: ${effectiveModel || "Unknown"}\nProject: ${projectId || "Unknown"}\nEndpoint: ${endpoint || "Unknown"}\nStatus: ${response.status}\nRequest ID: ${headers.get("x-request-id") || "N/A"}${toolDebugMissing !== undefined ? `\nTool Debug Missing: ${toolDebugMissing}` : ""}${toolDebugSummary ? `\nTool Debug Summary: ${toolDebugSummary}` : ""}${toolDebugPayload ? `\nTool Debug Payload: ${toolDebugPayload}` : ""}`;
        const injectedDebug = debugText ? `\n\n${debugText}` : "";
        errorBody.error.message = (errorBody.error.message || "Unknown error") + debugInfo + injectedDebug;

        // Check if this is a recoverable thinking error - throw to trigger retry
        const errorType = detectErrorType(errorBody.error.message || "");
        if (errorType === "thinking_block_order") {
          const recoveryError = new Error("THINKING_RECOVERY_NEEDED") as RecoveryError;
          recoveryError.recoveryType = errorType;
          recoveryError.originalError = errorBody;
          recoveryError.debugInfo = debugInfo;
          throw recoveryError;
        }

        // Detect context length / prompt too long errors - signal to caller for toast
        const errorMessage = errorBody.error.message?.toLowerCase() || "";
        if (
          errorMessage.includes("prompt is too long") ||
          errorMessage.includes("context length exceeded") ||
          errorMessage.includes("context_length_exceeded") ||
          errorMessage.includes("maximum context length")
        ) {
          headers.set("x-Alloy-context-error", "prompt_too_long");
        }

        // Detect tool pairing errors - signal to caller for toast
        if (
          errorMessage.includes("tool_use") &&
          errorMessage.includes("tool_result") &&
          (errorMessage.includes("without") || errorMessage.includes("immediately after"))
        ) {
          headers.set("x-Alloy-context-error", "tool_pairing");
        }

        return new Response(JSON.stringify(errorBody), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      if (errorBody?.error?.details && Array.isArray(errorBody.error.details)) {
        const retryInfo = (errorBody.error.details as Record<string, unknown>[]).find(
          (detail) => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
        );

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


    const usageFromSse = streaming && isEventStreamResponse ? extractUsageFromSsePayload(text) : null;
    const parsed: AlloyApiBody | null = !streaming || !isEventStreamResponse ? parseAlloyApiBody(text) : null;
    const patched = parsed ? rewriteAlloyPreviewAccessError(parsed, response.status, requestedModel) : null;
    const effectiveBody = patched ?? parsed ?? undefined;

    const usage = usageFromSse ?? (effectiveBody ? extractUsageMetadata(effectiveBody) : null);
    
    // Log cache stats when available
    if (usage && effectiveModel) {
      logCacheStats(
        effectiveModel,
        usage.cachedContentTokenCount ?? 0,
        0, // API doesn't provide cache write tokens separately
        usage.promptTokenCount ?? usage.totalTokenCount ?? 0,
      );
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

    logAlloyDebugResponse(debugContext, response, {
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
  } catch (error) {
    return handleAlloyError(error, debugContext, requestedModel, projectId, endpoint);
  }
}

async function handleAlloyError(error: unknown, _debugContext: AlloyDebugContext | null | undefined, _model?: string, _project?: string, _endpoint?: string) {
  return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
}

// ============================================================================
// TEST-ONLY EXPORTS
// Exposes private functions to request.test.ts for unit testing.
// ============================================================================
export const __testExports = {
  buildSignatureSessionKey,
  hashConversationSeed,
  extractTextFromContent,
  extractConversationSeedFromMessages,
  extractConversationSeedFromContents,
  resolveProjectKey,
  isGeminiToolUsePart,
  isGeminiThinkingPart,
  ensureThoughtSignature,
  hasSignedThinkingPart,
  hasToolUseInContents,
  hasSignedThinkingInContents,
  hasToolUseInMessages,
  hasSignedThinkingInMessages,
  generateSyntheticProjectId,
  MIN_SIGNATURE_LENGTH,
  transformStreamingPayload,
  createStreamingTransformer,
  transformSseLine,
};
