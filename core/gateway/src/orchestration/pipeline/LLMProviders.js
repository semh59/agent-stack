"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = exports.SpeculativeProvider = exports.OpenAIProvider = exports.AnthropicProvider = exports.GeminiProvider = void 0;
/**
 * Google Gemini Provider Implementation
 */
class GeminiProvider {
    name = "google";
    async execute(agent, systemPrompt, userPrompt, model, options) {
        const fetchFn = options.fetchFn ?? fetch;
        const cleanModel = model.includes("/") ? model.split("/")[1] : model;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;
        const res = await fetchFn(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                generationConfig: {
                    temperature: options.temperature,
                    maxOutputTokens: options.maxOutputTokens,
                },
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Gemini API Error ${res.status}: ${body.slice(0, 500)}`);
        }
        const data = await res.json();
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const firstCandidate = candidates[0];
        const content = firstCandidate?.content;
        const parts = Array.isArray(content?.parts) ? content.parts : [];
        const firstPart = parts[0];
        const text = typeof firstPart?.text === "string" ? firstPart.text : "";
        const usage = data.usageMetadata;
        const tokenUsage = {
            promptTokens: typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0,
            completionTokens: typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0,
            totalTokens: typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : 0,
            estimatedCostUsd: (typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : 0) * 0.000_000_1,
        };
        return { output: text, tokenUsage };
    }
}
exports.GeminiProvider = GeminiProvider;
/**
 * Anthropic Claude Provider Implementation
 */
class AnthropicProvider {
    name = "anthropic";
    async execute(agent, systemPrompt, userPrompt, model, options) {
        const fetchFn = options.fetchFn ?? fetch;
        const modelMap = {
            opus: "claude-opus-4-0-20250514",
            sonnet: "claude-sonnet-4-20250514",
            haiku: "claude-haiku-4-20250514",
        };
        const fullModel = modelMap[model.toLowerCase()] ?? model;
        const res = await fetchFn("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
                model: fullModel,
                max_tokens: options.maxOutputTokens,
                system: systemPrompt,
                messages: [{ role: "user", content: userPrompt }],
                temperature: options.temperature,
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Anthropic API Error ${res.status}: ${body.slice(0, 500)}`);
        }
        const data = await res.json();
        const text = (Array.isArray(data.content) ? data.content : [])
            .filter((b) => b && typeof b === 'object' && b.type === "text")
            .map((b) => b.text)
            .join("\n") ?? "";
        const usage = data.usage;
        const tokenUsage = {
            promptTokens: usage?.input_tokens ?? 0,
            completionTokens: usage?.output_tokens ?? 0,
            totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
            estimatedCostUsd: (usage?.input_tokens ?? 0) * 0.000_015 +
                (usage?.output_tokens ?? 0) * 0.000_075,
        };
        return { output: text, tokenUsage };
    }
}
exports.AnthropicProvider = AnthropicProvider;
/**
 * OpenAI Provider Implementation
 */
class OpenAIProvider {
    name = "openai";
    async execute(agent, systemPrompt, userPrompt, model, options) {
        const fetchFn = options.fetchFn ?? fetch;
        const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                temperature: options.temperature,
                max_tokens: options.maxOutputTokens,
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`OpenAI API Error ${res.status}: ${body.slice(0, 500)}`);
        }
        const data = await res.json();
        const choices = Array.isArray(data.choices) ? data.choices : [];
        const firstChoice = choices[0];
        const message = firstChoice?.message;
        const text = typeof message?.content === "string" ? message.content : "";
        const usage = data.usage;
        const tokenUsage = {
            promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
            completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0,
            totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0,
            estimatedCostUsd: (typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0) * 0.000_005,
        };
        return { output: text, tokenUsage };
    }
}
exports.OpenAIProvider = OpenAIProvider;
/**
 * Speculative Consensus Provider — routes directly to the Python Bridge's Speculative engine.
 */
class SpeculativeProvider {
    bridgeUrl;
    name = "speculative";
    constructor(bridgeUrl = "http://127.0.0.1:9100") {
        this.bridgeUrl = bridgeUrl;
    }
    async execute(agent, systemPrompt, userPrompt, model, options) {
        const fetchFn = options.fetchFn ?? fetch;
        // Convert system/user prompt into a unified context for speculative router
        const combinedMessage = `<system>\n${systemPrompt}\n</system>\n\n<user>\n${userPrompt}\n</user>`;
        // Retrieve manifest from models list if available or use a default competitive manifest
        const manifest = [
            { id: "gemini-2.0-flash", provider: "google" },
            { id: "claude-haiku", provider: "anthropic" },
            { id: "gpt-4o-mini", provider: "openai" }
        ];
        const res = await fetchFn(`${this.bridgeUrl}/speculative`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Bridge-Secret": process.env.ALLOY_BRIDGE_SECRET || ""
            },
            body: JSON.stringify({
                message: combinedMessage,
                intent: "code_generation",
                manifest: manifest
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Speculative Bridge API Error ${res.status}: ${body.slice(0, 500)}`);
        }
        // Python bridge returns: { winner_model, response, latency_ms, cancelled_tasks }
        const data = await res.json();
        const text = data?.response || data?.error || "[Speculative failed]";
        const total_tokens = 0; // bridge does not return token counts for speculative
        const tokenUsage = {
            promptTokens: total_tokens,
            completionTokens: 0,
            totalTokens: total_tokens,
            estimatedCostUsd: total_tokens * 0.000_005,
        };
        return { output: text, tokenUsage };
    }
}
exports.SpeculativeProvider = SpeculativeProvider;
/**
 * Ollama Provider Implementation (OpenAI Compatibility Layer)
 */
class OllamaProvider {
    baseUrl;
    name = "ollama";
    constructor(baseUrl = "http://127.0.0.1:11434") {
        this.baseUrl = baseUrl;
    }
    async execute(agent, systemPrompt, userPrompt, model, options) {
        const fetchFn = options.fetchFn ?? fetch;
        // Strip prefixes like 'ollama/' if present for the actual API call
        const cleanModel = model.startsWith("ollama/") ? model.slice(7) : model;
        const res = await fetchFn(`${this.baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: cleanModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                temperature: options.temperature,
                max_tokens: options.maxOutputTokens,
            }),
            signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Ollama API Error ${res.status}: ${body.slice(0, 500)}`);
        }
        const data = await res.json();
        const choices = Array.isArray(data.choices) ? data.choices : [];
        const firstChoice = choices[0];
        const message = firstChoice?.message;
        const text = typeof message?.content === "string" ? message.content : "";
        // Ollama might provide usage, but we fallback to 0
        const usage = data.usage;
        const tokenUsage = {
            promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
            completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0,
            totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0,
            estimatedCostUsd: 0, // Local is free!
        };
        return { output: text, tokenUsage };
    }
}
exports.OllamaProvider = OllamaProvider;
//# sourceMappingURL=LLMProviders.js.map