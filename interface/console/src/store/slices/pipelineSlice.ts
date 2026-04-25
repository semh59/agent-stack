import type { StateCreator } from "zustand";
import type { 
  AppState,
  PipelineProgress
} from "../types";
import { 
  gatewayFetch, 
  normalizePipelineStatus
} from "../helpers";

// VS Code API declaration
declare const vscode: any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PipelineSlice {
  pipelineStatus: PipelineProgress | null;
  fetchPipelineStatus: () => Promise<void>;
  startPipeline: (userTask: string, planMode?: string) => Promise<void>;
}

export const createPipelineSlice: StateCreator<
  AppState,
  [],
  [],
  PipelineSlice
> = (set, get) => ({
  pipelineStatus: null,

  fetchPipelineStatus: async () => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "getPipelineStatus" });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/pipelines/status", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Failed to fetch pipeline status (${res.status})`);
      const data = (await res.json()) as { data?: any };
      set({ pipelineStatus: normalizePipelineStatus(data.data), lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Pipeline durum hatasi: ${message}` });
    }
  },

  startPipeline: async (userTask: string, planMode?: string) => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "startPipeline", payload: { userTask, planMode } });
      set({ pipelineStatus: { status: "running" } });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        "/api/pipelines/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userTask, planMode }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Pipeline start failed (${res.status})`);
      set({ pipelineStatus: { status: "running" }, lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Pipeline baslatilamadi: ${message}` });
    }
  },
});
