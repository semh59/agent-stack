/**
 * Alloy chat slice — conversation list + active session + streaming state.
 *
 * This is local-only today: messages live in memory (and persist via
 * Zustand's persist wrapper if someone opts-in). A follow-up will point
 * `createConversation` and `appendMessage` at a real `/api/conversations`
 * endpoint once the gateway chat service lands. The rest of the slice is
 * shaped to make that a non-event.
 */
import type { StateCreator } from "zustand";
import type { ChatMessage, Conversation } from "../../../services/chat-api";
import { optimizeMessage } from "../../../services/chat-api";

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function firstLineTitle(input: string): string {
  const line = input.split("\n")[0]?.trim() ?? "";
  if (line.length === 0) return "New chat";
  return line.length > 48 ? `${line.slice(0, 45)}…` : line;
}

export interface AlloyChatSlice {
  conversations: Record<string, Conversation>;
  conversationOrder: string[]; // most-recent first
  activeConversationId: string | null;
  sendingMessage: boolean;
  sendError: string | null;
  /** Aggregate session cost in USD — updated on every assistant turn. */
  sessionCostUsd: number;
  sessionTokens: { input: number; output: number };

  // actions
  newConversation: (mode?: string) => string;
  selectConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  sendMessage: (input: string, opts?: { model?: string }) => Promise<void>;
  renameConversation: (id: string, title: string) => void;
  clearSessionCost: () => void;
}

export const createAlloyChatSlice: StateCreator<
  AlloyChatSlice,
  [],
  [],
  AlloyChatSlice
> = (set, get) => ({
  conversations: {},
  conversationOrder: [],
  activeConversationId: null,
  sendingMessage: false,
  sendError: null,
  sessionCostUsd: 0,
  sessionTokens: { input: 0, output: 0 },

  newConversation(mode = "code") {
    const id = newId("conv");
    const now = Date.now();
    set((s) => ({
      conversations: {
        ...s.conversations,
        [id]: {
          id,
          title: "New chat",
          mode,
          messages: [],
          updated_at: now,
        },
      },
      conversationOrder: [id, ...s.conversationOrder],
      activeConversationId: id,
    }));
    return id;
  },

  selectConversation(id) {
    set({ activeConversationId: id });
  },

  deleteConversation(id) {
    set((s) => {
      const nextConvs = { ...s.conversations };
      delete nextConvs[id];
      const nextOrder = s.conversationOrder.filter((c) => c !== id);
      return {
        conversations: nextConvs,
        conversationOrder: nextOrder,
        activeConversationId: s.activeConversationId === id ? nextOrder[0] ?? null : s.activeConversationId,
      };
    });
  },

  renameConversation(id, title) {
    set((s) => {
      const existing = s.conversations[id];
      if (!existing) return s;
      return {
        conversations: { ...s.conversations, [id]: { ...existing, title } },
      };
    });
  },

  async sendMessage(input, opts) {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Ensure we have an active conversation.
    let id = get().activeConversationId;
    if (!id) id = get().newConversation();

    const convo = get().conversations[id];
    if (!convo) return;

    const userMsg: ChatMessage = {
      id: newId("msg"),
      role: "user",
      content: trimmed,
      created_at: Date.now(),
    };

    const assistantId = newId("msg");
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      created_at: Date.now(),
      model: opts?.model,
      pending: true,
    };

    const isFirstTurn = convo.messages.length === 0;

    set((s) => ({
      sendingMessage: true,
      sendError: null,
      conversations: {
        ...s.conversations,
        [id!]: {
          ...convo,
          title: isFirstTurn ? firstLineTitle(trimmed) : convo.title,
          messages: [...convo.messages, userMsg, assistantPlaceholder],
          updated_at: Date.now(),
        },
      },
      conversationOrder: [id!, ...s.conversationOrder.filter((c) => c !== id)],
    }));

    try {
      const context = convo.messages
        .filter((m) => m.role !== "system")
        .slice(-10)
        .map((m) => m.content);

      const res = await optimizeMessage(trimmed, context);

      // The bridge returns an optimized prompt — we surface savings info as
      // the assistant reply until the LLM client step is wired in.
      const savingsLabel =
        res.cache_hit
          ? "cache hit"
          : `${Math.round((res.savings_percent ?? 0) * 100) / 100}% saved`;
      const reply =
        `**Optimized prompt** (${savingsLabel}, layers: ${res.layers.join(" → ") || "none"})\n\n` +
        "```\n" +
        res.optimized +
        "\n```";

      set((s) => {
        const c = s.conversations[id!];
        if (!c) return s;
        const msgs = c.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: reply,
                pending: false,
                model: res.model,
                tokens: {
                  input: res.tokens?.original,
                  output: res.tokens?.sent,
                },
              }
            : m,
        );
        return {
          sendingMessage: false,
          conversations: { ...s.conversations, [id!]: { ...c, messages: msgs, updated_at: Date.now() } },
          sessionTokens: {
            input: s.sessionTokens.input + (res.tokens?.original ?? 0),
            output: s.sessionTokens.output + (res.tokens?.sent ?? 0),
          },
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => {
        const c = s.conversations[id!];
        if (!c) return { sendingMessage: false, sendError: message };
        const msgs = c.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `_Error:_ ${message}`,
                pending: false,
              }
            : m,
        );
        return {
          sendingMessage: false,
          sendError: message,
          conversations: { ...s.conversations, [id!]: { ...c, messages: msgs } },
        };
      });
    }
  },

  clearSessionCost() {
    set({ sessionCostUsd: 0, sessionTokens: { input: 0, output: 0 } });
  },
});
