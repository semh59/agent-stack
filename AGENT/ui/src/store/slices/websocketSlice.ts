import type { StateCreator } from "zustand";
import type { 
  AppState, 
  LogEntry,
  MissionSnapshotMeta,
  VSCodeAPI
} from "../types";
import { 
  GATEWAY_WS_LOGS_URL, 
  GATEWAY_WS_BASE_URL,
  MAX_LOG_BUFFER,
  isRecord,
  toString,
  toLogType,
  normalizePipelineStatus,
  normalizeAccounts,
  normalizeModels,
  normalizeQueue,
  normalizeSessionSummary,
  normalizeGateStatus,
  normalizeBudgetStatus,
  normalizeAutonomyArtifacts,
  timelineItemFromEvent,
  withSelectedSessionDerived,
  gatewayFetch
} from "../helpers";

// Module-level variables for singleton state
let messageListenerAttached = false;
let activeAutonomySocket: WebSocket | null = null;
let activeAutonomySocketId: string | null = null;
let activeAutonomySocketGeneration: string | null = null;
let lastInitializedGatewayToken: string | null = null;

// Throttling Buffer for high-frequency logs
let messageBuffer: unknown[] = [];
let isAnimationScheduled = false;

// HMR-safe global socket
declare global {
  interface Window {
    __sovereign_ws?: WebSocket;
  }
}

const AUTONOMY_CLIENT_ID_KEY = "sovereign_autonomy_client_id";
const AUTONOMY_GENERATION_KEY = "sovereign_autonomy_generation";

// VS Code API declaration
declare const vscode: VSCodeAPI | undefined;

export interface WebSocketSlice {
  wsTransportState: "healthy" | "recovering" | "fatal";
  wsFatalError: { code: string; message: string; sessionId?: string } | null;
  initializeWebSocket: () => void;
  handleMessageData: (data: unknown) => void;
  subscribeAutonomyEvents: (sessionId: string) => void;
  retryAutonomyTransport: () => void;
}

interface SnapshotPayload {
  queue?: unknown;
  timeline?: unknown;
  budgets?: Record<string, unknown>;
  touchedFiles?: unknown;
  selectedSession?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  snapshotMeta?: unknown;
}

function resetActiveAutonomySocket(): void {
  activeAutonomySocket = null;
  activeAutonomySocketId = null;
  activeAutonomySocketGeneration = null;
}

function normalizeSnapshotMeta(payload: unknown): MissionSnapshotMeta | null {
  if (!isRecord(payload) || payload.truncated !== true) return null;
  return {
    truncated: true,
    droppedFields: Array.isArray(payload.droppedFields)
      ? payload.droppedFields.filter((item): item is string => typeof item === "string")
      : [],
    timelineTailCount:
      typeof payload.timelineTailCount === "number" ? payload.timelineTailCount : undefined,
  };
}

function readStateBag(): Record<string, unknown> {
  if (typeof vscode !== "undefined" && vscode) {
    const current = vscode.getState();
    return isRecord(current) ? { ...current } : {};
  }
  return {};
}

function writeStateBag(next: Record<string, unknown>): void {
  if (typeof vscode !== "undefined" && vscode) {
    vscode.setState(next);
  }
}

function createRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function getStableAutonomyClientId(): string {
  if (typeof vscode !== "undefined" && vscode) {
    const state = readStateBag();
    const existing = typeof state[AUTONOMY_CLIENT_ID_KEY] === "string" ? state[AUTONOMY_CLIENT_ID_KEY] : "";
    if (existing) return existing;
    const created = createRandomId();
    writeStateBag({ ...state, [AUTONOMY_CLIENT_ID_KEY]: created });
    return created;
  }

  if (typeof sessionStorage !== "undefined") {
    const existing = sessionStorage.getItem(AUTONOMY_CLIENT_ID_KEY);
    if (existing) return existing;
    const created = createRandomId();
    sessionStorage.setItem(AUTONOMY_CLIENT_ID_KEY, created);
    return created;
  }

  return createRandomId();
}

