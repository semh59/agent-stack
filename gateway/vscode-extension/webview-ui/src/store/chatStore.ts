import { create } from "zustand";
import type {
  ChatMessagePayload,
  ModelInfo,
  SkillInfo,
  ToolApprovalPayload,
  TokenUpdatePayload,
} from "@/lib/vscode";
import { uid } from "@/lib/utils";

export interface ChatMessage extends ChatMessagePayload {
  isStreaming?: boolean;
  isError?: boolean;
}

export interface AccountInfo {
  email: string;
  provider: "google" | "anthropic";
  expiresAt: number;
  isValid: boolean;
  status: "active" | "error" | "loading";
}

export type AppView = "chat" | "accounts" | "settings";

interface ChatState {
  // Navigation
  activeView: AppView;

  // Messages
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamingMessageId: string | null;

  // Session
  sessionId: string | null;
  selectedModel: string | null;
  availableModels: ModelInfo[];
  availableSkills: SkillInfo[];

  // Token tracking
  tokenUsage: { prompt: number; completion: number; total: number };
  tokenBudget: number | null;

  // Tool approvals (HITL)
  pendingApprovals: Map<string, ToolApprovalPayload>;

  // Connection
  isConnected: boolean;

  // Accounts
  accounts: AccountInfo[];
  isAddingAccount: boolean;
  accountError: string | null;

  // Workspace files (for @mention)
  workspaceFiles: string[];

  // Actions
  setActiveView: (view: AppView) => void;
  addMessage: (msg: ChatMessage) => void;
  updateStreaming: (chunk: string, done: boolean) => void;
  startStreaming: (sessionId: string) => void;
  stopStreaming: () => void;
  setSessionId: (id: string | null) => void;
  setSelectedModel: (modelId: string) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  setAvailableSkills: (skills: SkillInfo[]) => void;
  updateTokenUsage: (usage: TokenUpdatePayload) => void;
  addApproval: (approval: ToolApprovalPayload) => void;
  removeApproval: (approvalId: string) => void;
  setConnected: (connected: boolean) => void;
  clearMessages: () => void;
  setAccounts: (accounts: AccountInfo[]) => void;
  setAddingAccount: (adding: boolean) => void;
  setAccountError: (err: string | null) => void;
  setWorkspaceFiles: (files: string[]) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
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
  accountError: null,
  workspaceFiles: [],

  setActiveView: (view) => set({ activeView: view }),

  addMessage: (msg) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (
        last &&
        last.role === "system" &&
        msg.role === "system" &&
        last.content === msg.content
      ) {
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
    if (!state.streamingMessageId) return;

    const newContent = state.streamingContent + chunk;

    if (done) {
      set((state) => ({
        isStreaming: false,
        streamingContent: "",
        streamingMessageId: null,
        messages: state.messages.map((m) =>
          m.id === state.streamingMessageId
            ? { ...m, content: newContent, isStreaming: false }
            : m
        ),
      }));
    } else {
      set({
        streamingContent: newContent,
        messages: get().messages.map((m) =>
          m.id === state.streamingMessageId
            ? { ...m, content: newContent }
            : m
        ),
      });
    }
  },

  stopStreaming: () =>
    set((state) => ({
      isStreaming: false,
      streamingContent: "",
      streamingMessageId: null,
      messages: state.messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m
      ),
    })),

  setSessionId:       (id)      => set({ sessionId: id }),
  setSelectedModel:   (modelId) => set({ selectedModel: modelId }),
  setAvailableModels: (models)  => set({ availableModels: models }),
  setAvailableSkills: (skills)  => set({ availableSkills: skills }),

  updateTokenUsage: (usage) =>
    set({
      tokenUsage: {
        prompt:     usage.prompt,
        completion: usage.completion,
        total:      usage.total,
      },
      tokenBudget: usage.budget ?? null,
    }),

  addApproval: (approval) =>
    set((state) => {
      const next = new Map(state.pendingApprovals);
      next.set(approval.approvalId, approval);
      return { pendingApprovals: next };
    }),

  removeApproval: (approvalId) =>
    set((state) => {
      const next = new Map(state.pendingApprovals);
      next.delete(approvalId);
      return { pendingApprovals: next };
    }),

  setConnected: (connected) => set({ isConnected: connected }),

  clearMessages: () =>
    set({
      messages: [],
      isStreaming: false,
      streamingContent: "",
      streamingMessageId: null,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    }),

  setAccounts:      (accounts) => set({ accounts }),
  setAddingAccount: (adding)   => set({ isAddingAccount: adding }),
  setAccountError:  (err)      => set({ accountError: err }),
  setWorkspaceFiles:(files)    => set({ workspaceFiles: files }),
}));
