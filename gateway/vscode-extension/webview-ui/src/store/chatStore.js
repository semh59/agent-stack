/* ═══════════════════════════════════════════════════════════════════
   Chat Store — Zustand state management for chat + accounts
   ═══════════════════════════════════════════════════════════════════ */
import { create } from "zustand";
import { uid } from "@/lib/utils";
export const useChatStore = create((set, get) => ({
    activeView: "chat",
    messages: [],
    isStreaming: false,
    streamingContent: "",
    streamingMessageId: null,
    sessionId: null,
    selectedModel: null,
    availableModels: [],
    availableSkills: [],
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    tokenBudget: null,
    pendingApprovals: new Map(),
    isConnected: false,
    accounts: [],
    isAddingAccount: false,
    setActiveView: (view) => set({ activeView: view }),
    addMessage: (msg) => set((state) => {
        // Deduplicate: skip if last message is identical system/error content
        const last = state.messages[state.messages.length - 1];
        if (last &&
            last.role === "system" &&
            msg.role === "system" &&
            last.content === msg.content) {
            return state;
        }
        return { messages: [...state.messages, msg] };
    }),
    startStreaming: (sessionId) => {
        const messageId = uid();
        set((state) => ({
            isStreaming: true,
            streamingContent: "",
            streamingMessageId: messageId,
            sessionId,
            messages: [
                ...state.messages,
                {
                    id: messageId,
                    sessionId,
                    role: "assistant",
                    content: "",
                    timestamp: new Date().toISOString(),
                    isStreaming: true,
                },
            ],
        }));
    },
    updateStreaming: (chunk, done) => {
        const state = get();
        if (!state.streamingMessageId)
            return;
        const newContent = state.streamingContent + chunk;
        if (done) {
            set((state) => ({
                isStreaming: false,
                streamingContent: "",
                streamingMessageId: null,
                messages: state.messages.map((m) => m.id === state.streamingMessageId
                    ? { ...m, content: newContent, isStreaming: false }
                    : m),
            }));
        }
        else {
            set({
                streamingContent: newContent,
                messages: get().messages.map((m) => m.id === state.streamingMessageId
                    ? { ...m, content: newContent }
                    : m),
            });
        }
    },
    stopStreaming: () => set((state) => ({
        isStreaming: false,
        streamingContent: "",
        streamingMessageId: null,
        messages: state.messages.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m),
    })),
    setSessionId: (id) => set({ sessionId: id }),
    setSelectedModel: (modelId) => set({ selectedModel: modelId }),
    setAvailableModels: (models) => set({ availableModels: models }),
    setAvailableSkills: (skills) => set({ availableSkills: skills }),
    updateTokenUsage: (usage) => set({
        tokenUsage: {
            prompt: usage.prompt,
            completion: usage.completion,
            total: usage.total,
        },
        tokenBudget: usage.budget ?? null,
    }),
    addApproval: (approval) => set((state) => {
        const next = new Map(state.pendingApprovals);
        next.set(approval.approvalId, approval);
        return { pendingApprovals: next };
    }),
    removeApproval: (approvalId) => set((state) => {
        const next = new Map(state.pendingApprovals);
        next.delete(approvalId);
        return { pendingApprovals: next };
    }),
    setConnected: (connected) => set({ isConnected: connected }),
    clearMessages: () => set({
        messages: [],
        isStreaming: false,
        streamingContent: "",
        streamingMessageId: null,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
    }),
    setAccounts: (accounts) => set({ accounts }),
    setAddingAccount: (adding) => set({ isAddingAccount: adding }),
}));