function nextSocketGeneration(): { epochMs: number; seq: number } {
  const now = Date.now();
  if (typeof vscode !== "undefined" && vscode) {
    const state = readStateBag();
    const current = isRecord(state[AUTONOMY_GENERATION_KEY]) ? state[AUTONOMY_GENERATION_KEY] : {};
    const epochMs =
      typeof current.epochMs === "number" && current.epochMs >= now ? current.epochMs : now;
    const seq =
      epochMs === current.epochMs && typeof current.seq === "number" ? current.seq + 1 : 0;
    const next = { epochMs, seq };
    writeStateBag({ ...state, [AUTONOMY_GENERATION_KEY]: next });
    return next;
  }

  if (typeof sessionStorage !== "undefined") {
    try {
      const currentRaw = sessionStorage.getItem(AUTONOMY_GENERATION_KEY);
      const current = currentRaw ? JSON.parse(currentRaw) as Record<string, unknown> : {};
      const epochMs =
        typeof current.epochMs === "number" && current.epochMs >= now ? current.epochMs : now;
      const seq =
        epochMs === current.epochMs && typeof current.seq === "number" ? current.seq + 1 : 0;
      const next = { epochMs, seq };
      sessionStorage.setItem(AUTONOMY_GENERATION_KEY, JSON.stringify(next));
      return next;
    } catch {
      return { epochMs: now, seq: 0 };
    }
  }

  return { epochMs: now, seq: 0 };
}

function normalizeSnapshotTimeline(
  timeline: unknown,
): Array<ReturnType<typeof timelineItemFromEvent>> {
  if (!Array.isArray(timeline)) return [];

  return timeline
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item, index) => {
      const timestamp = toString(item.timestamp, new Date().toISOString());
      return {
        id: `${timestamp}-snapshot-${index}`,
        type: toString(item.state, "snapshot"),
        timestamp,
        message: typeof item.note === "string" ? item.note : toString(item.state, "snapshot"),
        payload: item,
      };
    });
}

function applySnapshotPayload(
  state: AppState,
  sessionId: string,
  payload: SnapshotPayload,
  timestamp: string,
): Partial<AppState> {
  const sessionsById = { ...state.sessionsById };
  const timelineBySession = { ...state.timelineBySession };
  const gateBySession = { ...state.gateBySession };
  const budgetBySession = { ...state.budgetBySession };
  const diffBySession = { ...state.diffBySession };
  const planArtifactsBySession = { ...state.planArtifactsBySession };
  const snapshotMetaBySession = { ...state.snapshotMetaBySession };
  const summarySource = isRecord(payload.selectedSession) ? payload.selectedSession : undefined;

  if (summarySource) {
    sessionsById[sessionId] = normalizeSessionSummary(
      sessionId,
      summarySource,
      timestamp,
      sessionsById[sessionId],
    );
  }

  if (Array.isArray(payload.timeline)) {
    timelineBySession[sessionId] = normalizeSnapshotTimeline(payload.timeline);
  }

  if (isRecord(payload.artifacts) && isRecord(payload.artifacts.gateResult)) {
    gateBySession[sessionId] = normalizeGateStatus(payload.artifacts.gateResult);
  }

  if (isRecord(payload.artifacts)) {
    planArtifactsBySession[sessionId] = normalizeAutonomyArtifacts(payload.artifacts);
  }

  if (isRecord(payload.budgets)) {
    budgetBySession[sessionId] = normalizeBudgetStatus(payload.budgets);
  }

  if (Array.isArray(payload.touchedFiles)) {
    diffBySession[sessionId] = payload.touchedFiles.filter(
      (item): item is string => typeof item === "string",
    );
  }

  snapshotMetaBySession[sessionId] = normalizeSnapshotMeta(payload.snapshotMeta);

  const queue = normalizeQueue(payload.queue);
  const sessionOrder = [sessionId, ...state.sessionOrder.filter((id) => id !== sessionId)];
  const selectedId = state.activeSessionId ?? state.autonomySessionId ?? sessionId;
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
      snapshotMetaBySession,
    },
    selectedId,
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
    snapshotMetaBySession,
    ...derived,
  };
}

function setFatalAutonomyTransport(
  set: (value: Partial<AppState>) => void,
  message: string,
  sessionId?: string,
  code = "WS_TRANSPORT_FATAL",
): void {
  resetActiveAutonomySocket();
  set({
    wsTransportState: "fatal",
    wsFatalError: { code, message, sessionId },
    lastError: message,
    dataState: "error",
  });
}

export const createWebSocketSlice: StateCreator<
  AppState,
  [],
  [],
  WebSocketSlice
