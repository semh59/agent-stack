"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STREAM_ACTION = exports.SENTINEL_SIGNATURE = exports.SYNTHETIC_THINKING_PLACEHOLDER = exports.MIN_SIGNATURE_LENGTH = exports.sessionDisplayedThinkingHashes = exports.PLUGIN_SESSION_ID = void 0;
exports.buildSignatureSessionKey = buildSignatureSessionKey;
exports.shouldCacheThinkingSignatures = shouldCacheThinkingSignatures;
exports.hashConversationSeed = hashConversationSeed;
exports.extractTextFromContent = extractTextFromContent;
exports.extractConversationSeedFromMessages = extractConversationSeedFromMessages;
exports.extractConversationSeedFromContents = extractConversationSeedFromContents;
exports.resolveConversationKey = resolveConversationKey;
exports.resolveConversationKeyFromRequests = resolveConversationKeyFromRequests;
exports.resolveProjectKey = resolveProjectKey;
exports.formatDebugLinesForThinking = formatDebugLinesForThinking;
exports.injectDebugThinking = injectDebugThinking;
exports.stripInjectedDebugFromParts = stripInjectedDebugFromParts;
exports.stripInjectedDebugFromRequestPayload = stripInjectedDebugFromRequestPayload;
exports.isGeminiToolUsePart = isGeminiToolUsePart;
exports.isGeminiThinkingPart = isGeminiThinkingPart;
exports.ensureThoughtSignature = ensureThoughtSignature;
exports.hasSignedThinkingPart = hasSignedThinkingPart;
exports.ensureThinkingBeforeToolUseInContents = ensureThinkingBeforeToolUseInContents;
exports.ensureMessageThinkingSignature = ensureMessageThinkingSignature;
exports.hasToolUseInContents = hasToolUseInContents;
exports.hasSignedThinkingInContents = hasSignedThinkingInContents;
exports.hasToolUseInMessages = hasToolUseInMessages;
exports.hasSignedThinkingInMessages = hasSignedThinkingInMessages;
exports.ensureThinkingBeforeToolUseInMessages = ensureThinkingBeforeToolUseInMessages;
exports.getPluginSessionId = getPluginSessionId;
exports.generateSyntheticProjectId = generateSyntheticProjectId;
exports.isGenerativeLanguageRequest = isGenerativeLanguageRequest;
const node_crypto_1 = __importDefault(require("node:crypto"));
const constants_1 = require("../../constants");
const cache_1 = require("../cache");
const signature_store_1 = require("../stores/signature-store");
const debug_1 = require("../debug");
const logger_1 = require("../logger");
const log = (0, logger_1.createLogger)("request-thinking-utils");
exports.PLUGIN_SESSION_ID = `-${node_crypto_1.default.randomUUID()}`;
exports.sessionDisplayedThinkingHashes = new Set();
exports.MIN_SIGNATURE_LENGTH = 50;
function buildSignatureSessionKey(sessionId, model, conversationKey, projectKey) {
    const modelKey = typeof model === "string" && model.trim() ? model.toLowerCase() : "unknown";
    const projectPart = typeof projectKey === "string" && projectKey.trim()
        ? projectKey.trim()
        : "default";
    const conversationPart = typeof conversationKey === "string" && conversationKey.trim()
        ? conversationKey.trim()
        : "default";
    return `${sessionId}:${modelKey}:${projectPart}:${conversationPart}`;
}
function shouldCacheThinkingSignatures(model) {
    if (typeof model !== "string")
        return false;
    const lower = model.toLowerCase();
    // Both Claude and Gemini 3 models require thought signature caching
    // for multi-turn conversations with function calling
    return lower.includes("claude") || lower.includes("gemini-3");
}
function hashConversationSeed(seed) {
    return node_crypto_1.default.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16);
}
function extractTextFromContent(content) {
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
        const record = block;
        if (typeof record.text === "string") {
            return record.text;
        }
        if (record.text && typeof record.text === "object" && typeof record.text.text === "string") {
            return record.text.text;
        }
    }
    return "";
}
function extractConversationSeedFromMessages(messages) {
    const asRecords = messages.filter((m) => !!m && typeof m === "object" && !Array.isArray(m));
    const system = asRecords.find((message) => message.role === "system");
    const users = asRecords.filter((message) => message.role === "user");
    const firstUser = users[0];
    const lastUser = users.length > 0 ? users[users.length - 1] : undefined;
    const systemText = system ? extractTextFromContent(system.content) : "";
    const userText = firstUser ? extractTextFromContent(firstUser.content) : "";
    const fallbackUserText = !userText && lastUser ? extractTextFromContent(lastUser.content) : "";
    return [systemText, userText || fallbackUserText].filter(Boolean).join("|");
}
function extractConversationSeedFromContents(contents) {
    const asRecords = contents.filter((c) => !!c && typeof c === "object" && !Array.isArray(c));
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
function resolveConversationKey(requestPayload) {
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
            ? requestPayload.metadata.conversation_id
            : undefined,
        requestPayload.metadata && typeof requestPayload.metadata === "object"
            ? requestPayload.metadata.conversationId
            : undefined,
        requestPayload.metadata && typeof requestPayload.metadata === "object"
            ? requestPayload.metadata.thread_id
            : undefined,
        requestPayload.metadata && typeof requestPayload.metadata === "object"
            ? requestPayload.metadata.threadId
            : undefined,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }
    const systemInstruction = requestPayload.systemInstruction;
    const systemInstructionParts = systemInstruction && typeof systemInstruction === "object"
        ? systemInstruction.parts
        : undefined;
    const systemSeed = extractTextFromContent(systemInstructionParts
        ?? requestPayload.systemInstruction
        ?? requestPayload.system
        ?? requestPayload.system_instruction);
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
function resolveConversationKeyFromRequests(requestObjects) {
    for (const req of requestObjects) {
        const key = resolveConversationKey(req);
        if (key) {
            return key;
        }
    }
    return undefined;
}
function resolveProjectKey(candidate, fallback) {
    if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
    }
    if (typeof fallback === "string" && fallback.trim()) {
        return fallback.trim();
    }
    return undefined;
}
function formatDebugLinesForThinking(lines) {
    const cleaned = lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(-50);
    return `${debug_1.DEBUG_MESSAGE_PREFIX}\n${cleaned.map((line) => `- ${line}`).join("\n")}`;
}
function injectDebugThinking(response, debugText) {
    if (!response || typeof response !== "object") {
        return response;
    }
    const resp = response;
    if (Array.isArray(resp.candidates) && resp.candidates.length > 0) {
        const candidates = resp.candidates.slice();
        const first = candidates[0];
        if (first &&
            typeof first === "object" &&
            first.content &&
            typeof first.content === "object" &&
            Array.isArray(first.content.parts)) {
            const firstContent = first.content;
            const parts = [{ thought: true, text: debugText }, ...firstContent.parts];
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
exports.SYNTHETIC_THINKING_PLACEHOLDER = "[Thinking preserved]\n";
function stripInjectedDebugFromParts(parts) {
    if (!Array.isArray(parts)) {
        return parts;
    }
    return parts.filter((part) => {
        if (!part || typeof part !== "object") {
            return true;
        }
        const record = part;
        const text = typeof record.text === "string"
            ? record.text
            : typeof record.thinking === "string"
                ? record.thinking
                : undefined;
        // Strip debug blocks and synthetic thinking placeholders
        if (text && (text.startsWith(debug_1.DEBUG_MESSAGE_PREFIX) || text.startsWith(exports.SYNTHETIC_THINKING_PLACEHOLDER.trim()))) {
            return false;
        }
        return true;
    });
}
function stripInjectedDebugFromRequestPayload(payload) {
    if (Array.isArray(payload.contents)) {
        payload.contents = payload.contents.map((content) => {
            if (!content || typeof content !== "object") {
                return content;
            }
            const contentObj = content;
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
        payload.messages = payload.messages.map((message) => {
            if (!message || typeof message !== "object") {
                return message;
            }
            const messageObj = message;
            if (Array.isArray(messageObj.content)) {
                return { ...messageObj, content: stripInjectedDebugFromParts(messageObj.content) };
            }
            return message;
        });
    }
}
function isGeminiToolUsePart(part) {
    if (!part || typeof part !== "object")
        return false;
    const record = part;
    return !!(record.functionCall || record.tool_use || record.toolUse);
}
function isGeminiThinkingPart(part) {
    if (!part || typeof part !== "object")
        return false;
    const record = part;
    return !!(record.thought === true || record.type === "thinking" || record.type === "reasoning");
}
// Sentinel value used when signature recovery fails - allows Claude to handle gracefully
// by redacting the thinking block instead of rejecting the request entirely.
// Reference: LLM-API-Key-Proxy uses this pattern for Gemini 3 tool calls.
exports.SENTINEL_SIGNATURE = "skip_thought_signature_validator";
function ensureThoughtSignature(part, sessionId) {
    if (!part || typeof part !== "object") {
        return part;
    }
    const record = part;
    const text = typeof record.text === "string" ? record.text : typeof record.thinking === "string" ? record.thinking : "";
    if (!text) {
        return part;
    }
    if (record.thought === true) {
        if (!record.thoughtSignature) {
            const cached = (0, cache_1.getCachedSignature)(sessionId, text);
            if (cached) {
                return { ...record, thoughtSignature: cached };
            }
            // Fallback: use sentinel signature to prevent API rejection
            // This allows Claude to redact the thinking block instead of failing
            return { ...record, thoughtSignature: exports.SENTINEL_SIGNATURE };
        }
        return part;
    }
    if ((record.type === "thinking" || record.type === "reasoning") && !record.signature) {
        const cached = (0, cache_1.getCachedSignature)(sessionId, text);
        if (cached) {
            return { ...record, signature: cached };
        }
        // Fallback: use sentinel signature to prevent API rejection
        return { ...record, signature: exports.SENTINEL_SIGNATURE };
    }
    return part;
}
function hasSignedThinkingPart(part) {
    if (!part || typeof part !== "object") {
        return false;
    }
    const record = part;
    if (record.thought === true) {
        return typeof record.thoughtSignature === "string" && record.thoughtSignature.length >= exports.MIN_SIGNATURE_LENGTH;
    }
    if (record.type === "thinking" || record.type === "reasoning") {
        return typeof record.signature === "string" && record.signature.length >= exports.MIN_SIGNATURE_LENGTH;
    }
    return false;
}
function ensureThinkingBeforeToolUseInContents(contents, signatureSessionKey) {
    return contents.map((content) => {
        if (!content || typeof content !== "object" || Array.isArray(content)) {
            return content;
        }
        const contentObj = content;
        if (!Array.isArray(contentObj.parts)) {
            return content;
        }
        const role = contentObj.role;
        if (role !== "model" && role !== "assistant") {
            return content;
        }
        const parts = contentObj.parts;
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
        const lastThinking = signature_store_1.defaultSignatureStore.get(signatureSessionKey);
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
function ensureMessageThinkingSignature(block, sessionId) {
    if (!block || typeof block !== "object") {
        return block;
    }
    const record = block;
    if (record.type !== "thinking" && record.type !== "redacted_thinking") {
        return block;
    }
    if (typeof record.signature === "string" && record.signature.length >= exports.MIN_SIGNATURE_LENGTH) {
        return block;
    }
    const text = typeof record.thinking === "string" ? record.thinking : typeof record.text === "string" ? record.text : "";
    if (!text) {
        return block;
    }
    const cached = (0, cache_1.getCachedSignature)(sessionId, text);
    if (cached) {
        return { ...record, signature: cached };
    }
    return block;
}
function hasToolUseInContents(contents) {
    return contents.some((content) => {
        if (!content || typeof content !== "object" || Array.isArray(content)) {
            return false;
        }
        const contentObj = content;
        if (!Array.isArray(contentObj.parts))
            return false;
        return contentObj.parts.some(isGeminiToolUsePart);
    });
}
function hasSignedThinkingInContents(contents) {
    return contents.some((content) => {
        if (!content || typeof content !== "object" || Array.isArray(content)) {
            return false;
        }
        const contentObj = content;
        if (!Array.isArray(contentObj.parts))
            return false;
        return contentObj.parts.some(hasSignedThinkingPart);
    });
}
function hasToolUseInMessages(messages) {
    return messages.some((message) => {
        if (!message || typeof message !== "object" || Array.isArray(message)) {
            return false;
        }
        const messageObj = message;
        if (!Array.isArray(messageObj.content))
            return false;
        return messageObj.content.some((block) => block && typeof block === "object" && (block.type === "tool_use" || block.type === "tool_result"));
    });
}
function hasSignedThinkingInMessages(messages) {
    return messages.some((message) => {
        if (!message || typeof message !== "object" || Array.isArray(message)) {
            return false;
        }
        const messageObj = message;
        if (!Array.isArray(messageObj.content))
            return false;
        return messageObj.content.some((block) => {
            if (!block || typeof block !== "object")
                return false;
            const b = block;
            return ((b.type === "thinking" || b.type === "redacted_thinking") &&
                typeof b.signature === "string" &&
                b.signature.length >= exports.MIN_SIGNATURE_LENGTH);
        });
    });
}
function ensureThinkingBeforeToolUseInMessages(messages, signatureSessionKey) {
    return messages.map((message) => {
        if (!message || typeof message !== "object" || Array.isArray(message)) {
            return message;
        }
        const messageObj = message;
        if (!Array.isArray(messageObj.content)) {
            return message;
        }
        if (messageObj.role !== "assistant") {
            return message;
        }
        const blocks = messageObj.content;
        const hasToolUse = blocks.some((b) => b && typeof b === "object" && (b.type === "tool_use" || b.type === "tool_result"));
        if (!hasToolUse) {
            return message;
        }
        const thinkingBlocks = blocks
            .filter((b) => b && typeof b === "object" && (b.type === "thinking" || b.type === "redacted_thinking"))
            .map((b) => ensureMessageThinkingSignature(b, signatureSessionKey));
        const otherBlocks = blocks.filter((b) => !(b && typeof b === "object" && (b.type === "thinking" || b.type === "redacted_thinking")));
        const hasSignedThinking = thinkingBlocks.some((b) => {
            if (!b || typeof b !== "object")
                return false;
            const record = b;
            return typeof record.signature === "string" && record.signature.length >= exports.MIN_SIGNATURE_LENGTH;
        });
        if (hasSignedThinking) {
            return { ...messageObj, content: [...thinkingBlocks, ...otherBlocks] };
        }
        const lastThinking = signature_store_1.defaultSignatureStore.get(signatureSessionKey);
        if (!lastThinking) {
            // No cached signature available - use sentinel to bypass validation
            // This handles cache miss scenarios (restart, session mismatch, expiry)
            const existingThinking = thinkingBlocks[0];
            const existingRecord = existingThinking && typeof existingThinking === "object" ? existingThinking : undefined;
            const thinkingText = existingRecord
                ? (typeof existingRecord.thinking === "string" ? existingRecord.thinking : typeof existingRecord.text === "string" ? existingRecord.text : "")
                : "";
            log.debug("Injecting sentinel signature (cache miss)", { signatureSessionKey });
            const sentinelBlock = {
                type: "thinking",
                thinking: thinkingText,
                signature: constants_1.SKIP_THOUGHT_SIGNATURE,
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
function getPluginSessionId() {
    return exports.PLUGIN_SESSION_ID;
}
function generateSyntheticProjectId() {
    const adjectives = ["useful", "bright", "swift", "calm", "bold"];
    const nouns = ["fuze", "wave", "spark", "flow", "core"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomPart = node_crypto_1.default.randomUUID().slice(0, 5).toLowerCase();
    return `${adj}-${noun}-${randomPart}`;
}
exports.STREAM_ACTION = "streamGenerateContent";
/**
 * Detects requests headed to the Google Generative Language API so we can intercept them.
 */
function isGenerativeLanguageRequest(input) {
    return typeof input === "string" && input.includes("generativelanguage.googleapis.com");
}
//# sourceMappingURL=request-thinking-utils.js.map