import crypto from "node:crypto";
import { SKIP_THOUGHT_SIGNATURE } from "../../constants";
import { getCachedSignature } from "../cache";
import { defaultSignatureStore } from "../stores/signature-store";
import { DEBUG_MESSAGE_PREFIX } from "../debug";
import { createLogger } from "../logger";

const log = createLogger("request-thinking-utils");

export const PLUGIN_SESSION_ID = `-${crypto.randomUUID()}`;

export const sessionDisplayedThinkingHashes = new Set<string>();

export const MIN_SIGNATURE_LENGTH = 50;

export function buildSignatureSessionKey(
  sessionId: string,
  model?: string,
  conversationKey?: string,
  projectKey?: string,
): string {
  const modelKey = typeof model === "string" && model.trim() ? model.toLowerCase() : "unknown";
  const projectPart = typeof projectKey === "string" && projectKey.trim()
    ? projectKey.trim()
    : "default";
  const conversationPart = typeof conversationKey === "string" && conversationKey.trim()
    ? conversationKey.trim()
    : "default";
  return `${sessionId}:${modelKey}:${projectPart}:${conversationPart}`;
}

export function shouldCacheThinkingSignatures(model?: string): boolean {
  if (typeof model !== "string") return false;
  const lower = model.toLowerCase();
  // Both Claude and Gemini 3 models require thought signature caching
  // for multi-turn conversations with function calling
  return lower.includes("claude") || lower.includes("gemini-3");
}

export function hashConversationSeed(seed: string): string {
  return crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16);
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (record.text && typeof record.text === "object" && typeof (record.text as Record<string, unknown>).text === "string") {
      return (record.text as Record<string, unknown>).text as string;
    }
  }
  return "";
}

export function extractConversationSeedFromMessages(messages: unknown[]): string {
  const asRecords = messages.filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m));
  const system = asRecords.find((message) => message.role === "system");
  const users = asRecords.filter((message) => message.role === "user");
  const firstUser = users[0];
  const lastUser = users.length > 0 ? users[users.length - 1] : undefined;
  const systemText = system ? extractTextFromContent(system.content) : "";
  const userText = firstUser ? extractTextFromContent(firstUser.content) : "";
  const fallbackUserText = !userText && lastUser ? extractTextFromContent(lastUser.content) : "";
  return [systemText, userText || fallbackUserText].filter(Boolean).join("|");
}

export function extractConversationSeedFromContents(contents: unknown[]): string {
  const asRecords = contents.filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c));
  const users = asRecords.filter((content) => content.role === "user");
  const firstUser = users[0];
  const lastUser = users.length > 0 ? users[users.length - 1] : undefined;
  const primaryUser = firstUser && Array.isArray(firstUser.parts) ? extractTextFromContent(firstUser.parts) : "";
  if (primaryUser) {
    return primaryUser;
  }
  if (lastUser && Array.isArray(lastUser.parts)) {
    return extractTextFromContent(lastUser.parts);
  }
  return "";
}

export function resolveConversationKey(requestPayload: Record<string, unknown>): string | undefined {
  const candidates = [
    requestPayload.conversationId,
    requestPayload.conversation_id,
    requestPayload.thread_id,
    requestPayload.threadId,
    requestPayload.chat_id,
    requestPayload.chatId,
    requestPayload.sessionId,
    requestPayload.session_id,
    requestPayload.metadata && typeof requestPayload.metadata === "object"
      ? (requestPayload.metadata as Record<string, unknown>).conversation_id
      : undefined,
    requestPayload.metadata && typeof requestPayload.metadata === "object"
      ? (requestPayload.metadata as Record<string, unknown>).conversationId
      : undefined,
    requestPayload.metadata && typeof requestPayload.metadata === "object"
      ? (requestPayload.metadata as Record<string, unknown>).thread_id
      : undefined,
    requestPayload.metadata && typeof requestPayload.metadata === "object"
      ? (requestPayload.metadata as Record<string, unknown>).threadId
      : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const systemInstruction = requestPayload.systemInstruction;
  const systemInstructionParts = systemInstruction && typeof systemInstruction === "object"
    ? (systemInstruction as Record<string, unknown>).parts
    : undefined;

  const systemSeed = extractTextFromContent(
    systemInstructionParts
    ?? requestPayload.systemInstruction
    ?? requestPayload.system
    ?? requestPayload.system_instruction,
  );
  const messageSeed = Array.isArray(requestPayload.messages)
    ? extractConversationSeedFromMessages(requestPayload.messages)
    : Array.isArray(requestPayload.contents)
      ? extractConversationSeedFromContents(requestPayload.contents)
      : "";
  const seed = [systemSeed, messageSeed].filter(Boolean).join("|");
  if (!seed) {
    return undefined;
  }
  return `seed-${hashConversationSeed(seed)}`;
}

export function resolveConversationKeyFromRequests(requestObjects: Array<Record<string, unknown>>): string | undefined {
  for (const req of requestObjects) {
    const key = resolveConversationKey(req);
    if (key) {
      return key;
    }
  }
  return undefined;
}

export function resolveProjectKey(candidate?: unknown, fallback?: string): string | undefined {
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return undefined;
}

export function formatDebugLinesForThinking(lines: string[]): string {
  const cleaned = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-50);
  return `${DEBUG_MESSAGE_PREFIX}\n${cleaned.map((line) => `- ${line}`).join("\n")}`;
}