> = (set, get) => ({
  wsTransportState: "healthy",
  wsFatalError: null,
  retryAutonomyTransport: () => {
    const sessionId = get().activeSessionId ?? get().autonomySessionId;
    set({
      wsTransportState: "recovering",
      wsFatalError: null,
      lastError: null,
      dataState: "loading",
    });
    if (sessionId) {
      get().subscribeAutonomyEvents(sessionId);
      return;
    }
    void get().runPostBootInitialization();
  },
  initializeWebSocket: () => {
    if (messageListenerAttached) return;
    messageListenerAttached = true;

    const processBuffer = () => {
      isAnimationScheduled = false;
      if (messageBuffer.length === 0) return;
      
      const batch = messageBuffer;
      messageBuffer = [];

      for (const msgData of batch) {
        get().handleMessageData(msgData);
      }
    };

    const enqueueBuffer = (payload: unknown) => {
      messageBuffer.push(payload);
      if (!isAnimationScheduled) {
        isAnimationScheduled = true;
        requestAnimationFrame(processBuffer);
      }
    };

    if (typeof vscode !== "undefined" && vscode) {
      set({ bootState: "loading", dataState: "idle", lastError: null });
      window.addEventListener("message", (event) => {
        if (!event.data) return;
        enqueueBuffer(event.data);
      });
      return;
    }

    const initialToken = get().gatewayToken;
    if (!initialToken) {
      set({
        bootState: "error",
        dataState: "error",
        lastError: "Gateway auth token missing for Mission Control bootstrap.",
      });
      return;
    }

    set({ bootState: "ready", dataState: "idle", lastError: null });
    if (initialToken !== lastInitializedGatewayToken) {
      lastInitializedGatewayToken = initialToken;
      void get().runPostBootInitialization();
    }

    const connectWS = () => {
      const token = get().gatewayToken;
      if (!token) return;

      if (window.__sovereign_ws) {
        window.__sovereign_ws.close();
      }

      const ws = new WebSocket(`${GATEWAY_WS_LOGS_URL}?token=${encodeURIComponent(token)}`);
      window.__sovereign_ws = ws;

      ws.onmessage = (event) => {
        try {
           if (window.__sovereign_ws !== ws) return;
           const payload = JSON.parse(event.data) as unknown;
           enqueueBuffer(payload);
        } catch (err) {
          console.error("Failed to parse websocket payload:", err);
        }
      };

      ws.onclose = () => {
         if (window.__sovereign_ws === ws) {
            window.__sovereign_ws = undefined;
            setTimeout(connectWS, 3000);
         }
      };
    };

    connectWS();

    setInterval(() => {
      if (!get().gatewayToken) return;
      get().fetchAutonomySessions().catch(console.error);
      get().fetchAutonomyQueue().catch(console.error);
    }, 5000);
  },

  handleMessageData: (data: unknown) => {
    if (!isRecord(data) || typeof data.type !== "string") return;
    
    const type = data.type;

    switch (type) {
      case "authToken":
        handleAuthToken(data, get);
        break;
      case "log":
        handleLog(data, get);
        break;

      case "pipeline_status":
        set({ pipelineStatus: normalizePipelineStatus(data.status), lastError: null });
        break;

      case "accounts":
        if (isRecord(data.payload)) {
          set({ accounts: normalizeAccounts(data.payload), lastError: null });
        }
        break;

      case "models":
        if (isRecord(data.payload)) {
          set({ models: normalizeModels(data.payload), lastError: null });
        }
        break;

      case "agentStart":
      case "agent_start":
        handleAgentEvent(data, set, "running");
        break;

      case "agentComplete":
      case "agent_complete":
        handleAgentEvent(data, set, "completed");
        break;

      case "queueEvent":
        if (isRecord(data.payload)) {
          handleQueueEvent(data.payload, set);
        }
        break;

      case "budgetEvent":
        handleAutonomyEvent(
          {
            ...data,
            type: "autonomyEvent",
            eventType: "budget",
          },
          set,
        );
        break;

      case "gateEvent":
        handleAutonomyEvent(
          {
            ...data,
            type: "autonomyEvent",
            eventType: "gate_result",
          },
          set,
        );
        break;

      case "modelSwitchEvent":
        handleAutonomyEvent(
          {
            ...data,
            type: "autonomyEvent",
            eventType: "model_switch",
          },
          set,
        );
        break;

      case "analytics":
        if (isRecord(data.payload)) {
          handleAnalyticsEvent(data.payload, set);
        }
        break;

      case "autonomyEvent":
        handleAutonomyEvent(data, set);
        break;

      case "snapshot_error":
        setFatalAutonomyTransport(
          set,
          toString(isRecord(data.payload) ? data.payload.message : undefined, "Mission snapshot is corrupted or incomplete."),
          toString(data.sessionId) || undefined,
          "SNAPSHOT_ERROR",
        );
        break;

      case "error":
        set({ lastError: toString(data.value, "Unknown error") });
        break;

      default:
        console.debug(`[WebSocket] Unhandled message type: ${type}`);
    }
  },

  subscribeAutonomyEvents: (sessionId: string) => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "subscribeAutonomyEvents", payload: { sessionId } });
      return;
    }

    set((state: AppState) => withSelectedSessionDerived(state, sessionId));

    const token = get().gatewayToken;
    if (!token) {
      set({ lastError: "Gateway auth token missing for autonomy websocket" });
      return;
    }

    if (activeAutonomySocket) {
      activeAutonomySocket.close();
      resetActiveAutonomySocket();
    }

    const connect = async () => {
      try {
        const clientId = getStableAutonomyClientId();
        const generation = nextSocketGeneration();
        const generationKey = `${generation.epochMs}:${generation.seq}`;
        set({
          wsTransportState: "recovering",
          wsFatalError: null,
          lastError: null,
        });
        const ticketResponse = await gatewayFetch(
          `/api/missions/${encodeURIComponent(sessionId)}/ws-ticket`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId, generation }),
          },
          token,
        );
        if (!ticketResponse.ok) {
          throw new Error(`Failed to get WS ticket (${ticketResponse.status})`);
        }
        const ticketBody = (await ticketResponse.json()) as { data?: { ticket?: string } };
        const ticket = ticketBody.data?.ticket;
        if (!ticket) {
          throw new Error("WS ticket missing from response");
        }

        const ws = new WebSocket(
          `${GATEWAY_WS_BASE_URL}/ws/mission/${encodeURIComponent(sessionId)}?ticket=${encodeURIComponent(ticket)}`,
        );
        activeAutonomySocket = ws;
        activeAutonomySocketId = sessionId;
        activeAutonomySocketGeneration = generationKey;

        ws.onopen = () => {
          if (activeAutonomySocket !== ws || activeAutonomySocketGeneration !== generationKey) {
            return;
          }
          set({
            wsTransportState: "healthy",
            wsFatalError: null,
            dataState: "ready",
            lastError: null,
          });
        };

        ws.onmessage = (event) => {
          try {
            if (activeAutonomySocket !== ws || activeAutonomySocketGeneration !== generationKey) {
              return;
            }
            const payload = JSON.parse(event.data) as unknown;
            get().handleMessageData(payload);
          } catch {
            setFatalAutonomyTransport(
              set,
              "Mission snapshot bozuk veya eksik geldi. Otomatik reconnect durduruldu.",
              sessionId,
              "AUTONOMY_WS_PARSE_ERROR",
            );
          }
        };

        ws.onclose = () => {
          const shouldReconnect =
            activeAutonomySocket === ws &&
            activeAutonomySocketId === sessionId &&
            activeAutonomySocketGeneration === generationKey &&
            get().wsTransportState !== "fatal";
          if (activeAutonomySocket === ws) {
            resetActiveAutonomySocket();
          }
          if (!shouldReconnect) return;
          set({ wsTransportState: "recovering" });
          setTimeout(() => {
            const selectedId = get().activeSessionId ?? get().autonomySessionId;
            if (selectedId === sessionId && get().wsTransportState !== "fatal") {
              get().subscribeAutonomyEvents(sessionId);
            }
          }, 3000);
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          lastError: `Autonomy WS baglanti hatasi: ${message}`,
          wsTransportState: "recovering",
        });
      }
    };

    void connect();
  },
});

