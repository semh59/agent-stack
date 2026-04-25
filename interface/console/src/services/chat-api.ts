import { fetchJson } from "../utils/api";

export interface ChatMessage {
  role: "user" | "model" | "system";
  parts: { text: string }[];
}

export interface ChatUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  usage: ChatUsage;
}

export interface Conversation {
  id: string;
  title: string;
  mode: string;
  updatedAt: string;
}

/**
 * Send a chat message with optional streaming.
 */
export async function sendChatMessage(
  message: string,
  conversationId: string,
  model?: string,
  onChunk?: (chunk: string) => void
): Promise<ChatResponse> {
  if (onChunk) {
    // Note: fetchJson doesn't support streaming easily, use raw fetch for SSE
    const GATEWAY_BASE_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:51122";
    const token = localStorage.getItem("gateway_auth_token") ?? import.meta.env.VITE_GATEWAY_TOKEN;
    
    const response = await fetch(`${GATEWAY_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ message, conversationId, model, stream: true }),
    });

    if (!response.ok) throw new Error("Streaming request failed");
    
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No reader available");

    let fullText = "";
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const text = json.text || "";
            if (text) {
              fullText += text;
              onChunk(text);
            }
          } catch {
            // Ignore partial lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      text: fullText,
      model: model || "gemini-1.5-pro",
      usage: { prompt: 0, completion: 0, total: 0 }
    };
  }

  const res = await fetchJson<ChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId, model, stream: false }),
  });
  
  if (res.errors) throw new Error(res.errors[0].message);
  return res.data;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetchJson<Conversation[]>("/api/chat/conversations");
  if (res.errors) throw new Error(res.errors[0].message);
  return res.data;
}

export async function fetchChatHistory(id: string): Promise<ChatMessage[]> {
  const res = await fetchJson<{ role: "user" | "model" | "system"; content: string }[]>(`/api/chat/conversations/${id}`);
  if (res.errors) throw new Error(res.errors[0].message);
  const data = res.data as { role: "user" | "model" | "system"; content: string }[];
  return data.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }]
  }));
}

export async function createConversation(title: string, mode: string): Promise<{ id: string }> {
  const res = await fetchJson<{ id: string }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, mode }),
  });
  if (res.errors) throw new Error(res.errors[0].message);
  return res.data;
}
