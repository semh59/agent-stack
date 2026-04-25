/**
 * Tests for SSE streaming transformer.
 * Covers: SSE parsing, thinking dedup, signature caching, synthetic usageMetadata, image handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createThoughtBuffer,
  transformStreamingPayload,
  deduplicateThinkingText,
  transformSseLine,
  cacheThinkingSignaturesFromResponse,
  createStreamingTransformer,
} from "./transformer";
import type { SignatureStore, StreamingCallbacks, StreamingOptions } from "./types";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeSignatureStore(): SignatureStore {
  const map = new Map<string, { text: string; signature: string }>();
  return {
    get: (key: string) => map.get(key) ?? undefined,
    set: (key: string, val: { text: string; signature: string }) => { map.set(key, val); },
    has: (key: string) => map.has(key),
    delete: (key: string) => { map.delete(key); },
  };
}

function makeCallbacks(overrides?: Partial<StreamingCallbacks>): StreamingCallbacks {
  return {
    transformThinkingParts: (r: unknown) => r,
    onCacheSignature: vi.fn(),
    onInjectDebug: undefined,
    ...overrides,
  };
}

function sseDataLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

// â”€â”€ createThoughtBuffer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("createThoughtBuffer", () => {
  it("should store and retrieve text by index", () => {
    const buf = createThoughtBuffer();
    expect(buf.get(0)).toBeUndefined();
    buf.set(0, "hello");
    expect(buf.get(0)).toBe("hello");
  });

  it("should overwrite previous value", () => {
    const buf = createThoughtBuffer();
    buf.set(0, "a");
    buf.set(0, "b");
    expect(buf.get(0)).toBe("b");
  });

  it("should clear all entries", () => {
    const buf = createThoughtBuffer();
    buf.set(0, "a");
    buf.set(1, "b");
    buf.clear();
    expect(buf.get(0)).toBeUndefined();
    expect(buf.get(1)).toBeUndefined();
  });
});

// â”€â”€ transformStreamingPayload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("transformStreamingPayload", () => {
  it("should pass through non-data lines unchanged", () => {
    const input = "event: message\ndata: {}\n\n";
    const result = transformStreamingPayload(input);
    expect(result).toContain("event: message");
  });

  it("should transform data lines with response envelope", () => {
    const payload = { response: { candidates: [{ content: { parts: [{ text: "hi" }] } }] } };
    const input = sseDataLine(payload);
    const result = transformStreamingPayload(input);
    const parsed = JSON.parse(result.replace("data: ", ""));
    expect(parsed.candidates).toBeDefined();
  });

  it("should apply transformThinkingParts when provided", () => {
    const payload = { response: { candidates: [{ content: { parts: [{ thought: true, text: "thinking..." }] } }] } };
    const input = sseDataLine(payload);
    const transform = (r: unknown) => {
      const resp = r as Record<string, unknown>;
      return { ...resp, transformed: true };
    };
    const result = transformStreamingPayload(input, transform as any);
    const parsed = JSON.parse(result.replace("data: ", ""));
    expect(parsed.transformed).toBe(true);
  });

  it("should leave non-JSON data lines unchanged", () => {
    const input = "data: [DONE]";
    const result = transformStreamingPayload(input);
    expect(result).toBe("data: [DONE]");
  });
});

// â”€â”€ deduplicateThinkingText â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("deduplicateThinkingText", () => {
  it("should return non-object responses unchanged", () => {
    expect(deduplicateThinkingText(null, createThoughtBuffer())).toBeNull();
    expect(deduplicateThinkingText("string" as any, createThoughtBuffer())).toBe("string");
  });

  it("should deduplicate Gemini-style thinking parts", () => {
    const sent = createThoughtBuffer();
    const response = {
      candidates: [{
        content: {
          parts: [
            { thought: true, text: "Hello world" },
            { text: "normal part" },
          ],
        },
      }],
    };

    // First call: no previous state, sends full text
    const result1 = deduplicateThinkingText(response, sent) as typeof response;
    expect(result1.candidates[0]!.content.parts).toHaveLength(2);

    // Second call with same text: should produce delta
    const response2 = {
      candidates: [{
        content: {
          parts: [
            { thought: true, text: "Hello world extended" },
          ],
        },
      }],
    };
    const result2 = deduplicateThinkingText(response2 as any, sent) as any;
    const thinkingPart = result2.candidates[0]!.content.parts[0] as Record<string, unknown>;
    expect(thinkingPart.text).toBe(" extended");
  });

  it("should deduplicate Claude-style thinking blocks", () => {
    const sent = createThoughtBuffer();
    const response = {
      content: [
        { type: "thinking", thinking: "Hello" },
        { type: "text", text: "result" },
      ],
    };

    const result1 = deduplicateThinkingText(response, sent) as typeof response;
    expect(result1.content).toHaveLength(2);

    const response2 = {
      content: [
        { type: "thinking", thinking: "Hello world" },
      ],
    };
    const result2 = deduplicateThinkingText(response2 as any, sent) as any;
    const thinkingBlock = result2.content[0] as Record<string, unknown>;
    expect(thinkingBlock.thinking).toBe(" world");
  });

  it("should filter out null parts (duplicate thinking)", () => {
    const sent = createThoughtBuffer();
    const hashes = new Set<string>();
    const response = {
      candidates: [{
        content: {
          parts: [
            { thought: true, text: "same" },
          ],
        },
      }],
    };

    // First call adds hash
    deduplicateThinkingText(response as any, sent, hashes);
    // Second call with same text should produce null
    const result = deduplicateThinkingText(response as any, sent, hashes) as any;
    expect(result.candidates[0]!.content.parts).toHaveLength(0);
  });

  it("should handle image inlineData parts", () => {
    const sent = createThoughtBuffer();
    const response = {
      candidates: [{
        content: {
          parts: [
            { inlineData: { mimeType: "image/png", data: "fake" } },
          ],
        },
      }],
    };
    // processImageData is mocked â€” if it returns null, part stays
    const result = deduplicateThinkingText(response as any, sent) as any;
    // The part should be transformed or kept as-is depending on processImageData
    expect(result.candidates[0]!.content.parts).toHaveLength(1);
  });
});

// â”€â”€ transformSseLine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("transformSseLine", () => {
  let store: SignatureStore;
  let thoughtBuffer: ReturnType<typeof createThoughtBuffer>;
  let sentBuffer: ReturnType<typeof createThoughtBuffer>;
  let callbacks: StreamingCallbacks;
  let options: StreamingOptions;
  let debugState: { injected: boolean };

  beforeEach(() => {
    store = makeSignatureStore();
    thoughtBuffer = createThoughtBuffer();
    sentBuffer = createThoughtBuffer();
    callbacks = makeCallbacks();
    options = {};
    debugState = { injected: false };
  });

  it("should pass through non-data lines", () => {
    expect(transformSseLine("event: chunk", store, thoughtBuffer, sentBuffer, callbacks, options, debugState))
      .toBe("event: chunk");
  });

  it("should pass through empty data lines", () => {
    expect(transformSseLine("data: ", store, thoughtBuffer, sentBuffer, callbacks, options, debugState))
      .toBe("data: ");
  });

  it("should transform response envelope data lines", () => {
    const payload = { response: { candidates: [] } };
    const line = sseDataLine(payload);
    const result = transformSseLine(line, store, thoughtBuffer, sentBuffer, callbacks, options, debugState);
    expect(result.startsWith("data: ")).toBe(true);
  });

  it("should cache signatures when caching is enabled", () => {
    options = {
      cacheSignatures: true,
      signatureSessionKey: "session1",
    };
    const payload = {
      response: {
        candidates: [{
          content: {
            parts: [
              { thought: true, text: "thinking text" },
              { thoughtSignature: "sig123" },
            ],
          },
        }],
      },
    };
    const line = sseDataLine(payload);
    transformSseLine(line, store, thoughtBuffer, sentBuffer, callbacks, options, debugState);
    expect(store.has("session1")).toBe(true);
    expect(callbacks.onCacheSignature).toHaveBeenCalledWith("session1", "thinking text", "sig123");
  });

  it("should inject debug text once", () => {
    const onInjectDebug = vi.fn((r: unknown, _text: string) => ({
      ...(r as Record<string, unknown>),
      debug: true,
    }));
    callbacks = makeCallbacks({ onInjectDebug });
    options = { debugText: "DEBUG" };

    const payload = { response: { candidates: [] } };
    const line = sseDataLine(payload);

    // First call injects
    const result1 = transformSseLine(line, store, thoughtBuffer, sentBuffer, callbacks, options, debugState);
    expect(onInjectDebug).toHaveBeenCalledTimes(1);
    const parsed1 = JSON.parse(result1.replace("data: ", ""));
    expect(parsed1.debug).toBe(true);

    // Second call does not inject again
    debugState.injected = true;
    transformSseLine(line, store, thoughtBuffer, sentBuffer, callbacks, options, debugState);
    expect(onInjectDebug).toHaveBeenCalledTimes(1);
  });
});

// â”€â”€ cacheThinkingSignaturesFromResponse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("cacheThinkingSignaturesFromResponse", () => {
  let store: SignatureStore;
  let thoughtBuffer: ReturnType<typeof createThoughtBuffer>;
  let onCacheSignature: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = makeSignatureStore();
    thoughtBuffer = createThoughtBuffer();
    onCacheSignature = vi.fn();
  });

  it("should cache Gemini-style signatures", () => {
    const response = {
      candidates: [{
        content: {
          parts: [
            { thought: true, text: "think" },
            { thoughtSignature: "sig1" },
          ],
        },
      }],
    };
    cacheThinkingSignaturesFromResponse(response as any, "s1", store, thoughtBuffer, onCacheSignature as any);
    expect(store.get("s1")).toEqual({ text: "think", signature: "sig1" });
    expect(onCacheSignature).toHaveBeenCalledWith("s1", "think", "sig1");
  });

  it("should cache Claude-style signatures", () => {
    const response = {
      content: [
        { type: "thinking", thinking: "thought text" },
        { type: "text", text: "result" },
        { signature: "sig-claude" },
      ],
    };
    cacheThinkingSignaturesFromResponse(response as any, "s2", store, thoughtBuffer, onCacheSignature as any);
    expect(store.get("s2")).toEqual({ text: "thought text", signature: "sig-claude" });
  });

  it("should accumulate thinking text across calls", () => {
    const response1 = {
      candidates: [{
        content: { parts: [{ thought: true, text: "part1 " }] },
      }],
    };
    const response2 = {
      candidates: [{
        content: { parts: [{ thought: true, text: "part2" }, { thoughtSignature: "sig-acc" }] },
      }],
    };
    cacheThinkingSignaturesFromResponse(response1 as any, "s3", store, thoughtBuffer, onCacheSignature as any);
    cacheThinkingSignaturesFromResponse(response2 as any, "s3", store, thoughtBuffer, onCacheSignature as any);
    expect(store.get("s3")).toEqual({ text: "part1 part2", signature: "sig-acc" });
  });

  it("should handle null/undefined response gracefully", () => {
    expect(() => cacheThinkingSignaturesFromResponse(null, "s", store, thoughtBuffer)).not.toThrow();
    expect(() => cacheThinkingSignaturesFromResponse(undefined, "s", store, thoughtBuffer)).not.toThrow();
  });
});

// â”€â”€ createStreamingTransformer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("createStreamingTransformer", () => {
  it("should transform SSE chunks and produce output", async () => {
    const store = makeSignatureStore();
    const callbacks = makeCallbacks();
    const options: StreamingOptions = {};
    const transformer = createStreamingTransformer(store, callbacks, options);

    const reader = transformer.readable.getReader();
    const writer = transformer.writable.getWriter();

    const payload = { response: { candidates: [{ content: { parts: [{ text: "hello" }] } }] } };
    const chunk = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);

    const results: Uint8Array[] = [];
    const readPromise = (async () => {
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) results.push(chunk.value);
      }
    })();

    await writer.write(chunk);
    await writer.close();
    await readPromise;

    const output = results.map(r => new TextDecoder().decode(r)).join("");
    expect(output).toContain("data:");
    expect(output).toContain("hello");
  });

  it("should inject synthetic usageMetadata when missing", async () => {
    const store = makeSignatureStore();
    const callbacks = makeCallbacks();
    const options: StreamingOptions = {};
    const transformer = createStreamingTransformer(store, callbacks, options);

    const reader = transformer.readable.getReader();
    const writer = transformer.writable.getWriter();

    const results: Uint8Array[] = [];
    const readPromise = (async () => {
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) results.push(chunk.value);
      }
    })();

    // Write a response without usageMetadata
    const payload = { response: { candidates: [] } };
    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
    await writer.close();
    await readPromise;

    const output = results.map(r => new TextDecoder().decode(r)).join("");
    expect(output).toContain("usageMetadata");
    expect(output).toContain("promptTokenCount");
  });

  it("should not inject synthetic usageMetadata when already present", async () => {
    const store = makeSignatureStore();
    const callbacks = makeCallbacks();
    const options: StreamingOptions = {};
    const transformer = createStreamingTransformer(store, callbacks, options);

    const reader = transformer.readable.getReader();
    const writer = transformer.writable.getWriter();

    const results: Uint8Array[] = [];
    const readPromise = (async () => {
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) results.push(chunk.value);
      }
    })();

    // Write a response WITH usageMetadata
    const payload = {
      response: {
        candidates: [],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      },
    };
    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
    await writer.close();
    await readPromise;

    const output = results.map(r => new TextDecoder().decode(r)).join("");
    // Should have original usageMetadata, not synthetic (0,0,0)
    const usageCount = (output.match(/usageMetadata/g) || []).length;
    expect(usageCount).toBe(1);
  });
});