/**
 * Specialized Message Handlers to keep createWebSocketSlice clean
 */

function handleAuthToken(message: Record<string, unknown>, get: () => AppState) {
  const token = toString(message.token, "").trim();
  const normalizedToken = token || null;
  if (!normalizedToken) {
    lastInitializedGatewayToken = null;
  }
  get().setGatewayToken(normalizedToken);
}

function handleLog(message: Record<string, unknown>, get: () => AppState) {
  const fallbackType: LogEntry["type"] =
    message.level === "success" ? "success" :
    message.level === "error" ? "error" :
    message.level === "warning" ? "warning" : "info";
    
  const logPayload = isRecord(message.log) ? message.log : undefined;
  const logEntry: LogEntry = logPayload
    ? {
        id: typeof logPayload.id === "number" ? logPayload.id : Date.now(),
        time: typeof logPayload.time === "string" ? logPayload.time : new Date().toISOString(),
        source: typeof logPayload.source === "string" ? logPayload.source : "system",
        text: typeof logPayload.text === "string" ? logPayload.text : "",
        type: toLogType(logPayload.type, fallbackType),
      }
    : {
        id: Date.now(),
        time: new Date().toISOString(),
        source: "system",
        text: toString(message.content),
        type: fallbackType,
      };
  get().addLog(logEntry);
}

