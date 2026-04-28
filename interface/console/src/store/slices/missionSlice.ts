import type {
  AppState,
  AutonomySessionSummary,
  AutonomyQueueItem,
  AutonomyTimelineItem,
  AutonomyGateStatus,
  AutonomyBudgetStatus,
  AutonomySessionArtifacts,
  StartAutonomySessionInput,
  VSCodeAPI
} from "../types";
import {
  gatewayFetch,
  normalizeSessionSummary,
  normalizeAutonomyArtifacts,
  normalizeBudgetStatus,
  normalizeQueue,
  withSelectedSessionDerived
} from "../helpers";
import type { StateCreator } from "zustand";

// VS Code API declaration
declare const vscode: VSCodeAPI | undefined;

export interface MissionSlice {
  autonomySession: AutonomySessionSummary | null;
  autonomySessionId: string | null;
  autonomyTimeline: AutonomyTimelineItem[];
  activeDiff: string[];
  gateStatus: AutonomyGateStatus | null;
  budgetStatus: AutonomyBudgetStatus | null;
  sessionsById: Record<string, AutonomySessionSummary>;
  sessionOrder: string[];
  activeSessionId: string | null;
  queue: AutonomyQueueItem[];
  timelineBySession: Record<string, AutonomyTimelineItem[]>;
  gateBySession: Record<string, AutonomyGateStatus | null>;
  budgetBySession: Record<string, AutonomyBudgetStatus | null>;
  diffBySession: Record<string, string[]>;
  planArtifactsBySession: Record<string, AutonomySessionArtifacts | null>;
  snapshotMetaBySession: Record<string, AppState["snapshotMetaBySession"][string]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analyticsBySession: Record<string, any>;

  startAutonomySession: (input: StartAutonomySessionInput) => Promise<void>;
  fetchAutonomySessions: () => Promise<void>;
  fetchAutonomyQueue: () => Promise<void>;
  selectAutonomySession: (sessionId: string) => void;
  fetchAutonomySessionDetail: (sessionId: string) => Promise<void>;
  fetchAutonomyArtifacts: (sessionId: string) => Promise<void>;
  approveAutonomyPlan: (sessionId: string) => Promise<void>;
  rejectAutonomyPlan: (sessionId: string, reason?: string) => Promise<void>;
  cancelAutonomySession: (sessionId: string, reason?: string) => Promise<void>;
  promoteAutonomySession: (sessionId: string) => Promise<void>;
  stopAutonomySession: (reason?: string) => Promise<void>;
  pauseAutonomySession: (reason?: string) => Promise<void>;
  resumeAutonomySession: (reason?: string) => Promise<void>;
  lastError: string | null;
}

export const createMissionSlice: StateCreator<
  AppState,
  [],
  [],
  MissionSlice
