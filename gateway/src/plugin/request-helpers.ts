import { z } from "zod";
import { getKeepThinking } from "./config";
import { createLogger } from "./logger";
import {
  SKIP_THOUGHT_SIGNATURE,
} from "../constants";
import { processImageData } from "./image-saver";
import type { GoogleSearchConfig } from "./transform/types";
import type { MessageContent, MessagePart } from "./types";

const log = createLogger("request-helpers");

const ALLOY_PREVIEW_LINK = "https://goo.gle/enable-preview-features"; // TODO: Update to Alloy link if available

export { cleanJSONSchemaForAlloy } from "./transform/json-schema-cleaner";

export const AlloyApiErrorSchema = z.record(z.string(), z.unknown()).and(z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  status: z.string().optional(),
}));

export type AlloyApiError = z.infer<typeof AlloyApiErrorSchema>;

/**
 * Minimal representation of Alloy API responses we touch.
 */
export const AlloyApiBodySchema = z.record(z.string(), z.unknown()).and(z.object({
  response: z.unknown().optional(),
  error: AlloyApiErrorSchema.optional(),
}));

export type AlloyApiBody = z.infer<typeof AlloyApiBodySchema>;

/**
 * Usage metadata exposed by Alloy responses. Fields are optional to reflect partial payloads.
 */
export const AlloyUsageMetadataSchema = z.object({
  totalTokenCount: z.number().optional(),
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  cachedContentTokenCount: z.number().optional(),
  thoughtsTokenCount: z.number().optional(),
});

export type AlloyUsageMetadata = z.infer<typeof AlloyUsageMetadataSchema>;

/**
 * Normalized thinking configuration accepted by Alloy.
 */
export const ThinkingConfigSchema = z.object({
  thinkingBudget: z.number().optional(),
  includeThoughts: z.boolean().optional(),
});

export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;

/**
 * Default token budget for thinking/reasoning. 16000 tokens provides sufficient
 * space for complex reasoning while staying within typical model limits.
 */
export const DEFAULT_THINKING_BUDGET = 16000;

/**
 * Checks if a model name indicates thinking/reasoning capability.
 * Models with "thinking", "gemini-3", or "opus" in their name support extended thinking.
 */
export function isThinkingCapableModel(modelName: string): boolean {
  const lowerModel = modelName.toLowerCase();
  return lowerModel.includes("thinking")
    || lowerModel.includes("gemini-3")
    || lowerModel.includes("opus");
}

/**
 * Extracts thinking configuration from various possible request locations.
 * Supports both Gemini-style thinkingConfig and Anthropic-style thinking options.
 */
export function extractThinkingConfig(
  requestPayload: Record<string, unknown>,
  rawGenerationConfig: Record<string, unknown> | undefined,
  extraBody: Record<string, unknown> | undefined,
): ThinkingConfig | undefined {
  const thinkingConfig = rawGenerationConfig?.thinkingConfig
    ?? extraBody?.thinkingConfig
    ?? requestPayload.thinkingConfig;

  if (thinkingConfig && typeof thinkingConfig === "object") {
    const config = thinkingConfig as Record<string, unknown>;
    return {
      includeThoughts: Boolean(config.includeThoughts),
      thinkingBudget: typeof config.thinkingBudget === "number" ? config.thinkingBudget : DEFAULT_THINKING_BUDGET,
    };
  }

  // Convert Anthropic-style "thinking" option: { type: "enabled", budgetTokens: N }
  const anthropicThinking = extraBody?.thinking ?? requestPayload.thinking;
  if (anthropicThinking && typeof anthropicThinking === "object") {
    const thinking = anthropicThinking as Record<string, unknown>;
    if (thinking.type === "enabled" || thinking.budgetTokens) {
      return {
        includeThoughts: true,
        thinkingBudget: typeof thinking.budgetTokens === "number" ? thinking.budgetTokens : DEFAULT_THINKING_BUDGET,
      };
    }
  }

  return undefined;
}

