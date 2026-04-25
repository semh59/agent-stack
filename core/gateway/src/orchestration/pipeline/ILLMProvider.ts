import type { AgentDefinition } from "../agents";
import type { TokenUsage } from "./pipeline-types";

export interface LLMProviderResult {
  output: string;
  tokenUsage: TokenUsage;
}

export interface ILLMProvider {
  /**
   * Identifies the provider (e.g., "anthropic", "google", "openai")
   */
  readonly name: string;

  /**
   * Executes a call to the LLM.
   */
  execute(
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
  ): Promise<LLMProviderResult>;
}