> = (set, get) => ({
  lastError: null,
  autonomySession: null,
  autonomySessionId: null,
  autonomyTimeline: [],
  activeDiff: [],
  gateStatus: null,
  budgetStatus: null,
  sessionsById: {},
  sessionOrder: [],
  activeSessionId: null,
  queue: [],
  timelineBySession: {},
  gateBySession: {},
  budgetBySession: {},
  diffBySession: {},
  planArtifactsBySession: {},
  snapshotMetaBySession: {},
  analyticsBySession: {},

  startAutonomySession: async (input: StartAutonomySessionInput) => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({
        type: "startAutonomy",
        payload: {
          ...input,
          budgets: input.budget,
          budget: undefined,
          startMode: input.startMode ?? "queued",
        },
      });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");

      const res = await gatewayFetch(
        "/api/autonomy/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            budgets: input.budget,
            budget: undefined,
            startMode: input.startMode ?? "queued",
          }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy session start failed (${res.status})`);

      const body = (await res.json()) as { data?: { id?: string; createdAt?: string } };
      const sessionId = body.data?.id;
      if (!sessionId) throw new Error("Autonomy session id missing from response");

      set((state: AppState) => {
        const timestamp = body.data?.createdAt ?? new Date().toISOString();
        const sessionsById = { ...state.sessionsById };
        sessionsById[sessionId] = normalizeSessionSummary(
          sessionId,
          body.data as unknown as Record<string, unknown>,
          timestamp,
          state.sessionsById[sessionId],
        );

        const sessionOrder = [sessionId, ...state.sessionOrder.filter((id: string) => id !== sessionId)];
        const timelineBySession = {
          ...state.timelineBySession,
          [sessionId]: state.timelineBySession[sessionId] ?? [],
        };
        const gateBySession = {
          ...state.gateBySession,
          [sessionId]: state.gateBySession[sessionId] ?? null,
        };
        const budgetBySession = {
          ...state.budgetBySession,
          [sessionId]: state.budgetBySession[sessionId] ?? null,
        };
        const diffBySession = {
          ...state.diffBySession,
          [sessionId]: state.diffBySession[sessionId] ?? [],
        };
        const planArtifactsBySession = {
          ...state.planArtifactsBySession,
          [sessionId]: state.planArtifactsBySession[sessionId] ?? null,
        };
        const queue = state.queue.some((item: AutonomyQueueItem) => item.sessionId === sessionId)
          ? state.queue
          : [
              ...state.queue,
              {
                sessionId,
                state: sessionsById[sessionId]!.state,
                objective: sessionsById[sessionId]!.objective,
                account: sessionsById[sessionId]!.account,
                createdAt: sessionsById[sessionId]!.createdAt,
                queuePosition:
                  typeof sessionsById[sessionId]!.queuePosition === "number"
                    ? sessionsById[sessionId]!.queuePosition
                    : state.queue.length + 1,
              },
            ];

        const derived = withSelectedSessionDerived(
          {
            ...state,
            sessionsById,
            sessionOrder,
            queue,
            timelineBySession,
            gateBySession,
            budgetBySession,
            diffBySession,
            planArtifactsBySession,
          } as AppState,
          sessionId,
        );

        return {
          sessionsById,
          sessionOrder,
          queue,
          timelineBySession,
          gateBySession,
          budgetBySession,
          diffBySession,
          planArtifactsBySession,
          ...derived,
          lastError: null,
        };
      });

      get().subscribeAutonomyEvents(sessionId);
      await get().fetchAutonomyQueue();
      await get().fetchAutonomySessions();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Otonom oturum baslatilamadi: ${message}` });
    }
  },

  fetchAutonomySessions: async () => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/autonomy/sessions", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Autonomy sessions request failed (${res.status})`);
      const body = (await res.json()) as { data?: Array<Record<string, unknown> & { id: string; updatedAt?: string }> };
      const payload = Array.isArray(body.data) ? body.data : [];
      set((state: AppState) => {
        const sessionsById = { ...state.sessionsById };
        const sessionOrder: string[] = [];
        for (const raw of payload) {
          const sessionId = raw.id;
          if (!sessionId) continue;
          sessionsById[sessionId] = normalizeSessionSummary(
            sessionId,
            raw,
            raw.updatedAt ?? new Date().toISOString(),
            sessionsById[sessionId],
          );
          sessionOrder.push(sessionId);
        }
        const mergedOrder = [...sessionOrder, ...state.sessionOrder.filter((id: string) => !sessionOrder.includes(id))];
        const selectedId = state.activeSessionId ?? state.autonomySessionId ?? mergedOrder[0] ?? null;
        const derived = withSelectedSessionDerived(
          {
            ...state,
            sessionsById,
            sessionOrder: mergedOrder,
          } as AppState,
          selectedId,
        );
        return {
          sessionsById,
          sessionOrder: mergedOrder,
          ...derived,
          lastError: null,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Autonomy session listesi alinamadi: ${message}` });
    }
  },

  fetchAutonomyQueue: async () => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/autonomy/queue", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Autonomy queue request failed (${res.status})`);
      const body = (await res.json()) as { data?: unknown };
      const queue = normalizeQueue(body.data);
      set((state: AppState) => {
        const sessionsById = { ...state.sessionsById };
        for (const item of queue) {
          sessionsById[item.sessionId] = normalizeSessionSummary(
            item.sessionId,
            {
              state: item.state,
              objective: item.objective,
              account: item.account,
              createdAt: item.createdAt,
              queuePosition: item.queuePosition,
            },
            item.createdAt,
            sessionsById[item.sessionId],
          );
        }
        const sessionOrder = [...new Set([...queue.map((item) => item.sessionId), ...state.sessionOrder])];
        const selectedId = state.activeSessionId ?? state.autonomySessionId ?? queue[0]?.sessionId ?? null;
        const derived = withSelectedSessionDerived(
          {
            ...state,
            sessionsById,
            sessionOrder,
            queue,
          } as AppState,
          selectedId,
        );
        return {
          sessionsById,
          sessionOrder,
          queue,
          ...derived,
          lastError: null,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Autonomy queue alinamadi: ${message}` });
    }
  },

  selectAutonomySession: (sessionId: string) => {
    set((state: AppState) => {
      const derived = withSelectedSessionDerived(state as AppState, sessionId);
      return derived;
    });
    get().subscribeAutonomyEvents(sessionId);
  },

  fetchAutonomySessionDetail: async (sessionId: string) => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}`,
        { method: "GET" },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy session detail request failed (${res.status})`);

      const body = (await res.json()) as { data?: Record<string, unknown> };
      const payload = body.data;
      if (!payload) throw new Error("Autonomy session detail missing");

      set((state: AppState) => {
        const sessionsById = { ...state.sessionsById };
        const timelineBySession = { ...state.timelineBySession };
        const gateBySession = { ...state.gateBySession };
        const budgetBySession = { ...state.budgetBySession };
        const diffBySession = { ...state.diffBySession };
        const planArtifactsBySession = { ...state.planArtifactsBySession };

        sessionsById[sessionId] = normalizeSessionSummary(
          sessionId,
          payload,
          typeof payload.updatedAt === "string" ? payload.updatedAt : new Date().toISOString(),
          sessionsById[sessionId],
        );

        if (Array.isArray(payload.timeline)) {
          timelineBySession[sessionId] = payload.timeline
            .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
            .map((item, index) => ({
              id: `${sessionId}-detail-${index}`,
              type: typeof item.state === "string" ? item.state : "snapshot",
              timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
              message:
                typeof item.note === "string"
                  ? item.note
                  : typeof item.state === "string"
                    ? item.state
                    : "snapshot",
              payload: item,
            }));
        }

        if (payload.budgets && typeof payload.budgets === "object") {
          budgetBySession[sessionId] = normalizeBudgetStatus(payload.budgets as Record<string, unknown>);
        }

        if (Array.isArray(payload.touchedFiles)) {
          diffBySession[sessionId] = payload.touchedFiles.filter((item): item is string => typeof item === "string");
        }

        if (payload.artifacts && typeof payload.artifacts === "object") {
          const artifacts = normalizeAutonomyArtifacts(payload.artifacts);
          if (artifacts) {
            planArtifactsBySession[sessionId] = artifacts;
            gateBySession[sessionId] = artifacts.gateResult;
          }
        }

        const sessionOrder = [sessionId, ...state.sessionOrder.filter((id: string) => id !== sessionId)];
        const selectedId = state.activeSessionId ?? state.autonomySessionId ?? sessionId;
        const derived = withSelectedSessionDerived(
          {
            ...state,
            sessionsById,
            sessionOrder,
            timelineBySession,
            gateBySession,
            budgetBySession,
            diffBySession,
            planArtifactsBySession,
          } as AppState,
          selectedId,
        );

        return {
          sessionsById,
          sessionOrder,
          timelineBySession,
          gateBySession,
          budgetBySession,
          diffBySession,
          planArtifactsBySession,
          ...derived,
          lastError: null,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Autonomy session detayi alinamadi: ${message}` });
    }
  },

  fetchAutonomyArtifacts: async (sessionId: string) => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/artifacts`,
        { method: "GET" },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy artifacts request failed (${res.status})`);

      const body = (await res.json()) as { data?: unknown };
      const artifacts = normalizeAutonomyArtifacts(body.data);
      if (!artifacts) throw new Error("Autonomy artifacts payload missing");

      set((state: AppState) => {
        const planArtifactsBySession = {
          ...state.planArtifactsBySession,
          [sessionId]: artifacts,
        };
        const gateBySession = {
          ...state.gateBySession,
          [sessionId]: artifacts.gateResult,
        };
        const derived = withSelectedSessionDerived(
          {
            ...state,
            planArtifactsBySession,
            gateBySession,
          } as AppState,
          state.activeSessionId ?? state.autonomySessionId ?? sessionId,
        );

        return {
          planArtifactsBySession,
          gateBySession,
          ...derived,
          lastError: null,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Autonomy artifacts alinamadi: ${message}` });
    }
  },

  approveAutonomyPlan: async (sessionId: string) => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Plan approved from review screen" }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy approve failed (${res.status})`);

      get().selectAutonomySession(sessionId);
      await get().fetchAutonomySessionDetail(sessionId);
      await get().fetchAutonomyArtifacts(sessionId);
      await get().fetchAutonomySessions();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Plan onayi gonderilemedi: ${message}` });
      throw err;
    }
  },

  rejectAutonomyPlan: async (sessionId: string, reason = "Plan rejected from review screen") => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy reject failed (${res.status})`);

      await get().fetchAutonomySessionDetail(sessionId);
      await get().fetchAutonomyArtifacts(sessionId);
      await get().fetchAutonomyQueue();
      await get().fetchAutonomySessions();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Plan reddedilemedi: ${message}` });
      throw err;
    }
  },

  cancelAutonomySession: async (sessionId: string, reason?: string) => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy cancel failed (${res.status})`);
      await get().fetchAutonomyQueue();
      await get().fetchAutonomySessions();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Otonom oturum iptal edilemedi: ${message}` });
    }
  },

  promoteAutonomySession: async (sessionId: string) => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/promote`,
        {
          method: "POST",
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy promote failed (${res.status})`);
      await get().fetchAutonomyQueue();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Otonom oturum one alinamadi: ${message}` });
    }
  },

  stopAutonomySession: async (reason?: string) => {
    const sessionId = get().activeSessionId ?? get().autonomySessionId;
    if (!sessionId) return;

    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "stopAutonomy", payload: { sessionId, reason } });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/stop`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy stop failed (${res.status})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Otonom oturum durdurulamadi: ${message}` });
    }
  },

  pauseAutonomySession: async (reason?: string) => {
    const sessionId = get().activeSessionId ?? get().autonomySessionId;
    if (!sessionId) return;

    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "pauseAutonomy", payload: { sessionId, reason } });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy pause failed (${res.status})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Otonom oturum duraklatilamadi: ${message}` });
    }
  },

  resumeAutonomySession: async (reason?: string) => {
    const sessionId = get().activeSessionId ?? get().autonomySessionId;
    if (!sessionId) return;

    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "resumeAutonomy", payload: { sessionId, reason } });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Autonomy resume failed (${res.status})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Otonom oturum devam ettirilemedi: ${message}` });
    }
  },
});