function handleAgentEvent(message: Record<string, unknown>, set: (fn: (state: AppState) => Partial<AppState>) => void, status: "running" | "completed") {
  const agentName = toString(message.agent);
  set((state: AppState) => {
    const currentStatus = state.pipelineStatus;
    if (!currentStatus && status === "completed") return state;

    const completedCount = status === "completed" 
      ? (currentStatus?.completedCount ?? 0) + 1 
      : (currentStatus?.completedCount ?? 0);

    return {
      pipelineStatus: {
        ...(currentStatus ?? { status: "running" }),
        status: status === "running" ? "running" : (currentStatus?.status ?? "running"),
        completedCount,
        currentAgent: {
          name: agentName,
          role: agentName,
          status,
        },
      },
    };
  });
}

function handleQueueEvent(payload: Record<string, unknown>, set: (fn: (state: AppState) => Partial<AppState>) => void) {
  const queue = normalizeQueue(payload.queue);
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
    const derived = withSelectedSessionDerived({ ...state, sessionsById, sessionOrder, queue }, selectedId);

    return { sessionsById, sessionOrder, queue, ...derived };
  });
}

function handleAutonomyEvent(message: Record<string, unknown>, set: (fn: (state: AppState) => Partial<AppState>) => void) {
  const sessionId = toString(message.sessionId);
  if (!sessionId) return;
  const eventType = toString(message.eventType, "unknown");
  const payload = isRecord(message.payload) ? message.payload : {};
  const timestamp = toString(message.timestamp, new Date().toISOString());

  set((state: AppState) => {
    if (eventType === "snapshot") {
      return applySnapshotPayload(state, sessionId, payload, timestamp);
    }

    const sessionsById = { ...state.sessionsById };
    const timelineBySession = { ...state.timelineBySession };
    const gateBySession = { ...state.gateBySession };
    const budgetBySession = { ...state.budgetBySession };
    const diffBySession = { ...state.diffBySession };
    const planArtifactsBySession = { ...state.planArtifactsBySession };
    const queue = state.queue;

    const summarySource = isRecord(payload.selectedSession) ? payload.selectedSession : payload;
    sessionsById[sessionId] = normalizeSessionSummary(sessionId, summarySource, timestamp, sessionsById[sessionId]);

    if ((eventType === "state" || eventType === "step") && typeof payload.state === "string") {
      sessionsById[sessionId].state = payload.state;
    }
    if (["done", "failed", "stopped", "interrupted"].includes(eventType)) {
      sessionsById[sessionId].state = eventType === "interrupted" ? "stopped" : eventType;
    }
    if (eventType === "diff_ready" && Array.isArray(payload.files)) {
      diffBySession[sessionId] = payload.files.filter((item): item is string => typeof item === "string");
    }
    if (eventType === "artifact" && typeof payload.type === "string") {
      const currentArtifacts = planArtifactsBySession[sessionId] ?? {
        plan: "",
        changeSummary: "",
        nextActionReason: "",
        gateResult: gateBySession[sessionId] ?? null,
        rawResponses: [],
        contextPack: "",
      };

      if (payload.type === "plan" && typeof payload.value === "string") {
        planArtifactsBySession[sessionId] = { ...currentArtifacts, plan: payload.value };
      } else if (payload.type === "changeSummary" && typeof payload.value === "string") {
        planArtifactsBySession[sessionId] = { ...currentArtifacts, changeSummary: payload.value };
      } else if (payload.type === "context_pack" && typeof payload.value === "string") {
        planArtifactsBySession[sessionId] = { ...currentArtifacts, contextPack: payload.value };
      }
    }
    if (eventType === "gate_result" || eventType === "gate_bypass") {
      const gateStatus = normalizeGateStatus(payload);
      gateBySession[sessionId] = gateStatus;
      const currentArtifacts = planArtifactsBySession[sessionId] ?? {
        plan: "",
        changeSummary: "",
        nextActionReason: "",
        gateResult: null,
        rawResponses: [],
        contextPack: "",
      };
      planArtifactsBySession[sessionId] = { ...currentArtifacts, gateResult: gateStatus };
      
      // Cross-slice Sync: If gate failed, pause running pipelines (Phase 1.1 Sync)
      if (!gateStatus.passed) {
        set((state: AppState) => ({
          pipelineStatus: state.pipelineStatus 
            ? { ...state.pipelineStatus, status: "paused" } 
            : null
        }));
      }
    }
    if (eventType === "budget") {
      const budgetStatus = normalizeBudgetStatus(payload);
      budgetBySession[sessionId] = budgetStatus;
      
      // Update analytics with velocity if provided
      if (typeof payload.tokenVelocity === "number") {
        set((state: AppState) => ({
          analyticsBySession: {
            ...state.analyticsBySession,
            [sessionId]: {
              ...(state.analyticsBySession?.[sessionId] || {}),
              tokenVelocity: payload.tokenVelocity,
              efficiencyScore: payload.efficiencyScore || 0
            }
          }
        }));
      }

      // Cross-slice Sync: Circuit Breaker for Budget
      if (budgetStatus.exceeded) {
        set((state: AppState) => ({
          pipelineStatus: state.pipelineStatus 
            ? { ...state.pipelineStatus, status: "paused" } 
            : null
        }));
      }
    }
    if (eventType === "decision_log") {
      // Specialized handling for decision tree nodes
      const decisionNode = {
        id: toString(payload.id, Math.random().toString()),
        type: "decision",
        timestamp,
        payload: maskPII(payload)
      };
      timelineBySession[sessionId] = [...(timelineBySession[sessionId] ?? []), decisionNode as any]; // eslint-disable-line @typescript-eslint/no-explicit-any
    } else {
      const timelineItem = timelineItemFromEvent(eventType, maskPII(payload) as Record<string, unknown>, timestamp);
      timelineBySession[sessionId] = [...(timelineBySession[sessionId] ?? []), timelineItem].slice(-MAX_LOG_BUFFER);
    }

    const sessionOrder = [sessionId, ...state.sessionOrder.filter((id) => id !== sessionId)];
    const selectedId = state.activeSessionId ?? state.autonomySessionId ?? sessionId;
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
      },
      selectedId
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
    };
  });
}

