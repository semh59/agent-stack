import { z } from "zod";
import { getKeepThinking } from "./config";
import { createLogger } from "./logger";
import {
  SKIP_THOUGHT_SIGNATURE,
} from "../constants";
import { processImageData } from "./image-saver";
import type { GoogleSearchConfig } from "./transform/types";

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
function stripAllThinkingBlocks(contentArray: any[]): any[] {
  return contentArray.filter(item => {
    if (!item || typeof item !== "object") return true;
    if (isToolBlock(item)) return true;
    if (isThinkingPart(item)) return false;
    if (hasSignatureField(item)) return false;
    return true;
  });
}

/**
 * Removes trailing thinking blocks from a content array.
 * Claude API requires that assistant messages don't end with thinking blocks.
 * Only removes unsigned thinking blocks; preserves those with valid signatures.
 */
function removeTrailingThinkingBlocks(
  contentArray: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
): any[] {
  const result = [...contentArray];

  while (result.length > 0 && isThinkingPart(result[result.length - 1])) {
    const part = result[result.length - 1];
    const isValid = sessionId && getCachedSignatureFn
      ? isOurCachedSignature(part as Record<string, unknown>, sessionId, getCachedSignatureFn)
      : hasValidSignature(part as Record<string, unknown>);
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
    const maybeText = (part.text as any).text;
    if (typeof maybeText === "string") return maybeText;
  }

  if (part.thinking && typeof part.thinking === "object") {
    const maybeText = (part.thinking as any).text ?? (part.thinking as any).thinking;
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
      const maybeText = (textContent as any).text;
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
      const maybeText = (thinkingContent as any).text ?? (thinkingContent as any).thinking;
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
      const maybeText = (textContent as any).text;
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

function findLastAssistantIndex(contents: any[], roleValue: "model" | "assistant"): number {
  for (let i = contents.length - 1; i >= 0; i--) {
    const content = contents[i];
    if (content && typeof content === "object" && content.role === roleValue) {
      return i;
    }
  }
  return -1;
}

function filterContentArray(
  contentArray: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
  isLastAssistantMessage: boolean = false,
): any[] {
  // For Claude models, strip thinking blocks by default for reliability
  // User can opt-in to keep thinking via config: { "keep_thinking": true }
  if (isClaudeModel && !getKeepThinking()) {
    return stripAllThinkingBlocks(contentArray);
  }

  const filtered: any[] = [];

  for (const item of contentArray) {
    if (!item || typeof item !== "object") {
      filtered.push(item);
      continue;
    }

    if (isToolBlock(item)) {
      filtered.push(item);
      continue;
    }

    const isThinking = isThinkingPart(item);
    const hasSignature = hasSignatureField(item);

    if (!isThinking && !hasSignature) {
      filtered.push(item);
      continue;
    }

    // For the LAST assistant message with thinking blocks:
    // - If signature is OUR cached signature, pass through unchanged
    // - Otherwise inject sentinel to bypass Alloy validation
    // NOTE: We can't trust signatures just because they're >= 50 chars - Claude returns
    // its own signatures which are long but invalid for Alloy.
    if (isLastAssistantMessage && (isThinking || hasSignature)) {
      // First check if it's our cached signature
      if (isOurCachedSignature(item, sessionId, getCachedSignatureFn)) {
        const sanitized = sanitizeThinkingPart(item);
        if (sanitized) filtered.push(sanitized);
        continue;
      }
      
      // Not our signature (or no signature) - inject sentinel
      const thinkingText = getThinkingText(item) || "";
      const existingSignature = item.signature || item.thoughtSignature;
      const signatureInfo = existingSignature ? `foreign signature (${String(existingSignature).length} chars)` : "no signature";
      log.debug(`Injecting sentinel for last-message thinking block with ${signatureInfo}`);
      const sentinelPart = {
        type: item.type || "thinking",
        thinking: thinkingText,
        signature: SKIP_THOUGHT_SIGNATURE,
      };
      filtered.push(sentinelPart);
      continue;
    }

    if (isOurCachedSignature(item, sessionId, getCachedSignatureFn)) {
      const sanitized = sanitizeThinkingPart(item);
      if (sanitized) filtered.push(sanitized);
      continue;
    }

    if (sessionId && getCachedSignatureFn) {
      const text = getThinkingText(item);
      if (text) {
        const cachedSignature = getCachedSignatureFn(sessionId, text);
        if (cachedSignature && cachedSignature.length >= 50) {
          const restoredPart = { ...item };
          if ((item as any).thought === true) {
            (restoredPart as any).thoughtSignature = cachedSignature;
          } else {
            (restoredPart as any).signature = cachedSignature;
          }
          const sanitized = sanitizeThinkingPart(restoredPart as Record<string, unknown>);
          if (sanitized) filtered.push(sanitized);
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
  contents: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): any[] {
  const lastAssistantIdx = findLastAssistantIndex(contents, "model");

  return contents.map((content: any, idx: number) => {
    if (!content || typeof content !== "object") {
      return content;
    }

    const isLastAssistant = idx === lastAssistantIdx;

    if (Array.isArray((content as any).parts)) {
      const filteredParts = filterContentArray(
        (content as any).parts,
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
        isLastAssistant,
      );

      const trimmedParts = (content as any).role === "model" && !isClaudeModel
        ? removeTrailingThinkingBlocks(filteredParts, sessionId, getCachedSignatureFn)
        : filteredParts;

      return { ...content, parts: trimmedParts };
    }

    if (Array.isArray((content as any).content)) {
      const isAssistantRole = (content as any).role === "assistant";
      const isLastAssistantContent = idx === lastAssistantIdx || 
        (isAssistantRole && idx === findLastAssistantIndex(contents, "assistant"));
      
      const filteredContent = filterContentArray(
        (content as any).content,
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
  messages: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): any[] {
  const lastAssistantIdx = findLastAssistantIndex(messages, "assistant");

  return messages.map((message: any, idx: number) => {
    if (!message || typeof message !== "object") {
      return message;
    }

    if (Array.isArray((message as any).content)) {
      const isAssistantRole = (message as any).role === "assistant";
      const isLastAssistant = isAssistantRole && idx === lastAssistantIdx;
      
      const filteredContent = filterContentArray(
        (message as any).content,
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
        obj.contents as any[],
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
      );
    }

    if (Array.isArray(obj.messages)) {
      obj.messages = filterMessagesThinkingBlocks(
        obj.messages as any[],
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
export function detectShadowThinkingBlocks(payload: any): any {
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
            (value as any)[idx] = "[REDACTED: SHADOW BLOCK]";
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
function transformGeminiCandidate(candidate: any): any {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }

  const content = candidate.content;
  if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
    return candidate;
  }

  const thinkingTexts: string[] = [];
  const transformedParts = content.parts.map((part: any) => {
    if (!part || typeof part !== "object") {
      return part;
    }

    // Handle Gemini-style: thought: true
    if (part.thought === true) {
      const thinkingText = part.text || "";
      thinkingTexts.push(thinkingText);
      const transformed: Record<string, unknown> = { ...part, type: "reasoning" };
      if (part.cache_control) transformed.cache_control = part.cache_control;

      // Convert signature to providerMetadata format for OpenCode
      const sig = part.signature || part.thoughtSignature;
      if (sig) {
        transformed.providerMetadata = {
          anthropic: { signature: sig }
        };
        delete (transformed as any).signature;
        delete (transformed as any).thoughtSignature;
      }

      return transformed;
    }

    // Handle Anthropic-style in candidates: type: "thinking"
    if (part.type === "thinking") {
      const thinkingText = part.thinking || part.text || "";
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
        delete (transformed as any).signature;
        delete (transformed as any).thoughtSignature;
      }

      return transformed;
    }

    // Handle functionCall: parse JSON strings in args and ensure args is always defined
    // (Ported from LLM-API-Key-Proxy's _extract_tool_call)
    // Fix: When Claude calls a tool with no parameters, args may be undefined.
    // opencode expects state.input to be a record, so we must ensure args: {} as fallback.
    if (part.functionCall) {
      const parsedArgs = part.functionCall.args
        ? recursivelyParseJsonStrings(part.functionCall.args)
        : {};
      return {
        ...part,
        functionCall: {
          ...part.functionCall,
          args: parsedArgs,
        },
      };
    }

    // Handle image data (inlineData) - save to disk and return file path
    if (part.inlineData) {
      const result = processImageData({
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
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
    const transformedContent: any[] = [];
    for (const block of resp.content) {
      if (block && typeof block === "object" && (block as any).type === "thinking") {
        const thinkingText = (block as any).thinking || (block as any).text || "";
        reasoningTexts.push(thinkingText);
        const transformed: Record<string, unknown> = {
          ...block,
          type: "reasoning",
          text: thinkingText,
          thought: true,
        };

        // Convert signature to providerMetadata format for OpenCode
        const sig = (block as any).signature || (block as any).thoughtSignature;
        if (sig) {
          transformed.providerMetadata = {
            anthropic: { signature: sig }
          };
          delete (transformed as any).signature;
          delete (transformed as any).thoughtSignature;
        }

        transformedContent.push(transformed);
      } else {
        transformedContent.push(block);
      }
    }
    result.content = transformedContent;
  }

  // Handle Gemini-style candidates array
  if (Array.isArray(resp.candidates)) {
    result.candidates = resp.candidates.map(transformGeminiCandidate);
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
      // to avoid breaking legacy paths that might be looser than our schema.
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
    ? (body.response as { usageMetadata?: unknown }).usageMetadata
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

  // Check for Alloy models instead of Gemini 3
  return /alloy/i.test(target) || /opus/i.test(target) || /claude/i.test(target);
}

// ============================================================================
// EMPTY RESPONSE DETECTION (Ported from LLM-API-Key-Proxy)
// ============================================================================

/**
 * Checks if a JSON response body represents an empty response.
 * 
 * Empty responses occur when:
 * - No candidates in Gemini format
 * - No choices in OpenAI format
 * - Candidates/choices exist but have no content
 * 
 * @param text - The response body text (should be valid JSON)
 * @returns true if the response is empty
 */
export function isEmptyResponseBody(text: string): boolean {
  if (!text || !text.trim()) {
    return true;
  }

  try {
    const parsed = JSON.parse(text);
    
    // Check for empty candidates (Gemini/Alloy format)
    if (parsed.candidates !== undefined) {
      if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
        return true;
      }
      
      // Check if first candidate has empty content
      const firstCandidate = parsed.candidates[0];
      if (!firstCandidate) {
        return true;
      }
      
      // Check for empty parts in content
      const content = firstCandidate.content;
      if (!content || typeof content !== "object") {
        return true;
      }
      
      const parts = content.parts;
      if (!Array.isArray(parts) || parts.length === 0) {
        return true;
      }
      
      // Check if all parts are empty (no text, no functionCall)
      const hasContent = parts.some((part: any) => {
        if (!part || typeof part !== "object") return false;
        if (typeof part.text === "string" && part.text.length > 0) return true;
        if (part.functionCall) return true;
        if (part.thought === true && typeof part.text === "string") return true;
        return false;
      });
      
      if (!hasContent) {
        return true;
      }
    }
    
    // Check for empty choices (OpenAI format - shouldn't occur but handle it)
    if (parsed.choices !== undefined) {
      if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
        return true;
      }
      
      const firstChoice = parsed.choices[0];
      if (!firstChoice) {
        return true;
      }
      
      // Check for empty message/delta
      const message = firstChoice.message || firstChoice.delta;
      if (!message) {
        return true;
      }
      
      // Check if message has content or tool_calls
      if (!message.content && !message.tool_calls && !message.reasoning_content) {
        return true;
      }
    }
    
    // Check response wrapper (Alloy envelope)
    if (parsed.response !== undefined) {
      const response = parsed.response;
      if (!response || typeof response !== "object") {
        return true;
      }
      return isEmptyResponseBody(JSON.stringify(response));
    }
    
    return false;
  } catch {
    // JSON parse error - treat as empty
    return true;
  }
}

/**
 * Checks if a streaming SSE response yielded zero meaningful chunks.
 * 
 * This is used after consuming a streaming response to determine if retry is needed.
 */
export interface StreamingChunkCounter {
  increment: () => void;
  getCount: () => number;
  hasContent: () => boolean;
}

export function createStreamingChunkCounter(): StreamingChunkCounter {
  let count = 0;
  const hasRealContent = false;

  return {
    increment: () => {
      count++;
    },
    getCount: () => count,
    hasContent: () => hasRealContent || count > 0,
  };
}

/**
 * Checks if an SSE line contains meaningful content.
 * 
 * @param line - A single SSE line (e.g., "data: {...}")
 * @returns true if the line contains content worth counting
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
    
    // Check for candidates with content
    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      for (const candidate of parsed.candidates) {
        const parts = candidate?.content?.parts;
        if (Array.isArray(parts) && parts.length > 0) {
          for (const part of parts) {
            if (typeof part?.text === "string" && part.text.length > 0) return true;
            if (part?.functionCall) return true;
          }
        }
      }
    }
    
    // Check response wrapper
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

/**
 * Recursively parses JSON strings in nested data structures.
 * 
 * This is a port of LLM-API-Key-Proxy's _recursively_parse_json_strings() function.
 * 
 * Handles:
 * - JSON-stringified values: {"files": "[{...}]"} â†’ {"files": [{...}]}
 * - Malformed double-encoded JSON (extra trailing chars)
 * - Escaped control characters (\\n â†’ \n, \\t â†’ \t)
 * 
 * This is useful because Alloy sometimes returns JSON-stringified values
 * in tool arguments, which can cause downstream parsing issues.
 * 
 * @param obj - The object to recursively parse
 * @param skipParseKeys - Set of keys whose values should NOT be parsed as JSON (preserved as strings)
 * @param currentKey - The current key being processed (internal use)
 * @returns The parsed object with JSON strings expanded
 */
// Keys whose string values should NOT be parsed as JSON - they contain literal text content
const SKIP_PARSE_KEYS = new Set([
  "oldString",
  "newString",
  "content",
  "filePath",
  "path",
  "text",
  "code",
  "source",
  "data",
  "body",
  "message",
  "prompt",
  "input",
  "output",
  "result",
  "value",
  "query",
  "pattern",
  "replacement",
  "template",
  "script",
  "command",
  "snippet",
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
    if (cached) {
      return cached;
    }

    const result: unknown[] = [];
    seen.set(obj, result);
    for (const item of obj) {
      result.push(
        recursivelyParseJsonStringsInternal(item, skipParseKeys, undefined, seen, depth + 1),
      );
    }
    return result;
  }

  if (typeof obj === "object") {
    const objectRef = obj as Record<string, unknown>;
    const cached = seen.get(objectRef);
    if (cached) {
      return cached;
    }

    const result: Record<string, unknown> = {};
    seen.set(objectRef, result);
    for (const [key, value] of Object.entries(objectRef)) {
      result[key] = recursivelyParseJsonStringsInternal(
        value,
        skipParseKeys,
        key,
        seen,
        depth + 1,
      );
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

  // Check if string contains control character escape sequences
  // that need unescaping (\\n, \\t but NOT \\" or \\\\)
  const hasControlCharEscapes = obj.includes("\\n") || obj.includes("\\t");
  const hasIntentionalEscapes = obj.includes('\\"') || obj.includes("\\\\");

  if (hasControlCharEscapes && !hasIntentionalEscapes) {
    try {
      // Use JSON.parse with quotes to unescape the string
      return JSON.parse(`"${obj}"`);
    } catch {
      // Continue with original processing
    }
  }

  // Check if it looks like JSON (starts with { or [)
  if (stripped && (stripped[0] === "{" || stripped[0] === "[")) {
    // Try standard parsing first
    if (
      (stripped.startsWith("{") && stripped.endsWith("}")) ||
      (stripped.startsWith("[") && stripped.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(obj);
        if (parsed === obj) {
          return obj;
        }
        return recursivelyParseJsonStringsInternal(
          parsed,
          skipParseKeys,
          undefined,
          seen,
          depth + 1,
        );
      } catch {
        // Continue
      }
    }

    // Handle malformed JSON: array that doesn't end with ]
    if (stripped.startsWith("[") && !stripped.endsWith("]")) {
      try {
        const lastBracket = stripped.lastIndexOf("]");
        if (lastBracket > 0) {
          const cleaned = stripped.slice(0, lastBracket + 1);
          const parsed = JSON.parse(cleaned);
          log.debug("Auto-corrected malformed JSON array", {
            truncatedChars: stripped.length - cleaned.length,
          });
          if (parsed === obj) {
            return obj;
          }
          return recursivelyParseJsonStringsInternal(
            parsed,
            skipParseKeys,
            undefined,
            seen,
            depth + 1,
          );
        }
      } catch {
        // Continue
      }
    }

    // Handle malformed JSON: object that doesn't end with }
    if (stripped.startsWith("{") && !stripped.endsWith("}")) {
      try {
        const lastBrace = stripped.lastIndexOf("}");
        if (lastBrace > 0) {
          const cleaned = stripped.slice(0, lastBrace + 1);
          const parsed = JSON.parse(cleaned);
          log.debug("Auto-corrected malformed JSON object", {
            truncatedChars: stripped.length - cleaned.length,
          });
          if (parsed === obj) {
            return obj;
          }
          return recursivelyParseJsonStringsInternal(
            parsed,
            skipParseKeys,
            undefined,
            seen,
            depth + 1,
          );
        }
      } catch {
        // Continue
      }
    }
  }

  return obj;
}

// ============================================================================
// TOOL ID ORPHAN RECOVERY (Ported from LLM-API-Key-Proxy)
// ============================================================================

/**
 * Groups function calls with their responses, handling ID mismatches.
 * 
 * This is a port of LLM-API-Key-Proxy's _fix_tool_response_grouping() function.
 * 
 * When context compaction or other processes strip tool responses, the tool call
 * IDs become orphaned. This function attempts to recover by:
 * 
 * 1. Pass 1: Match by exact ID (normal case)
 * 2. Pass 2: Match by function name (for ID mismatches)
 * 3. Pass 3: Match "unknown_function" orphans or take first available
 * 4. Fallback: Create placeholder responses for missing tool results
 * 
 * @param contents - Array of Gemini-style content messages
 * @returns Fixed contents array with matched tool responses
 */
export function fixToolResponseGrouping(contents: any[]): any[] {
  if (!Array.isArray(contents) || contents.length === 0) {
    return contents;
  }

  const newContents: any[] = [];
  
  // Track pending tool call groups that need responses
  const pendingGroups: Array<{
    ids: string[];
    funcNames: string[];
    insertAfterIdx: number;
  }> = [];
  
  // Collected orphan responses (by ID)
  const collectedResponses = new Map<string, any>();
  
  for (const content of contents) {
    const role = content.role;
    const parts = content.parts || [];
    
    // Check if this is a tool response message
    const responseParts = parts.filter((p: any) => p?.functionResponse);
    
    if (responseParts.length > 0) {
      // Collect responses by ID (skip duplicates)
      for (const resp of responseParts) {
        const respId = resp.functionResponse?.id || "";
        if (respId && !collectedResponses.has(respId)) {
          collectedResponses.set(respId, resp);
        }
      }
      
      // Try to satisfy the most recent pending group
      for (let i = pendingGroups.length - 1; i >= 0; i--) {
        const group = pendingGroups[i]!;
        if (group.ids.every(id => collectedResponses.has(id))) {
          // All IDs found - build the response group
          const groupResponses = group.ids.map(id => {
            const resp = collectedResponses.get(id);
            collectedResponses.delete(id);
            return resp;
          });
          newContents.push({ parts: groupResponses, role: "user" });
          pendingGroups.splice(i, 1);
          break; // Only satisfy one group at a time
        }
      }
      continue; // Don't add the original response message
    }
    
    if (role === "model") {
      // Check for function calls in this model message
      const funcCalls = parts.filter((p: any) => p?.functionCall);
      newContents.push(content);
      
      if (funcCalls.length > 0) {
        const callIds = funcCalls
          .map((fc: any) => fc.functionCall?.id || "")
          .filter(Boolean);
        const funcNames = funcCalls
          .map((fc: any) => fc.functionCall?.name || "");
        
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
  
  // Handle remaining pending groups with orphan recovery
  // Process in reverse order so insertions don't shift indices
  pendingGroups.sort((a, b) => b.insertAfterIdx - a.insertAfterIdx);
  
  for (const group of pendingGroups) {
    const groupResponses: any[] = [];
    
    for (let i = 0; i < group.ids.length; i++) {
      const expectedId = group.ids[i]!;
      const expectedName = group.funcNames[i] || "";
      
      if (collectedResponses.has(expectedId)) {
        // Direct ID match - ideal case
        groupResponses.push(collectedResponses.get(expectedId));
        collectedResponses.delete(expectedId);
      } else if (collectedResponses.size > 0) {
        // Need to find an orphan response
        let matchedId: string | null = null;
        
        // Pass 1: Match by function name
        for (const [orphanId, orphanResp] of collectedResponses) {
          const orphanName = orphanResp.functionResponse?.name || "";
          if (orphanName === expectedName) {
            matchedId = orphanId;
            break;
          }
        }
        
        // Pass 2: Match "unknown_function" orphans
        if (!matchedId) {
          for (const [orphanId, orphanResp] of collectedResponses) {
            if (orphanResp.functionResponse?.name === "unknown_function") {
              matchedId = orphanId;
              break;
            }
          }
        }
        
        // Pass 3: Take first available
        if (!matchedId) {
          matchedId = collectedResponses.keys().next().value ?? null;
        }
        
        if (matchedId) {
          const orphanResp = collectedResponses.get(matchedId)!;
          collectedResponses.delete(matchedId);
          
          // Fix the ID and name to match expected
          orphanResp.functionResponse.id = expectedId;
          if (orphanResp.functionResponse.name === "unknown_function" && expectedName) {
            orphanResp.functionResponse.name = expectedName;
          }
          
          log.debug("Auto-repaired tool ID mismatch", {
            mappedFrom: matchedId,
            mappedTo: expectedId,
            functionName: expectedName,
          });
          
          groupResponses.push(orphanResp);
        }
      } else {
        // No responses available - create placeholder
        const placeholder = {
          functionResponse: {
            name: expectedName || "unknown_function",
            response: {
              result: {
                error: "Tool response was lost during context processing. " +
                       "This is a recovered placeholder.",
                recovered: true,
              },
            },
            id: expectedId,
          },
        };
        
        log.debug("Created placeholder response for missing tool", {
          id: expectedId,
          name: expectedName,
        });
        
        groupResponses.push(placeholder);
      }
    }
    
    if (groupResponses.length > 0) {
      // Insert at correct position (after the model message that made the calls)
      newContents.splice(group.insertAfterIdx + 1, 0, {
        parts: groupResponses,
        role: "user",
      });
    }
  }
  
  return newContents;
}

/**
 * Checks if contents have any tool call/response ID mismatches.
 * 
 * @param contents - Array of Gemini-style content messages
 * @returns Object with mismatch details
 */
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
