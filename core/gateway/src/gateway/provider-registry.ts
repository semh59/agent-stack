import { AIProvider, type ProviderAdapter } from "./provider-types";
import { GoogleGeminiProvider } from "./google-provider";
import { ClaudeCodeProvider } from "./claude-provider";
import { GenericKeyProvider } from "./generic-provider";

const adapters = new Map<AIProvider, ProviderAdapter>();

/**
 * Register all available provider adapters.
 */
export function registerDefaultAdapters() {
  adapters.set(AIProvider.GOOGLE_GEMINI, new GoogleGeminiProvider());
  adapters.set(AIProvider.CLAUDE_CODE, new ClaudeCodeProvider());
  adapters.set(AIProvider.SAMBANOVA, new GenericKeyProvider(AIProvider.SAMBANOVA));
  adapters.set(AIProvider.GROQ, new GenericKeyProvider(AIProvider.GROQ));
  adapters.set(AIProvider.TOGETHER, new GenericKeyProvider(AIProvider.TOGETHER));
  adapters.set(AIProvider.FIREWORKS, new GenericKeyProvider(AIProvider.FIREWORKS));
}

/**
 * Get an adapter for a specific provider.
 */
export function getProviderAdapter(provider: AIProvider): ProviderAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) {
    throw new Error(`Provider adapter not found: ${provider}`);
  }
  return adapter;
}

/**
 * Get an adapter by name (string).
 */
export function getProviderAdapterByName(name: string): ProviderAdapter {
  const n = name.toLowerCase();
  if (n === "google" || n === "google_gemini") {
    return getProviderAdapter(AIProvider.GOOGLE_GEMINI);
  }
  if (n === "claude" || n === "claude_code" || n === "anthropic") {
    return getProviderAdapter(AIProvider.CLAUDE_CODE);
  }
  if (n === "sambanova") {
    return getProviderAdapter(AIProvider.SAMBANOVA);
  }
  if (n === "groq") {
    return getProviderAdapter(AIProvider.GROQ);
  }
  if (n === "together") {
    return getProviderAdapter(AIProvider.TOGETHER);
  }
  if (n === "fireworks") {
    return getProviderAdapter(AIProvider.FIREWORKS);
  }
  throw new Error(`Unknown provider: ${name}`);
}

// Auto-initialize default adapters
registerDefaultAdapters();