/**
 * Variant thinking config extracted from OpenCode's providerOptions.
 */
export interface VariantThinkingConfig {
  /** Gemini 3 native thinking level (low/medium/high) */
  thinkingLevel?: string;
  /** Numeric thinking budget for Claude and Gemini 2.5 */
  thinkingBudget?: number;
  /** Whether to include thoughts in output */
  includeThoughts?: boolean;
  /** Google Search configuration */
  googleSearch?: GoogleSearchConfig;
}

/**
 * Extracts variant thinking config from OpenCode's providerOptions.
 * 
 * All Alloy models route through the Google provider, so we only check
 * providerOptions.google. Supports two formats:
 * 
 * 1. Gemini 3 native: { google: { thinkingLevel: "high", includeThoughts: true } }
 * 2. Budget-based (Claude/Gemini 2.5): { google: { thinkingConfig: { thinkingBudget: 32000 } } }
 */
export function extractVariantThinkingConfig(
  providerOptions: Record<string, unknown> | undefined
): VariantThinkingConfig | undefined {
  if (!providerOptions) return undefined;

  const google = providerOptions.google as Record<string, unknown> | undefined;
  if (!google) return undefined;

  const result: VariantThinkingConfig = {};

  // Gemini 3 native format: { google: { thinkingLevel: "high", includeThoughts: true } }
  // thinkingLevel takes priority over thinkingBudget - they are mutually exclusive
  if (typeof google.thinkingLevel === "string") {
    result.thinkingLevel = google.thinkingLevel;
    result.includeThoughts = typeof google.includeThoughts === "boolean" ? google.includeThoughts : undefined;
  } else if (google.thinkingConfig && typeof google.thinkingConfig === "object") {
    // Budget-based format (Claude/Gemini 2.5): { google: { thinkingConfig: { thinkingBudget } } }
    // Only used when thinkingLevel is not present
    const tc = google.thinkingConfig as Record<string, unknown>;
    if (typeof tc.thinkingBudget === "number") {
      result.thinkingBudget = tc.thinkingBudget;
    }
  }

  // Extract Google Search config
  if (google.googleSearch && typeof google.googleSearch === "object") {
    const search = google.googleSearch as Record<string, unknown>;
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
export function resolveThinkingConfig(
  userConfig: ThinkingConfig | undefined,
  isThinkingModel: boolean,
  _isClaudeModel: boolean,
  _hasAssistantHistory: boolean,
): ThinkingConfig | undefined {
  // For thinking-capable models (including Claude thinking models), enable thinking by default
  // The signature validation/restoration is handled by filterUnsignedThinkingBlocks
  if (isThinkingModel && !userConfig) {
    return { includeThoughts: true, thinkingBudget: DEFAULT_THINKING_BUDGET };
  }

  return userConfig;
}

/**
 * Checks if a part is a thinking/reasoning block (Anthropic or Gemini style).
 */
function isThinkingPart(part: Record<string, unknown>): boolean {
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
function hasSignatureField(part: Record<string, unknown>): boolean {
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
function isToolBlock(part: Record<string, unknown>): boolean {
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
export function stripAllThinkingBlocks(contentArray: MessagePart[]): MessagePart[] {
  return contentArray.filter(item => {
    if (!item || typeof item !== "object") return true;
    const block = item as Record<string, unknown>;
    if (isToolBlock(block)) return true;
    if (isThinkingPart(block)) return false;
    if (hasSignatureField(block)) return false;
    return true;
  });
}

/**
 * Removes trailing thinking blocks from a content array.
 * Claude API requires that assistant messages don't end with thinking blocks.
 * Only removes unsigned thinking blocks; preserves those with valid signatures.
 */
function removeTrailingThinkingBlocks(
  contentArray: MessagePart[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
): MessagePart[] {
  const result = [...contentArray];

  while (result.length > 0) {
    const lastPart = result[result.length - 1];
    if (!lastPart || typeof lastPart !== "object") break;
    const block = lastPart as Record<string, unknown>;
    
    if (!isThinkingPart(block)) break;

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
function hasValidSignature(part: Record<string, unknown>): boolean {
  const signature = part.thought === true ? part.thoughtSignature : part.signature;
  return typeof signature === "string" && signature.length >= 50;
}

/**
 * Gets the signature from a thinking part, if present.
 */
function getSignature(part: Record<string, unknown>): string | undefined {
  const signature = part.thought === true ? part.thoughtSignature : part.signature;
  return typeof signature === "string" ? signature : undefined;
}

/**
 * Checks if a thinking part's signature was generated by our plugin (exists in our cache).
 * This prevents accepting signatures from other providers (e.g., direct Anthropic API, OpenAI)
 * which would cause "Invalid signature" errors when sent to Alloy Claude.
 */
function isOurCachedSignature(
  part: Record<string, unknown>,
  sessionId: string | undefined,
  getCachedSignatureFn: ((sessionId: string, text: string) => string | undefined) | undefined,
): boolean {
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
function getThinkingText(part: Record<string, unknown>): string {
  if (typeof part.text === "string") return part.text;
  if (typeof part.thinking === "string") return part.thinking;

  if (part.text && typeof part.text === "object") {
    const maybeText = (part.text as Record<string, unknown>).text;
    if (typeof maybeText === "string") return maybeText;
  }

  if (part.thinking && typeof part.thinking === "object") {
    const maybeText = (part.thinking as Record<string, unknown>).text ?? (part.thinking as Record<string, unknown>).thinking;
    if (typeof maybeText === "string") return maybeText;
  }

  return "";
}

/**
 * Recursively strips cache_control and providerOptions from any object.
 * These fields can be injected by SDKs, but Claude rejects them inside thinking blocks.
 */
function stripCacheControlRecursively(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(item => stripCacheControlRecursively(item));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "cache_control" || key === "providerOptions") continue;
    result[key] = stripCacheControlRecursively(value);
  }
  return result;
}

/**
 * Sanitizes a thinking part by keeping only the allowed fields.
 * In particular, ensures `thinking` is a string (not an object with cache_control).
 * Returns null if the thinking block has no valid content.
 */
function sanitizeThinkingPart(part: Record<string, unknown>): Record<string, unknown> | null {
  // Gemini-style thought blocks: { thought: true, text, thoughtSignature }
  if (part.thought === true) {
    let textContent: unknown = part.text;
    if (typeof textContent === "object" && textContent !== null) {
      const maybeText = (textContent as Record<string, unknown>).text;
      textContent = typeof maybeText === "string" ? maybeText : undefined;
    }

    const hasContent = typeof textContent === "string" && textContent.trim().length > 0;
    if (!hasContent && !part.thoughtSignature) {
      return null;
    }

    const sanitized: Record<string, unknown> = { thought: true };
    if (textContent !== undefined) sanitized.text = textContent;
    if (part.thoughtSignature !== undefined) sanitized.thoughtSignature = part.thoughtSignature;
    return sanitized;
  }

  // Anthropic-style thinking/redacted_thinking blocks: { type: "thinking"|"redacted_thinking", thinking, signature }
  if (part.type === "thinking" || part.type === "redacted_thinking" || part.thinking !== undefined) {
    let thinkingContent: unknown = part.thinking ?? part.text;
    if (thinkingContent !== undefined && typeof thinkingContent === "object" && thinkingContent !== null) {
      const maybeText = (thinkingContent as Record<string, unknown>).text ?? (thinkingContent as Record<string, unknown>).thinking;
      thinkingContent = typeof maybeText === "string" ? maybeText : undefined;
    }

    const hasContent = typeof thinkingContent === "string" && thinkingContent.trim().length > 0;
    if (!hasContent && !part.signature) {
      return null;
    }

    const sanitized: Record<string, unknown> = { type: part.type === "redacted_thinking" ? "redacted_thinking" : "thinking" };
    if (thinkingContent !== undefined) sanitized.thinking = thinkingContent;
    if (part.signature !== undefined) sanitized.signature = part.signature;
    return sanitized;
  }

  // Reasoning blocks (OpenCode format): { type: "reasoning", text, signature }
  if (part.type === "reasoning") {
    let textContent: unknown = part.text;
    if (typeof textContent === "object" && textContent !== null) {
      const maybeText = (textContent as Record<string, unknown>).text;
      textContent = typeof maybeText === "string" ? maybeText : undefined;
    }

    const hasContent = typeof textContent === "string" && textContent.trim().length > 0;
    if (!hasContent && !part.signature) {
      return null;
    }

    const sanitized: Record<string, unknown> = { type: "reasoning" };
    if (textContent !== undefined) sanitized.text = textContent;
    if (part.signature !== undefined) sanitized.signature = part.signature;
    return sanitized;
  }

  // Fallback: strip cache_control recursively.
  return stripCacheControlRecursively(part) as Record<string, unknown>;
}

function findLastAssistantIndex(contents: MessageContent[], roleValue: string): number {
  for (let i = contents.length - 1; i >= 0; i--) {
    const content = contents[i];
    if (content && typeof content === "object" && content.role === roleValue) {
      return i;
    }
  }
  return -1;
}

function filterContentArray(
  contentArray: MessagePart[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
  isLastAssistantMessage: boolean = false,
): MessagePart[] {
  // For Claude models, strip thinking blocks by default for reliability
  // User can opt-in to keep thinking via config: { "keep_thinking": true }
  if (isClaudeModel && !getKeepThinking()) {
    return stripAllThinkingBlocks(contentArray);
  }

  const filtered: MessagePart[] = [];

  for (const item of contentArray) {
    if (!item || typeof item !== "object") {
      filtered.push(item);
      continue;
    }

    const block = item as Record<string, unknown>;

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
        if (sanitized) filtered.push(sanitized as MessagePart);
        continue;
      }
      
      // Not our signature (or no signature) - inject sentinel
      const thinkingText = getThinkingText(block) || "";
      log.debug(`Injecting sentinel for last-message thinking block`);
      const sentinelPart = {
        type: block.type || "thinking",
        thinking: thinkingText,
        signature: SKIP_THOUGHT_SIGNATURE,
      };
      filtered.push(sentinelPart as MessagePart);
      continue;
    }

    if (isOurCachedSignature(block, sessionId, getCachedSignatureFn)) {
      const sanitized = sanitizeThinkingPart(block);
      if (sanitized) filtered.push(sanitized as MessagePart);
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
          } else {
            restoredPart.signature = cachedSignature;
          }
          const sanitized = sanitizeThinkingPart(restoredPart);
          if (sanitized) filtered.push(sanitized as MessagePart);
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
export function filterUnsignedThinkingBlocks(
  contents: MessageContent[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): MessageContent[] {
  const lastAssistantIdx = findLastAssistantIndex(contents, "model");

  return contents.map((content, idx) => {
    if (!content || typeof content !== "object") {
      return content;
    }

    const isLastAssistant = idx === lastAssistantIdx;

    if (Array.isArray(content.parts)) {
      const filteredParts = filterContentArray(
        content.parts,
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
        isLastAssistant,
      );

      const trimmedParts = content.role === "model" && !isClaudeModel
        ? removeTrailingThinkingBlocks(filteredParts, sessionId, getCachedSignatureFn)
        : filteredParts;

      return { ...content, parts: trimmedParts };
    }

    if (Array.isArray(content.content)) {
      const isAssistantRole = content.role === "assistant";
      const isLastAssistantContent = idx === lastAssistantIdx || 
        (isAssistantRole && idx === findLastAssistantIndex(contents, "assistant"));
      
      const filteredContent = filterContentArray(
        content.content as MessagePart[],
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
        isLastAssistantContent,
      );

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
export function filterMessagesThinkingBlocks(
  messages: MessageContent[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): MessageContent[] {
  const lastAssistantIdx = findLastAssistantIndex(messages, "assistant");

  return messages.map((message, idx) => {
    if (!message || typeof message !== "object") {
      return message;
    }

    if (Array.isArray(message.content)) {
      const isAssistantRole = message.role === "assistant";
      const isLastAssistant = isAssistantRole && idx === lastAssistantIdx;
      
      const filteredContent = filterContentArray(
        message.content as MessagePart[],
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
        isLastAssistant,
      );

      const trimmedContent = isAssistantRole && !isClaudeModel
        ? removeTrailingThinkingBlocks(filteredContent, sessionId, getCachedSignatureFn)
        : filteredContent;

      return { ...message, content: trimmedContent };
    }

    return message;
  });
}

export function deepFilterThinkingBlocks(
  payload: unknown,
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): unknown {
  const visited = new WeakSet<object>();

  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }

    if (visited.has(value as object)) {
      return;
    }

    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((item) => walk(item));
      return;
    }

    const obj = value as Record<string, unknown>;

    if (Array.isArray(obj.contents)) {
      obj.contents = filterUnsignedThinkingBlocks(
        obj.contents as MessageContent[],
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
      );
    }

    if (Array.isArray(obj.messages)) {
      obj.messages = filterMessagesThinkingBlocks(
        obj.messages as MessageContent[],
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
      );
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
export function detectShadowThinkingBlocks(payload: unknown): unknown {
  const visited = new WeakSet<object>();

  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (typeof item === 'object' && item !== null) {
          walk(item);
        } else if (typeof item === 'string') {
          // Detect "Shadow" thinking block strings
          if (isShadowThinkingString(item)) {
            log.warn("Shadow thinking block detected and neutralized in array.");
            (value as Record<string, unknown>[])[idx] = "[REDACTED: SHADOW BLOCK]" as any;
          }
        }
      });
      return;
    }

    const obj = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string' && (key === 'text' || key === 'content')) {
        if (isShadowThinkingString(val)) {
          log.warn(`Shadow thinking block detected in field "${key}" and neutralized.`);
          obj[key] = "[REDACTED: SHADOW BLOCK]";
        }
      } else if (typeof val === 'object' && val !== null) {
        walk(val);
      }
    }
  };

  walk(payload);
  return payload;
}

function isShadowThinkingString(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20) return false;
  
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
    } catch {
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
function transformGeminiCandidate(candidate: Record<string, unknown>): Record<string, unknown> {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }

  const content = candidate.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
    return candidate;
  }

  const thinkingTexts: string[] = [];
  const transformedParts = content.parts.map((item: unknown) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const part = item as Record<string, unknown>;

    // Handle Gemini-style: thought: true
    if (part.thought === true) {
      const thinkingText = (part.text as string) || "";
      thinkingTexts.push(thinkingText);
      const transformed: Record<string, unknown> = { ...part, type: "reasoning" };
      if (part.cache_control) transformed.cache_control = part.cache_control;

      // Convert signature to providerMetadata format for OpenCode
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
      const thinkingText = (part.thinking as string) || (part.text as string) || "";
      thinkingTexts.push(thinkingText);
      const transformed: Record<string, unknown> = {
        ...part,
        type: "reasoning",
        text: thinkingText,
        thought: true,
      };
      if (part.cache_control) transformed.cache_control = part.cache_control;

      // Convert signature to providerMetadata format for OpenCode
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
      const fc = part.functionCall as Record<string, unknown>;
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
      const id = part.inlineData as { mimeType: string, data: string };
      const result = processImageData({
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
 * Transforms thinking/reasoning content in response parts to OpenCode's expected format.
 * Handles both Gemini-style (thought: true) and Anthropic-style (type: "thinking") formats.
 * Also extracts reasoning_content for Anthropic-style responses.
 */
export function transformThinkingParts(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    return response;
  }

  const resp = response as Record<string, unknown>;
  const result: Record<string, unknown> = { ...resp };
  const reasoningTexts: string[] = [];

  // Handle Anthropic-style content array (type: "thinking")
  if (Array.isArray(resp.content)) {
    const transformedContent: unknown[] = [];
    for (const item of resp.content) {
      if (item && typeof item === "object" && (item as Record<string, unknown>).type === "thinking") {
        const block = item as Record<string, unknown>;
        const thinkingText = (block.thinking as string) || (block.text as string) || "";
        reasoningTexts.push(thinkingText);
        const transformed: Record<string, unknown> = {
          ...block,
          type: "reasoning",
          text: thinkingText,
          thought: true,
        };

        // Convert signature to providerMetadata format for OpenCode
        const sig = block.signature || block.thoughtSignature;
        if (sig) {
          transformed.providerMetadata = {
            anthropic: { signature: sig }
          };
          delete transformed.signature;
          delete transformed.thoughtSignature;
        }

        transformedContent.push(transformed);
      } else {
        transformedContent.push(item);
      }
    }
    result.content = transformedContent;
  }

  // Handle Gemini-style candidates array
  if (Array.isArray(resp.candidates)) {
    result.candidates = resp.candidates.map(c => transformGeminiCandidate(c as Record<string, unknown>));
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
export function normalizeThinkingConfig(config: unknown): ThinkingConfig | undefined {
  if (!config || typeof config !== "object") {
    return undefined;
  }

  const record = config as Record<string, unknown>;
  const budgetRaw = record.thinkingBudget ?? record.thinking_budget;
  const includeRaw = record.includeThoughts ?? record.include_thoughts;

  const thinkingBudget = typeof budgetRaw === "number" && Number.isFinite(budgetRaw) ? budgetRaw : undefined;
  const includeThoughts = typeof includeRaw === "boolean" ? includeRaw : undefined;

  const enableThinking = thinkingBudget !== undefined && thinkingBudget > 0;
  const finalInclude = enableThinking ? includeThoughts ?? false : false;

  if (!enableThinking && finalInclude === false && thinkingBudget === undefined && includeThoughts === undefined) {
    return undefined;
  }

  const normalized: ThinkingConfig = {};
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
export function parseAlloyApiBody(rawText: string): AlloyApiBody | null {
  try {
    const parsed = JSON.parse(rawText);
    const target = Array.isArray(parsed)
      ? parsed.find((item: unknown) => typeof item === "object" && item !== null)
      : parsed;

    if (!target || typeof target !== "object") {
      return null;
    }

    const result = AlloyApiBodySchema.safeParse(target);
    if (!result.success) {
      log.warn("Forensic validation failed for Alloy API body", {
        issues: result.error.issues,
        rawText: rawText.slice(0, 500),
      });
      // Fallback: return raw object if it has either 'response' or 'error' keys
      if ('response' in target || 'error' in target) {
        return target as AlloyApiBody;
      }
      return null;
    }

    return result.data;
  } catch {
    return null;
  }
}

/**
 * Extracts usageMetadata from a response object, guarding types.
 */
export function extractUsageMetadata(body: AlloyApiBody): AlloyUsageMetadata | null {
  const usage = (body.response && typeof body.response === "object"
    ? (body.response as Record<string, unknown>).usageMetadata
    : undefined) as AlloyUsageMetadata | undefined;

  if (!usage || typeof usage !== "object") {
    return null;
  }

  const asRecord = usage as Record<string, unknown>;
  const toNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

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
export function extractUsageFromSsePayload(payload: string): AlloyUsageMetadata | null {
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
        const usage = extractUsageMetadata({ response: (parsed as Record<string, unknown>).response });
        if (usage) {
          return usage;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Enhances 404 errors for Alloy models with a direct preview-access message.
 */
export function rewriteAlloyPreviewAccessError(
  body: AlloyApiBody,
  status: number,
  requestedModel?: string,
): AlloyApiBody | null {
  if (!needsPreviewAccessOverride(status, body, requestedModel)) {
    return null;
  }

  const error: AlloyApiError = body.error ?? {};
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

function needsPreviewAccessOverride(
  status: number,
  body: AlloyApiBody,
  requestedModel?: string,
): boolean {
  if (status !== 404) {
    return false;
  }

  if (isAlloyModel(requestedModel)) {
    return true;
  }

  const errorMessage = typeof body.error?.message === "string" ? body.error.message : "";
  return isAlloyModel(errorMessage);
}

function isAlloyModel(target?: string): boolean {
  if (!target) {
    return false;
  }

  return /alloy/i.test(target) || /opus/i.test(target) || /claude/i.test(target);
}

/**
 * Checks if a JSON response body represents an empty response.
 */
export function isEmptyResponseBody(text: string): boolean {
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
      
      const firstCandidate = parsed.candidates[0] as Record<string, unknown> | undefined;
      if (!firstCandidate) {
        return true;
      }
      
      const content = firstCandidate.content as Record<string, unknown> | undefined;
      if (!content || typeof content !== "object") {
        return true;
      }
      
      const parts = content.parts;
      if (!Array.isArray(parts) || parts.length === 0) {
        return true;
      }
      
      const hasContent = parts.some((item: unknown) => {
        if (!item || typeof item !== "object") return false;
        const part = item as Record<string, unknown>;
        if (typeof part.text === "string" && part.text.length > 0) return true;
        if (part.functionCall) return true;
        if (part.thought === true && typeof part.text === "string") return true;
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
      
      const firstChoice = parsed.choices[0] as Record<string, unknown> | undefined;
      if (!firstChoice) {
        return true;
      }
      
      const message = (firstChoice.message || firstChoice.delta) as Record<string, unknown> | undefined;
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
  } catch {
    return true;
  }
}

const visitedInEmptyCheck = new WeakSet<object>();

/**
 * Checks if an SSE line contains meaningful content.
 */
export function isMeaningfulSseLine(line: string): boolean {
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
            const part = item as Record<string, unknown>;
            if (typeof part?.text === "string" && part.text.length > 0) return true;
            if (part?.functionCall) return true;
          }
        }
      }
    }
    
    if (parsed.response?.candidates) {
      return isMeaningfulSseLine(`data: ${JSON.stringify(parsed.response)}`);
    }
    
    return false;
  } catch {
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

export function recursivelyParseJsonStrings(
  obj: unknown,
  skipParseKeys: Set<string> = SKIP_PARSE_KEYS,
  currentKey?: string,
): unknown {
  const seen = new WeakMap<object, unknown>();
  return recursivelyParseJsonStringsInternal(obj, skipParseKeys, currentKey, seen, 0);
}

function recursivelyParseJsonStringsInternal(
  obj: unknown,
  skipParseKeys: Set<string>,
  currentKey: string | undefined,
  seen: WeakMap<object, unknown>,
  depth: number,
): unknown {
  if (depth > MAX_RECURSIVE_DEPTH) {
    return obj;
  }
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    const cached = seen.get(obj);
    if (cached) return cached;

    const result: unknown[] = [];
    seen.set(obj, result);
    for (const item of obj) {
      result.push(recursivelyParseJsonStringsInternal(item, skipParseKeys, undefined, seen, depth + 1));
    }
    return result;
  }

  if (typeof obj === "object") {
    const objectRef = obj as Record<string, unknown>;
    const cached = seen.get(objectRef);
    if (cached) return cached;

    const result: Record<string, unknown> = {};
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
    } catch { /* Continue */ }
  }

  // Try parsing JSON strings
  if (stripped && (stripped[0] === "{" || stripped[0] === "[")) {
    try {
      let cleaned = stripped;
      if (stripped.startsWith("[") && !stripped.endsWith("]")) {
        const lastBracket = stripped.lastIndexOf("]");
        if (lastBracket > 0) cleaned = stripped.slice(0, lastBracket + 1);
      } else if (stripped.startsWith("{") && !stripped.endsWith("}")) {
        const lastBrace = stripped.lastIndexOf("}");
        if (lastBrace > 0) cleaned = stripped.slice(0, lastBrace + 1);
      }

      const parsed = JSON.parse(cleaned);
      if (parsed !== obj) {
        return recursivelyParseJsonStringsInternal(parsed, skipParseKeys, undefined, seen, depth + 1);
      }
    } catch { /* Continue */ }
  }

  return obj;
}

/**
 * Groups function calls with their responses, handling ID mismatches.
 */
export function fixToolResponseGrouping(contents: MessageContent[]): MessageContent[] {
  if (!Array.isArray(contents) || contents.length === 0) {
    return contents;
  }

  const newContents: MessageContent[] = [];
  const pendingGroups: Array<{
    ids: string[];
    funcNames: string[];
    insertAfterIdx: number;
  }> = [];
  
  const collectedResponses = new Map<string, MessagePart>();
  
  for (const content of contents) {
    const role = content.role;
    const parts = content.parts || [];
    
    const responseParts = parts.filter((p: MessagePart) => p?.functionResponse);
    
    if (responseParts.length > 0) {
      for (const resp of responseParts) {
        const respId = resp.functionResponse?.id || "";
        if (respId && !collectedResponses.has(respId)) {
          collectedResponses.set(respId, resp);
        }
      }
      
      for (let i = pendingGroups.length - 1; i >= 0; i--) {
        const group = pendingGroups[i]!;
        if (group.ids.every(id => collectedResponses.has(id))) {
          const groupResponses = group.ids.map(id => {
            const resp = collectedResponses.get(id)!;
            collectedResponses.delete(id);
            return resp;
          });
          newContents.push({ parts: groupResponses as any, role: "user" });
          pendingGroups.splice(i, 1);
          break;
        }
      }
      continue;
    }
    
    if (role === "model") {
      const funcCalls = parts.filter((p: MessagePart) => p?.functionCall);
      newContents.push(content);
      
      if (funcCalls.length > 0) {
        const callIds = funcCalls
          .map((fc: MessagePart) => fc.functionCall?.id || "")
          .filter(Boolean);
        const funcNames = funcCalls
          .map((fc: MessagePart) => fc.functionCall?.name || "");
        
        if (callIds.length > 0) {
          pendingGroups.push({
            ids: callIds,
            funcNames,
            insertAfterIdx: newContents.length - 1,
          });
        }
      }
    } else {
      newContents.push(content);
    }
  }
  
  pendingGroups.sort((a, b) => b.insertAfterIdx - a.insertAfterIdx);
  
  for (const group of pendingGroups) {
    const groupResponses: MessagePart[] = [];
    
    for (let i = 0; i < group.ids.length; i++) {
      const expectedId = group.ids[i]!;
      const expectedName = group.funcNames[i] || "";
      
      let matchedPart: MessagePart | null = null;

      if (collectedResponses.has(expectedId)) {
        matchedPart = collectedResponses.get(expectedId)!;
        collectedResponses.delete(expectedId);
      } else if (collectedResponses.size > 0) {
        let matchedId: string | null = null;
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
        if (!matchedId) matchedId = collectedResponses.keys().next().value ?? null;
        
        if (matchedId) {
          matchedPart = collectedResponses.get(matchedId)!;
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
      } else {
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
        parts: groupResponses as any,
        role: "user",
      });
    }
  }
  
  return newContents;
}

export {
  detectToolIdMismatches,
  injectParameterSignatures,
  assignToolIdsToContents,
  matchResponseIdsToContents,
  applyToolPairingFixes,
  injectToolHardeningInstruction,
  createSyntheticErrorResponse,
  validateAndFixClaudeToolPairing
} from "./transform/tool-hardening";