function handleAnalyticsEvent(message: Record<string, unknown>, set: (fn: (state: AppState) => Partial<AppState>) => void) {
  const sessionId = toString(message.sessionId);
  if (!sessionId || !isRecord(message.payload)) return;

  set((state: AppState) => ({
    analyticsBySession: {
      ...state.analyticsBySession,
      [sessionId]: {
        ...(state.analyticsBySession?.[sessionId] || {}),
        ...(message.payload as Record<string, unknown>)
      }
    }
  }));
}

export function maskPII<T>(data: T): T {
  if (!data) return data;
  try {
    const json = JSON.stringify(data);
    const masked = json
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_MASKED]")
      .replace(/\b([1-9][0-9]{10})\b/g, "[TCKN_MASKED]") // TCKN precise 11 digits
      .replace(/\b(0?5[0-9]{9})\b/g, "[PHONE_MASKED]")   // TR Mobile (05xx or 5xx)
      .replace(/\+([0-9]{10,14})\b/g, "[PHONE_MASKED]"); // International (+ followed by 10-14 digits)
    return JSON.parse(masked);
  } catch {
    return data;
  }
}

// Test-only hook for resetting module-level websocket state between cases.
export function __resetWebSocketSliceForTests(): void {
  messageListenerAttached = false;
  resetActiveAutonomySocket();
  lastInitializedGatewayToken = null;
}
