import type { StateCreator } from "zustand";
import type { AlloyState } from "../../alloyStore";
import { 
  createConversation, 
  fetchChatHistory, 
  fetchConversations, 
  sendChatMessage,
} from "../../../services/chat-api";

export interface ChatMessage {
  id: string;
  role: "user" | "model" | "system";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface PendingIntervention {
  id: string;
  toolName: string;
  filePath?: string;
  command?: string;
  proposedContent?: string;
  actualContent?: string;
  reason?: string;
  confidence: number;
}

export interface Conversation {
  id: string;
  title: string;
  mode: string;
  updatedAt: string;
}

export interface AlloyChatSlice {
  messages: ChatMessage[];
  conversations: Conversation[];
  activeConversationId: string | null;
  isGenerating: boolean;
  error: string | null;
  
  autonomyLevel: "manual" | "balanced" | "autonomous";
  pendingInterventions: PendingIntervention[];
  
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  startNewChat: (title?: string) => Promise<void>;
  sendMessage: (content: string, model?: string) => Promise<void>;
  setAutonomyLevel: (level: "manual" | "balanced" | "autonomous") => void;
  approveIntervention: (id: string, updatedContent?: string) => Promise<void>;
  rejectIntervention: (id: string) => Promise<void>;
  clearHistory: () => void;
}

export const createAlloyChatSlice: StateCreator<
  AlloyState,
  [],
  [],
  AlloyChatSlice
> = (set, get) => ({
  messages: [],
  conversations: [],
  activeConversationId: null,
  isGenerating: false,
  error: null,
  autonomyLevel: "balanced",
  pendingInterventions: [],

  loadConversations: async () => {
    try {
      const conversations = await fetchConversations();
      set({ conversations });
    } catch {
      set({ error: "Sohbetler yüklenemedi" });
    }
  },

  selectConversation: async (id: string) => {
    try {
      const history = await fetchChatHistory(id);
      const messages: ChatMessage[] = history.map((m, i) => ({
        id: `${id}_${i}_${Date.now()}`,
        role: m.role,
        content: m.parts[0].text,
        timestamp: new Date().toISOString(),
      }));
      set({ activeConversationId: id, messages, error: null });
    } catch {
      set({ error: "Geçmiş yüklenemedi" });
    }
  },

  startNewChat: async (title: string = "Yeni Sohbet") => {
    try {
      const { id } = await createConversation(title, "code");
      await get().loadConversations();
      await get().selectConversation(id);
    } catch {
      set({ error: "Yeni sohbet başlatılamadı" });
    }
  },

  sendMessage: async (content: string, model: string = "gemini-1.5-pro") => {
    let convId = get().activeConversationId;

    if (!convId) {
      try {
        const { id } = await createConversation(content.slice(0, 30) + "...", "code");
        convId = id;
        await get().loadConversations();
      } catch {
        set({ error: "Sohbet başlatılamadı" });
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    const assistantMsg: ChatMessage = {
      id: `a_${Date.now()}`,
      role: "model",
      content: "",
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };

    set((state) => ({
      messages: [...state.messages, userMsg, assistantMsg],
      isGenerating: true,
      error: null,
      activeConversationId: convId
    }));

    try {
      await sendChatMessage(content, convId!, model, (chunk: string) => {
        set((state: AlloyState) => {
          const newMsgs = [...state.messages];
          const idx = newMsgs.findIndex((m: ChatMessage) => m.id === assistantMsg.id);
          if (idx !== -1) {
            newMsgs[idx] = { ...newMsgs[idx], content: newMsgs[idx].content + chunk };
          }
          return { messages: newMsgs };
        });
      });

      set((state) => ({
        isGenerating: false,
        messages: state.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
        ),
      }));
    } catch (err: any) {
      set({
        isGenerating: false,
        error: err.message || "Gönderim hatalı",
      });
    }
  },

  setAutonomyLevel: (level) => set({ autonomyLevel: level }),

  approveIntervention: async (id, updatedContent) => {
    // In a real app, this would hit /api/autonomy/approve
    console.log(`Approving intervention ${id} with content:`, updatedContent);
    set((state) => ({
      pendingInterventions: state.pendingInterventions.filter((pi) => pi.id !== id),
    }));
  },

  rejectIntervention: async (id) => {
    // In a real app, this would hit /api/autonomy/reject
    set((state) => ({
      pendingInterventions: state.pendingInterventions.filter((pi) => pi.id !== id),
    }));
  },

  clearHistory: () => set({ messages: [], activeConversationId: null, pendingInterventions: [] }),
});