export function injectDebugThinking(response: unknown, debugText: string): unknown {
  if (!response || typeof response !== "object") {
    return response;
  }

  const resp = response as Record<string, unknown>;

  if (Array.isArray(resp.candidates) && resp.candidates.length > 0) {
    const candidates = resp.candidates.slice() as Record<string, unknown>[];
    const first = candidates[0];

    if (
      first &&
      typeof first === "object" &&
      first.content &&
      typeof first.content === "object" &&
      Array.isArray((first.content as Record<string, unknown>).parts)
    ) {
      const firstContent = first.content as Record<string, unknown>;
      const parts = [{ thought: true, text: debugText }, ...(firstContent.parts as unknown[])];
      candidates[0] = { ...first, content: { ...firstContent, parts } };
      return { ...resp, candidates };
    }

    return resp;
  }

  if (Array.isArray(resp.content)) {
    const content = [{ type: "thinking", thinking: debugText }, ...resp.content];
    return { ...resp, content };
  }

  if (!resp.reasoning_content) {
    return { ...resp, reasoning_content: debugText };
  }

  return resp;
}

/**
 * Synthetic thinking placeholder text used when keep_thinking=true but debug mode is off.
 * Injected via the same path as debug text (injectDebugThinking) to ensure consistent
 * signature caching and multi-turn handling.
 */
export const SYNTHETIC_THINKING_PLACEHOLDER = "[Thinking preserved]\n";

export function stripInjectedDebugFromParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) {
    return parts;
  }

  return parts.filter((part) => {
    if (!part || typeof part !== "object") {
      return true;
    }

    const record = part as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.thinking === "string"
          ? record.thinking
          : undefined;

    // Strip debug blocks and synthetic thinking placeholders
    if (text && (text.startsWith(DEBUG_MESSAGE_PREFIX) || text.startsWith(SYNTHETIC_THINKING_PLACEHOLDER.trim()))) {
      return false;
    }

    return true;
  });
}

export function stripInjectedDebugFromRequestPayload(payload: Record<string, unknown>): void {
  if (Array.isArray(payload.contents)) {
    payload.contents = payload.contents.map((content: unknown) => {
      if (!content || typeof content !== "object") {
        return content;
      }

      const contentObj = content as Record<string, unknown>;

      if (Array.isArray(contentObj.parts)) {
        return { ...contentObj, parts: stripInjectedDebugFromParts(contentObj.parts) };
      }

      if (Array.isArray(contentObj.content)) {
        return { ...contentObj, content: stripInjectedDebugFromParts(contentObj.content) };
      }

      return content;
    });
  }

  if (Array.isArray(payload.messages)) {
    payload.messages = payload.messages.map((message: unknown) => {
      if (!message || typeof message !== "object") {
        return message;
      }

      const messageObj = message as Record<string, unknown>;

      if (Array.isArray(messageObj.content)) {
        return { ...messageObj, content: stripInjectedDebugFromParts(messageObj.content) };
      }

      return message;
    });
  }
}

export function isGeminiToolUsePart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const record = part as Record<string, unknown>;
  return !!(record.functionCall || record.tool_use || record.toolUse);
}

export function isGeminiThinkingPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const record = part as Record<string, unknown>;
  return !!(
    record.thought === true || record.type === "thinking" || record.type === "reasoning"
  );
}

// Sentinel value used when signature recovery fails - allows Claude to handle gracefully
// by redacting the thinking block instead of rejecting the request entirely.
// Reference: LLM-API-Key-Proxy uses this pattern for Gemini 3 tool calls.
export const SENTINEL_SIGNATURE = "skip_thought_signature_validator";

