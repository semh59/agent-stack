import type { AgentDefinition } from "../agents";
import type { ILLMProvider, LLMProviderResult } from "./ILLMProvider";
import type { TokenUsage } from "./pipeline-types";

/**
 * Google Gemini Provider Implementation
 */
export class GeminiProvider implements ILLMProvider {
  readonly name = "google";

  async execute(
    agent: AgentDefinition,
    systemPrompt: string,
    userPrompt: string,
    model: string,
    options: {
      temperature: number;
      maxOutputTokens: number;
      timeoutMs: number;
      fetchFn?: typeof fetch;
    }
  ): Promise<LLMProviderResult> {
    const fetchFn = options.fetchFn ?? fetch;
    const cleanModel = model.includes("/") ? model.split("/")[1]! : model;
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

    const data = (await res.json()) as any;
    if (!data || typeof data !== 'object') {
      throw new Error('Gemini API returned invalid response format');
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usage = data.usageMetadata;
    const tokenUsage: TokenUsage = {
      promptTokens: typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0,
      completionTokens: typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0,
      totalTokens: typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : 0,
      estimatedCostUsd: (typeof usage?.totalTokenCount === 'number' ? usage.totalTokenCount : 0) * 0.000_000_1,
    };
    return { output: text, tokenUsage };
  }
}

/**
 * Anthropic Claude Provider Implementation
 */
export class AnthropicProvider implements ILLMProvider {
  readonly name = "anthropic";

  async execute(
    agent: AgentDefinition,
    systemPrompt: string,
    userPrompt: string,
    model: string,
    options: {
      temperature: number;
      maxOutputTokens: number;
      timeoutMs: number;
      fetchFn?: typeof fetch;
    }
  ): Promise<LLMProviderResult> {
    const fetchFn = options.fetchFn ?? fetch;
    const modelMap: Record<string, string> = {
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

    const data = (await res.json()) as any;
    if (!data || typeof data !== 'object') {
      throw new Error('Anthropic API returned invalid response format');
    }
    const text =
      (Array.isArray(data.content) ? data.content : [])
        .filter((b: any) => b && typeof b === 'object' && b.type === "text")
        .map((b: any) => b.text)
        .join("\n") ?? "";

    const usage = data.usage;
    const tokenUsage: TokenUsage = {
      promptTokens: usage?.input_tokens ?? 0,
      completionTokens: usage?.output_tokens ?? 0,
      totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
      estimatedCostUsd:
        (usage?.input_tokens ?? 0) * 0.000_015 +
        (usage?.output_tokens ?? 0) * 0.000_075,
    };
    return { output: text, tokenUsage };
  }
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements ILLMProvider {
  readonly name = "openai";

  async execute(
    agent: AgentDefinition,
    systemPrompt: string,
    userPrompt: string,
    model: string,
    options: {
      temperature: number;
      maxOutputTokens: number;
      timeoutMs: number;
      fetchFn?: typeof fetch;
    }
  ): Promise<LLMProviderResult> {
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

    const data = (await res.json()) as any;
    if (!data || typeof data !== 'object') {
      throw new Error('OpenAI API returned invalid response format');
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage;
    const tokenUsage: TokenUsage = {
      promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0,
      totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0,
      estimatedCostUsd: (typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0) * 0.000_005,
    };
    return { output: text, tokenUsage };
  }
}
