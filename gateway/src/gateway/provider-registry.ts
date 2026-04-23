import { AIProvider, type ProviderAdapter } from "./provider-types";
import { GeminiProviderAdapter } from "./google-provider";
import { ClaudeCodeProvider } from "./claude-provider";

const adapters = new Map<AIProvider, ProviderAdapter>();

/**
 * Register all available provider adapters.
 */
export function registerDefaultAdapters() {
  adapters.set(AIProvider.GOOGLE_GEMINI, new GeminiProviderAdapter());
  adapters.set(AIProvider.CLAUDE_CODE, new ClaudeCodeProvider());
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
  if (name === "google" || name === "google_gemini") {
    return getProviderAdapter(AIProvider.GOOGLE_GEMINI);
  }
  if (name === "claude" || name === "claude_code" || name === "anthropic") {
    return getProviderAdapter(AIProvider.CLAUDE_CODE);
  }
  throw new Error(`Unknown provider: ${name}`);
}

// Auto-initialize default adapters
registerDefaultAdapters();