export function ensureThoughtSignature(part: unknown, sessionId: string): unknown {
  if (!part || typeof part !== "object") {
    return part;
  }

  const record = part as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : typeof record.thinking === "string" ? record.thinking : "";
  if (!text) {
    return part;
  }

  if (record.thought === true) {
    if (!record.thoughtSignature) {
      const cached = getCachedSignature(sessionId, text);
      if (cached) {
        return { ...record, thoughtSignature: cached };
      }
      // Fallback: use sentinel signature to prevent API rejection
      // This allows Claude to redact the thinking block instead of failing
      return { ...record, thoughtSignature: SENTINEL_SIGNATURE };
    }
    return part;
  }

  if ((record.type === "thinking" || record.type === "reasoning") && !record.signature) {
    const cached = getCachedSignature(sessionId, text);
    if (cached) {
      return { ...record, signature: cached };
    }
    // Fallback: use sentinel signature to prevent API rejection
    return { ...record, signature: SENTINEL_SIGNATURE };
  }

  return part;
}

export function hasSignedThinkingPart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false;
  }

  const record = part as Record<string, unknown>;

  if (record.thought === true) {
    return typeof record.thoughtSignature === "string" && record.thoughtSignature.length >= MIN_SIGNATURE_LENGTH;
  }

  if (record.type === "thinking" || record.type === "reasoning") {
    return typeof record.signature === "string" && record.signature.length >= MIN_SIGNATURE_LENGTH;
  }

  return false;
}

export function ensureThinkingBeforeToolUseInContents(contents: unknown[], signatureSessionKey: string): unknown[] {
  return contents.map((content: unknown) => {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      return content;
    }
    const contentObj = content as Record<string, unknown>;
    if (!Array.isArray(contentObj.parts)) {
      return content;
    }

    const role = contentObj.role;
    if (role !== "model" && role !== "assistant") {
      return content;
    }

    const parts = contentObj.parts as unknown[];
    const hasToolUse = parts.some(isGeminiToolUsePart);
    if (!hasToolUse) {
      return content;
    }

    const thinkingParts = parts.filter(isGeminiThinkingPart).map((p) => ensureThoughtSignature(p, signatureSessionKey));
    const otherParts = parts.filter((p) => !isGeminiThinkingPart(p));
    const hasSignedThinking = thinkingParts.some(hasSignedThinkingPart);

    if (hasSignedThinking) {
      return { ...contentObj, parts: [...thinkingParts, ...otherParts] };
    }

    const lastThinking = defaultSignatureStore.get(signatureSessionKey);
    if (!lastThinking) {
      // No cached signature available - strip thinking blocks entirely
      // Claude requires valid signatures, and we can't fake them
      // Return only tool_use parts without any thinking to avoid signature validation errors
      log.debug("Stripping thinking from tool_use content (no valid cached signature)", { signatureSessionKey });
      return { ...contentObj, parts: otherParts };
    }

    const injected = {
      thought: true,
      text: lastThinking.text,
      thoughtSignature: lastThinking.signature,
    };

    return { ...contentObj, parts: [injected, ...otherParts] };
  });
}

export function ensureMessageThinkingSignature(block: unknown, sessionId: string): unknown {
  if (!block || typeof block !== "object") {
    return block;
  }

  const record = block as Record<string, unknown>;

  if (record.type !== "thinking" && record.type !== "redacted_thinking") {
    return block;
  }

  if (typeof record.signature === "string" && record.signature.length >= MIN_SIGNATURE_LENGTH) {
    return block;
  }

  const text = typeof record.thinking === "string" ? record.thinking : typeof record.text === "string" ? record.text : "";
  if (!text) {
    return block;
  }

  const cached = getCachedSignature(sessionId, text);
  if (cached) {
    return { ...record, signature: cached };
  }

  return block;
}

export function hasToolUseInContents(contents: unknown[]): boolean {
  return contents.some((content: unknown) => {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      return false;
    }
    const contentObj = content as Record<string, unknown>;
    if (!Array.isArray(contentObj.parts)) return false;
    return (contentObj.parts as unknown[]).some(isGeminiToolUsePart);
  });
}

export function hasSignedThinkingInContents(contents: unknown[]): boolean {
  return contents.some((content: unknown) => {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      return false;
    }
    const contentObj = content as Record<string, unknown>;
    if (!Array.isArray(contentObj.parts)) return false;
    return (contentObj.parts as unknown[]).some(hasSignedThinkingPart);
  });
}

