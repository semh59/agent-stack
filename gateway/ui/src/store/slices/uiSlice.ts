import type { StateCreator } from "zustand";
import type { 
  AppState, 
  ModelEntry, 
  SkillEntry, 
  LogEntry,
  VSCodeAPI
} from "../types";
import { 
  gatewayFetch, 
  normalizeModels, 
  MAX_LOG_BUFFER 
} from "../helpers";

// VS Code API declaration
declare const vscode: VSCodeAPI | undefined;

export interface UISlice {
  bootState: "idle" | "loading" | "ready" | "error";
  dataState: "idle" | "loading" | "ready" | "error";
  models: ModelEntry[];
  skills: SkillEntry[];
  sidebarOpen: boolean;
  theme: "dark" | "light";
  stats: Record<string, unknown> | null;
  logs: LogEntry[];
  lastError: string | null;
  selectedModelId: string | null;
  selectedMode: "smart_multi" | "fast_only" | "pro_only";

  apiKeys: { tavily: string; exa: string };
  notifications: { pipelineCompleted: boolean; modelFallback: boolean };
  security: { dockerSandboxing: boolean };
  modelPreferences: {
    primaryModel: string;
    fastModel: string;
    temperature: number;
    contextWindow: string;
    fallbackModel: string;
    fallbackTriggers: { rateLimit: boolean; serverError: boolean; formatError: boolean };
  };

  toggleSidebar: () => void;
  toggleTheme: () => void;
  setApiKeys: (keys: Partial<AppState["apiKeys"]>) => void;
  setNotifications: (notifs: Partial<AppState["notifications"]>) => void;
  setSecurity: (sec: Partial<AppState["security"]>) => void;
  setModelPreferences: (prefs: Partial<AppState["modelPreferences"]>) => void;
  setLastError: (error: string | null) => void;
  runPostBootInitialization: () => Promise<void>;
  fetchModels: () => Promise<void>;
  fetchSkills: () => Promise<void>;
  fetchStats: () => Promise<void>;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  setSelectedModel: (modelId: string | null) => void;
  setSelectedMode: (mode: AppState["selectedMode"]) => void;
}

export const createUISlice: StateCreator<
  AppState,
  [],
  [],
  UISlice
> = (set, get) => ({
  bootState: "idle",
  dataState: "idle",
  models: [],
  skills: [],
  sidebarOpen: true,
  theme: "dark",
  stats: null,
  logs: [],
  lastError: null,
  selectedModelId: null,
  selectedMode: "smart_multi",

  apiKeys: { tavily: "", exa: "" },
  notifications: { pipelineCompleted: true, modelFallback: true },
  security: { dockerSandboxing: true },
  modelPreferences: {
    primaryModel: "",
    fastModel: "",
    temperature: 0.2,
    contextWindow: "128k",
    fallbackModel: "",
    fallbackTriggers: { rateLimit: true, serverError: true, formatError: false },
  },

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleTheme: () => set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
  setApiKeys: (keys) => set((state) => ({ apiKeys: { ...state.apiKeys, ...keys } })),
  setNotifications: (notifs) => set((state) => ({ notifications: { ...state.notifications, ...notifs } })),
  setSecurity: (sec) => set((state) => ({ security: { ...state.security, ...sec } })),
  setModelPreferences: (prefs) => set((state) => ({ modelPreferences: { ...state.modelPreferences, ...prefs } })),
  setLastError: (error: string | null) => set({ lastError: error }),
  
  setSelectedModel: (modelId: string | null) => set({ selectedModelId: modelId }),
  setSelectedMode: (mode: AppState["selectedMode"]) => set({ selectedMode: mode }),

  fetchModels: async () => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "getModels" });
      return;
    }
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/models", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`);
      const body = (await res.json()) as { data?: ModelEntry[] };
      set({ models: normalizeModels(body.data), lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Model yukleme hatasi: ${message}` });
    }
  },

  fetchSkills: async () => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "getSkills" });
      return;
    }
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/skills", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Failed to fetch skills (${res.status})`);
      const body = (await res.json()) as { data?: SkillEntry[] };
      set({ skills: Array.isArray(body.data) ? body.data : [], lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Yetenek yukleme hatasi: ${message}` });
    }
  },

  fetchStats: async () => {
    if (typeof vscode !== "undefined" && vscode) return;
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/stats", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Stats request failed (${res.status})`);
      const body = (await res.json()) as { data?: Record<string, unknown> };
      set({ stats: body.data ?? null, lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Stats yukleme hatasi: ${message}` });
    }
  },

  addLog: (log: LogEntry) =>
    set((state) => {
      const logs = state.logs.length >= MAX_LOG_BUFFER
        ? [...state.logs.slice(-(MAX_LOG_BUFFER - 1)), log]
        : [...state.logs, log];
      return { logs };
    }),

  clearLogs: () => set({ logs: [] }),

  runPostBootInitialization: async () => {
    const token = get().gatewayToken;
    if (!token) {
      set({
        bootState: "error",
        dataState: "error",
        lastError: "Gateway auth token missing. Mission Control cannot load data.",
      });
      return;
    }

    set({ bootState: "ready", dataState: "loading", lastError: null });

    try {
      const healthResponse = await gatewayFetch("/api/health", { method: "GET" }, token);
      if (!healthResponse.ok) {
        throw new Error(`Gateway health check failed: ${healthResponse.status}`);
      }

      await Promise.all([
        get().fetchAccounts(),
        get().fetchModels(),
        get().fetchSkills(),
        get().fetchPipelineStatus(),
        get().fetchAutonomySessions(),
        get().fetchAutonomyQueue(),
      ]);

      const selectedSessionId = get().activeSessionId ?? get().autonomySessionId;
      if (selectedSessionId) {
        get().subscribeAutonomyEvents(selectedSessionId);
      }

      set({ dataState: "ready", lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        dataState: "error",
        lastError: `Mission Control init failed: ${message}`,
      });
    }
  },
});
