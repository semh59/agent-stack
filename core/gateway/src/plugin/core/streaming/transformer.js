"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createThoughtBuffer = createThoughtBuffer;
exports.transformStreamingPayload = transformStreamingPayload;
exports.deduplicateThinkingText = deduplicateThinkingText;
exports.transformSseLine = transformSseLine;
exports.cacheThinkingSignaturesFromResponse = cacheThinkingSignaturesFromResponse;
exports.createStreamingTransformer = createStreamingTransformer;
const gateway_utils_1 = require("../../../orchestration/gateway-utils");
const image_saver_1 = require("../../image-saver");
/**
 * Simple string hash for thinking deduplication.
 * Uses DJB2-like algorithm.
 */
function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return (hash >>> 0).toString(16);
}
function createThoughtBuffer() {
    const buffer = new Map();
    return {
        get: (index) => buffer.get(index),
        set: (index, text) => buffer.set(index, text),
        clear: () => buffer.clear(),
    };
}
function transformStreamingPayload(payload, transformThinkingParts) {
    return payload
        .split('\n')
        .map((line) => {
        if (!line.startsWith('data:')) {
            return line;
        }
        const json = line.slice(5).trim();
        if (!json) {
            return line;
        }
        try {
            const parsed = JSON.parse(json);
            if (parsed.response !== undefined) {
                const transformed = transformThinkingParts
                    ? transformThinkingParts(parsed.response)
                    : parsed.response;
                return `data: ${JSON.stringify(transformed)}`;
            }
        }
        catch (err) {
            gateway_utils_1.log.debug('SSE line parse skip (non-critical)', { err, line });
        }
        return line;
    })
        .join('\n');
}
function deduplicateThinkingText(response, sentBuffer, displayedThinkingHashes) {
    if (!response || typeof response !== "object")
        return response;
    if (Array.isArray(response.candidates)) {
        const newCandidates = response.candidates.map((candidate, index) => {
            if (!candidate?.content)
                return candidate;
            const content = candidate.content;
            if (!Array.isArray(content.parts))
                return candidate;
            const newParts = content.parts.map((part) => {
                // Handle image data - save to disk and return file path
                if (part.inlineData) {
                    const result = (0, image_saver_1.processImageData)({
                        mimeType: part.inlineData.mimeType,
                        data: part.inlineData.data,
                    });
                    if (result) {
                        return { text: result };
                    }
                }
                if (part.thought === true || part.type === 'thinking') {
                    const fullText = (part.text || part.thinking || '');
                    if (displayedThinkingHashes) {
                        const hash = hashString(fullText);
                        if (displayedThinkingHashes.has(hash)) {
                            sentBuffer.set(index, fullText);
                            return null;
                        }
                        displayedThinkingHashes.add(hash);
                    }
                    const sentText = sentBuffer.get(index) ?? '';
                    if (fullText.startsWith(sentText)) {
                        const delta = fullText.slice(sentText.length);
                        sentBuffer.set(index, fullText);
                        if (delta) {
                            return { ...part, text: delta, thinking: delta };
                        }
                        return null;
                    }
                    sentBuffer.set(index, fullText);
                    return part;
                }
                return part;
            });
            const filteredParts = newParts.filter((p) => p !== null);
            return {
                ...candidate,
                content: { ...content, parts: filteredParts },
            };
        });
        return { ...response, candidates: newCandidates };
    }
    if (Array.isArray(response.content)) {
        let thinkingIndex = 0;
        const newContent = response.content.map((block) => {
            if (block?.type === 'thinking') {
                const fullText = (block.thinking || block.text || '');
                if (displayedThinkingHashes) {
                    const hash = hashString(fullText);
                    if (displayedThinkingHashes.has(hash)) {
                        sentBuffer.set(thinkingIndex, fullText);
                        thinkingIndex++;
                        return null;
                    }
                    displayedThinkingHashes.add(hash);
                }
                const sentText = sentBuffer.get(thinkingIndex) ?? '';
                if (fullText.startsWith(sentText)) {
                    const delta = fullText.slice(sentText.length);
                    sentBuffer.set(thinkingIndex, fullText);
                    thinkingIndex++;
                    if (delta) {
                        return { ...block, thinking: delta, text: delta };
                    }
                    return null;
                }
                sentBuffer.set(thinkingIndex, fullText);
                thinkingIndex++;
                return block;
            }
            return block;
        });
        const filteredContent = newContent.filter((b) => b !== null);
        return { ...response, content: filteredContent };
    }
    return response;
}
function transformSseLine(line, signatureStore, thoughtBuffer, sentThinkingBuffer, callbacks, options, debugState) {
    if (!line.startsWith('data:')) {
        return line;
    }
    const json = line.slice(5).trim();
    if (!json) {
        return line;
    }
    try {
        const parsed = JSON.parse(json);
        if (parsed.response !== undefined) {
            if (options.cacheSignatures && options.signatureSessionKey) {
                cacheThinkingSignaturesFromResponse(parsed.response, options.signatureSessionKey, signatureStore, thoughtBuffer, callbacks.onCacheSignature);
            }
            let response = deduplicateThinkingText(parsed.response, sentThinkingBuffer, options.displayedThinkingHashes);
            if (options.debugText && callbacks.onInjectDebug && !debugState.injected) {
                response = callbacks.onInjectDebug(response, options.debugText);
                debugState.injected = true;
            }
            // Note: onInjectSyntheticThinking removed - keep_thinking now uses debugText path
            const transformed = callbacks.transformThinkingParts
                ? callbacks.transformThinkingParts(response)
                : response;
            return `data: ${JSON.stringify(transformed)}`;
        }
    }
    catch (err) {
        gateway_utils_1.log.debug('SSE inner line parse skip', { err, line });
    }
    return line;
}
function cacheThinkingSignaturesFromResponse(response, signatureSessionKey, signatureStore, thoughtBuffer, onCacheSignature) {
    if (!response || typeof response !== "object")
        return;
    if (Array.isArray(response.candidates)) {
        response.candidates.forEach((candidate, index) => {
            if (!candidate?.content)
                return;
            const content = candidate.content;
            if (!Array.isArray(content.parts))
                return;
            content.parts.forEach((part) => {
                if (part.thought === true || part.type === 'thinking') {
                    const text = (part.text || part.thinking || '');
                    if (text) {
                        const current = thoughtBuffer.get(index) ?? '';
                        thoughtBuffer.set(index, current + text);
                    }
                }
                if (part.thoughtSignature) {
                    const fullText = thoughtBuffer.get(index) ?? '';
                    if (fullText) {
                        const signature = part.thoughtSignature;
                        onCacheSignature?.(signatureSessionKey, fullText, signature);
                        signatureStore.set(signatureSessionKey, { text: fullText, signature });
                    }
                }
            });
        });
    }
    if (Array.isArray(response.content)) {
        // Use thoughtBuffer to accumulate thinking text across SSE events
        // Claude streams thinking content and signature in separate events
        const CLAUDE_BUFFER_KEY = 0; // Use index 0 for Claude's single-stream content
        response.content.forEach((block) => {
            if (block?.type === 'thinking') {
                const text = (block.thinking || block.text || '');
                if (text) {
                    const current = thoughtBuffer.get(CLAUDE_BUFFER_KEY) ?? '';
                    thoughtBuffer.set(CLAUDE_BUFFER_KEY, current + text);
                }
            }
            if (block?.signature) {
                const fullText = thoughtBuffer.get(CLAUDE_BUFFER_KEY) ?? '';
                if (fullText) {
                    const signature = block.signature;
                    onCacheSignature?.(signatureSessionKey, fullText, signature);
                    signatureStore.set(signatureSessionKey, { text: fullText, signature });
                }
            }
        });
    }
}
function createStreamingTransformer(signatureStore, callbacks, options = {}) {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    const thoughtBuffer = createThoughtBuffer();
    const sentThinkingBuffer = createThoughtBuffer();
    const debugState = { injected: false };
    let hasSeenUsageMetadata = false;
    return new TransformStream({
        transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                // Quick check for usage metadata presence in the raw line
                if (line.includes('usageMetadata')) {
                    hasSeenUsageMetadata = true;
                }
                const transformedLine = transformSseLine(line, signatureStore, thoughtBuffer, sentThinkingBuffer, callbacks, options, debugState);
                controller.enqueue(encoder.encode(transformedLine + '\n'));
            }
        },
        flush(controller) {
            buffer += decoder.decode();
            if (buffer) {
                if (buffer.includes('usageMetadata')) {
                    hasSeenUsageMetadata = true;
                }
                const transformedLine = transformSseLine(buffer, signatureStore, thoughtBuffer, sentThinkingBuffer, callbacks, options, debugState);
                controller.enqueue(encoder.encode(transformedLine));
            }
            // Inject synthetic usage metadata if missing (fixes "Context % used: 0%" issue)
            if (!hasSeenUsageMetadata) {
                const syntheticUsage = {
                    response: {
                        usageMetadata: {
                            promptTokenCount: 0,
                            candidatesTokenCount: 0,
                            totalTokenCount: 0,
                        }
                    }
                };
                controller.enqueue(encoder.encode(`\ndata: ${JSON.stringify(syntheticUsage)}\n\n`));
            }
        },
    });
}
//# sourceMappingURL=transformer.js.map