export function hasToolUseInMessages(messages: unknown[]): boolean {
  return messages.some((message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return false;
    }
    const messageObj = message as Record<string, unknown>;
    if (!Array.isArray(messageObj.content)) return false;
    return (messageObj.content as unknown[]).some(
      (block) => block && typeof block === "object" && ((block as Record<string, unknown>).type === "tool_use" || (block as Record<string, unknown>).type === "tool_result"),
    );
  });
}

export function hasSignedThinkingInMessages(messages: unknown[]): boolean {
  return messages.some((message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return false;
    }
    const messageObj = message as Record<string, unknown>;
    if (!Array.isArray(messageObj.content)) return false;
    return (messageObj.content as unknown[]).some(
      (block) => {
        if (!block || typeof block !== "object") return false;
        const b = block as Record<string, unknown>;
        return (
          (b.type === "thinking" || b.type === "redacted_thinking") &&
          typeof b.signature === "string" &&
          b.signature.length >= MIN_SIGNATURE_LENGTH
        );
      },
    );
  });
}

export function ensureThinkingBeforeToolUseInMessages(messages: unknown[], signatureSessionKey: string): unknown[] {
  return messages.map((message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return message;
    }
    const messageObj = message as Record<string, unknown>;
    if (!Array.isArray(messageObj.content)) {
      return message;
    }

    if (messageObj.role !== "assistant") {
      return message;
    }

    const blocks = messageObj.content as unknown[];
    const hasToolUse = blocks.some((b) => b && typeof b === "object" && ((b as Record<string, unknown>).type === "tool_use" || (b as Record<string, unknown>).type === "tool_result"));
    if (!hasToolUse) {
      return message;
    }

    const thinkingBlocks = blocks
      .filter((b) => b && typeof b === "object" && ((b as Record<string, unknown>).type === "thinking" || (b as Record<string, unknown>).type === "redacted_thinking"))
      .map((b) => ensureMessageThinkingSignature(b, signatureSessionKey));

    const otherBlocks = blocks.filter((b) => !(b && typeof b === "object" && ((b as Record<string, unknown>).type === "thinking" || (b as Record<string, unknown>).type === "redacted_thinking")));
    const hasSignedThinking = thinkingBlocks.some((b) => {
      if (!b || typeof b !== "object") return false;
      const record = b as Record<string, unknown>;
      return typeof record.signature === "string" && record.signature.length >= MIN_SIGNATURE_LENGTH;
    });

    if (hasSignedThinking) {
      return { ...messageObj, content: [...thinkingBlocks, ...otherBlocks] };
    }

    const lastThinking = defaultSignatureStore.get(signatureSessionKey);
    if (!lastThinking) {
      // No cached signature available - use sentinel to bypass validation
      // This handles cache miss scenarios (restart, session mismatch, expiry)
      const existingThinking = thinkingBlocks[0];
      const existingRecord = existingThinking && typeof existingThinking === "object" ? existingThinking as Record<string, unknown> : undefined;
      const thinkingText = existingRecord
        ? (typeof existingRecord.thinking === "string" ? existingRecord.thinking : typeof existingRecord.text === "string" ? existingRecord.text : "")
        : "";
      log.debug("Injecting sentinel signature (cache miss)", { signatureSessionKey });
      const sentinelBlock = {
        type: "thinking",
        thinking: thinkingText,
        signature: SKIP_THOUGHT_SIGNATURE,
      };
      return { ...messageObj, content: [sentinelBlock, ...otherBlocks] };
    }

    const injected = {
      type: "thinking",
      thinking: lastThinking.text,
      signature: lastThinking.signature,
    };

    return { ...messageObj, content: [injected, ...otherBlocks] };
  });
}

/**
 * Gets the stable session ID for this plugin instance.
 */
export function getPluginSessionId(): string {
  return PLUGIN_SESSION_ID;
}

export function generateSyntheticProjectId(): string {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomPart = crypto.randomUUID().slice(0, 5).toLowerCase();
  return `${adj}-${noun}-${randomPart}`;
}

export const STREAM_ACTION = "streamGenerateContent";

/**
 * Detects requests headed to the Google Generative Language API so we can intercept them.
 */
export function isGenerativeLanguageRequest(input: RequestInfo): input is string {
  return typeof input === "string" && input.includes("generativelanguage.googleapis.com");
}
