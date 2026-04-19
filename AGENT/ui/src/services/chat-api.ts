/**
 * Chat API — transport for the Sovereign chat surface.
 *
 * v1 ships with a local-only, in-memory conversation store (no gateway
 * endpoints) plus a streaming-optimize helper that calls /api/optimize.
 * Persistence arrives in a follow-up once we wire the gateway's chat
 * service. Keeping this boundary explicit makes that swap painless.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Unix ms */
  created_at: number;
  model?: string;
  tokens?: { input?: number; output?: number };
  cost_usd?: number;
  /** True while the assistant is still streaming. */
  pending?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  mode: string;
  messages: ChatMessage[];
  /** Unix ms */
  updated_at: number;
}

export interface OptimizeResult {
  optimized: string;
  savings_percent: number;
  cache_hit: boolean;
  layers: string[];
  model: string;
  tokens: { original: number; sent: number };
  metadata: Record<string, unknown>;
}

export async function optimizeMessage(
  message: string,
  contextMessages: string[] = [],
): Promise<OptimizeResult> {
  const res = await fetch("/api/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ message, context_messages: contextMessages }),
  });
  const body = (await res.json()) as { data: OptimizeResult | null; errors: Array<{ message: string }> };
  if (!res.ok || (body.errors && body.errors.length > 0)) {
    throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  }
  return body.data as OptimizeResult;
}
