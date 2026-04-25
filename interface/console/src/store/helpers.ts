import type {
  GoogleAccount,
  LogEntry,
  ModelEntry,
  AgentProgress,
  PipelineProgress,
  AutonomySessionSummary,
  AutonomyQueueItem,
  AutonomyTimelineItem,
  AutonomyGateStatus,
  AutonomyBudgetStatus,
  AutonomySessionArtifacts,
  AppState,
} from "./types";

export const GATEWAY_TOKEN_STORAGE_KEY = "gateway_auth_token";
export const MAX_LOG_BUFFER = 2000;
export const GATEWAY_BASE_URL = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_GATEWAY_URL ?? "";

const getWsUrl = (path = "") => {
  if (GATEWAY_BASE_URL) {
    return GATEWAY_BASE_URL.replace("http://", "ws://").replace("https://", "wss://") + path;
  }
  // In dev (relative paths), use current window host
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
};

export const GATEWAY_WS_LOGS_URL = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_GATEWAY_WS_LOGS_URL ?? getWsUrl("/ws/logs");
export const GATEWAY_WS_BASE_URL = getWsUrl("");

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function toLogType(value: unknown, fallback: LogEntry["type"]): LogEntry["type"] {
  if (
    value === "info" ||
    value === "success" ||
    value === "warning" ||
    value === "error" ||
    value === "agent" ||
    value === "tool"
  ) {
    return value;
  }
  return fallback;
}

export function normalizeOAuthUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Standardize on localhost for local dev OAuth flows
    if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function toOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export function normalizeCurrentAgent(payload: unknown): AgentProgress | undefined {
  if (!isRecord(payload)) return undefined;
  const status = payload.status;
  if (
    status !== "pending" &&
    status !== "running" &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "halted"
  ) {
    return undefined;
  }

  return {
    name: toString(payload.name),
    role: toString(payload.role),
    status,
  };
}

export function normalizePipelineStatus(payload: unknown): PipelineProgress | null {
  if (!isRecord(payload)) return null;

  const statePayload = isRecord(payload.state) ? payload.state : undefined;
  const statePipelineStatus = statePayload?.pipelineStatus;

  return {
    status: toString(payload.status, "unknown"),
    state: statePayload
      ? {
          userTask: toString(statePayload.userTask),
          startedAt: toString(statePayload.startedAt),
          completedAt:
            typeof statePayload.completedAt === "string" || statePayload.completedAt === null
              ? statePayload.completedAt
              : null,
          pipelineStatus:
            statePipelineStatus === "running" ||
            statePipelineStatus === "paused" ||
            statePipelineStatus === "completed" ||
            statePipelineStatus === "failed"
              ? statePipelineStatus
              : undefined,
          completedAgents: toOptionalStringArray(statePayload.completedAgents),
          filesCreated: toOptionalStringArray(statePayload.filesCreated),
        }
      : undefined,
    totalAgents: typeof payload.totalAgents === "number" ? payload.totalAgents : undefined,
    completedCount: typeof payload.completedCount === "number" ? payload.completedCount : undefined,
    currentAgent: normalizeCurrentAgent(payload.currentAgent),
    estimatedRemainingMinutes:
      typeof payload.estimatedRemainingMinutes === "number"
        ? payload.estimatedRemainingMinutes
        : undefined,
  };
}

export function readGatewayToken(): string | null {
  const env = (import.meta as unknown as { env: Record<string, string> }).env;
  if (typeof window === "undefined") return env?.VITE_GATEWAY_TOKEN ?? null;
  return sessionStorage.getItem(GATEWAY_TOKEN_STORAGE_KEY) ?? env?.VITE_GATEWAY_TOKEN ?? null;
}

export function persistGatewayToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    sessionStorage.setItem(GATEWAY_TOKEN_STORAGE_KEY, token);
    return;
  }
  sessionStorage.removeItem(GATEWAY_TOKEN_STORAGE_KEY);
}

export function buildApiUrl(path: string): string {
  return `${GATEWAY_BASE_URL}${path}`;
}

export function authHeaders(token: string, initHeaders?: HeadersInit): Headers {
  const headers = new Headers(initHeaders);
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export interface ParsedGatewayError {
  message: string;
  errorCode: string | null;
}

export async function parseGatewayError(response: Response): Promise<ParsedGatewayError> {
  const fallback = `Gateway request failed (${response.status})`;
  let message = fallback;
  let errorCode: string | null = null;

  try {
    const payload = (await response.clone().json()) as {
      errors?: Array<{ message?: unknown }>;
      meta?: Record<string, unknown>;
    };
    if (Array.isArray(payload.errors) && typeof payload.errors[0]?.message === "string") {
      message = payload.errors[0].message;
    }
    if (isRecord(payload.meta) && typeof payload.meta.errorCode === "string") {
      errorCode = payload.meta.errorCode;
    }
  } catch {
    try {
      const text = (await response.clone().text()).trim();
      if (text) {
        message = text;
      }
    } catch {
      // keep fallback message
    }
  }

  return { message, errorCode };
}

export function mapOAuthActionableError(parsed: ParsedGatewayError): string {
  if (parsed.errorCode === "OAUTH_CALLBACK_PORT_IN_USE") {
    return "OAuth callback port 51121 is busy. Portu tutan local auth surecini kapatip tekrar dene.";
  }
  return parsed.message;
}

export function normalizeAccounts(payload: unknown): GoogleAccount[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((item) => isRecord(item))
    .map((item) => ({
      email: toString(item.email),
      expiresAt: typeof item.expiresAt === "number" ? item.expiresAt : 0,
      isValid: Boolean(item.isValid),
      status: typeof item.status === "string" ? (item.status as GoogleAccount["status"]) : "active",
    }));
}

export function normalizeModels(payload: unknown): ModelEntry[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      id: toString(item.id),
      name: toString(item.name),
      provider: toString(item.provider, "Unknown"),
      status:
        item.status === "active" || item.status === "standby" || item.status === "error"
          ? item.status
          : "standby",
    }));
}

export function timelineItemFromEvent(
  eventType: string,
  payload: Record<string, unknown>,
  timestamp: string,
): AutonomyTimelineItem {
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const note =
    typeof payload.note === "string"
      ? payload.note
      : typeof payload.message === "string"
        ? payload.message
        : eventType;
  const message = taskId ? `${note} (${taskId})` : note;

  return {
    id: `${timestamp}-${eventType}-${Math.random().toString(16).slice(2, 8)}`,
    type: eventType,
    timestamp,
    message,
    payload,
  };
}

export function normalizeSessionSummary(
  sessionId: string,
  source: Record<string, unknown>,
  timestamp: string,
  current?: AutonomySessionSummary,
): AutonomySessionSummary {
  const state = toString(source.state, current?.state ?? "queued");
  const objective = toString(source.objective, current?.objective ?? "");
  const account = toString(source.account, current?.account ?? "");
  const createdAt = toString(source.createdAt, current?.createdAt ?? timestamp);
  const updatedAt = toString(source.updatedAt, timestamp);
  const queuePosition =
    typeof source.queuePosition === "number" ? source.queuePosition : current?.queuePosition ?? null;
  const branchName =
    typeof source.branchName === "string" || source.branchName === null
      ? (source.branchName as string | null)
      : current?.branchName ?? null;
  const baseBranch =
    typeof source.baseBranch === "string" || source.baseBranch === null
      ? (source.baseBranch as string | null)
      : current?.baseBranch ?? null;
  const commitHash =
    typeof source.commitHash === "string" || source.commitHash === null
      ? (source.commitHash as string | null)
      : current?.commitHash ?? null;
  const currentModel =
    typeof source.currentModel === "string" || source.currentModel === null
      ? (source.currentModel as string | null)
      : current?.currentModel ?? null;
  const currentGear =
    source.currentGear === "fast" ||
    source.currentGear === "standard" ||
    source.currentGear === "elite" ||
    source.currentGear === null
      ? (source.currentGear as AutonomySessionSummary["currentGear"])
      : current?.currentGear ?? null;
  const reviewStatus =
    source.reviewStatus === "none" ||
    source.reviewStatus === "plan_pending" ||
    source.reviewStatus === "approved" ||
    source.reviewStatus === "rejected"
      ? source.reviewStatus
      : current?.reviewStatus ?? "none";
  const reviewUpdatedAt =
    typeof source.reviewUpdatedAt === "string" || source.reviewUpdatedAt === null
      ? (source.reviewUpdatedAt as string | null)
      : current?.reviewUpdatedAt ?? null;

  return {
    id: sessionId,
    state,
    objective,
    account,
    createdAt,
    updatedAt,
    queuePosition,
    branchName,
    baseBranch,
    commitHash,
    currentModel,
    currentGear,
    reviewStatus,
    reviewUpdatedAt,
  };
}

export function normalizeAutonomyArtifacts(payload: unknown): AutonomySessionArtifacts | null {
  if (!isRecord(payload)) return null;

  return {
    plan: toString(payload.plan),
    changeSummary: toString(payload.changeSummary),
    nextActionReason: toString(payload.nextActionReason),
    gateResult: isRecord(payload.gateResult) ? normalizeGateStatus(payload.gateResult) : null,
    rawResponses: Array.isArray(payload.rawResponses)
      ? payload.rawResponses.filter((item): item is string => typeof item === "string")
      : [],
    contextPack: toString(payload.contextPack),
  };
}

export function normalizeQueue(payload: unknown): AutonomyQueueItem[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      if (!isRecord(item)) return null;
      const sessionId = toString(item.sessionId);
      if (!sessionId) return null;
      const queuePosition = typeof item.queuePosition === "number" ? item.queuePosition : 0;
      return {
        sessionId,
        state: toString(item.state, "queued"),
        objective: toString(item.objective),
        account: toString(item.account),
        createdAt: toString(item.createdAt, new Date().toISOString()),
        queuePosition,
      };
    })
    .filter((item): item is AutonomyQueueItem => item !== null)
    .sort((a, b) => a.queuePosition - b.queuePosition);
}

export function normalizeGateStatus(payload: Record<string, unknown>): AutonomyGateStatus {
  const blockingIssues = Array.isArray(payload.blockingIssues)
    ? payload.blockingIssues.filter((item): item is string => typeof item === "string")
    : [];
  const impactedScopes = Array.isArray(payload.impactedScopes)
    ? payload.impactedScopes.filter((item): item is string => typeof item === "string")
    : [];

  return {
    passed: Boolean(payload.passed),
    blockingIssues,
    impactedScopes,
    audit: isRecord(payload.audit)
      ? {
          critical: typeof payload.audit.critical === "number" ? payload.audit.critical : 0,
          high: typeof payload.audit.high === "number" ? payload.audit.high : 0,
          moderate: typeof payload.audit.moderate === "number" ? payload.audit.moderate : 0,
          low: typeof payload.audit.low === "number" ? payload.audit.low : 0,
          total: typeof payload.audit.total === "number" ? payload.audit.total : 0,
        }
      : undefined,
  };
}

export function normalizeBudgetStatus(payload: Record<string, unknown>): AutonomyBudgetStatus {
  const limits = isRecord(payload.limits) ? payload.limits : {};
  const usage = isRecord(payload.usage) ? payload.usage : {};

  return {
    limits: {
      maxCycles: typeof limits.maxCycles === "number" ? limits.maxCycles : 0,
      maxDurationMs: typeof limits.maxDurationMs === "number" ? limits.maxDurationMs : 0,
      maxInputTokens: typeof limits.maxInputTokens === "number" ? limits.maxInputTokens : 0,
      maxOutputTokens: typeof limits.maxOutputTokens === "number" ? limits.maxOutputTokens : 0,
      maxTPM: typeof limits.maxTPM === "number" ? limits.maxTPM : 0,
      maxRPD: typeof limits.maxRPD === "number" ? limits.maxRPD : 0,
      maxUsd: typeof limits.maxUsd === "number" ? limits.maxUsd : undefined,
    },
    usage: {
      cyclesUsed: typeof usage.cyclesUsed === "number" ? usage.cyclesUsed : 0,
      durationMsUsed: typeof usage.durationMsUsed === "number" ? usage.durationMsUsed : 0,
      inputTokensUsed: typeof usage.inputTokensUsed === "number" ? usage.inputTokensUsed : 0,
      outputTokensUsed: typeof usage.outputTokensUsed === "number" ? usage.outputTokensUsed : 0,
      currentTPM: typeof usage.currentTPM === "number" ? usage.currentTPM : 0,
      requestsUsed: typeof usage.requestsUsed === "number" ? usage.requestsUsed : 0,
      reservedTPM: typeof usage.reservedTPM === "number" ? usage.reservedTPM : 0,
      reservedRequests: typeof usage.reservedRequests === "number" ? usage.reservedRequests : 0,
      cachedInputTokensUsed:
        typeof usage.cachedInputTokensUsed === "number" ? usage.cachedInputTokensUsed : 0,
      usdUsed: typeof usage.usdUsed === "number" ? usage.usdUsed : 0,
    },
    warning: Boolean(payload.warning),
    warningReason: typeof payload.warningReason === "string" ? payload.warningReason : null,
    exceeded: Boolean(payload.exceeded),
    exceedReason: typeof payload.exceedReason === "string" ? payload.exceedReason : null,
  };
}

export async function gatewayFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const effectiveToken = token || readGatewayToken();
  if (!effectiveToken) {
    console.warn(`[GatewayFetch] Aborting request to ${path}: No auth token available.`);
    throw new Error("Gateway auth token missing");
  }
  return fetch(buildApiUrl(path), {
    ...init,
    headers: authHeaders(effectiveToken, init.headers),
  });
}

export function withSelectedSessionDerived(
  state: Partial<AppState>,
  selectedId: string | null,
): Pick<
  AppState,
  "activeSessionId" | "autonomySessionId" | "autonomySession" | "autonomyTimeline" | "gateStatus" | "budgetStatus" | "activeDiff"
> {
  const effectiveSelected = selectedId ?? state.activeSessionId ?? state.autonomySessionId ?? null;
  return {
    activeSessionId: effectiveSelected,
    autonomySessionId: effectiveSelected,
    autonomySession: effectiveSelected ? state.sessionsById?.[effectiveSelected] ?? null : null,
    autonomyTimeline: effectiveSelected ? state.timelineBySession?.[effectiveSelected] ?? [] : [],
    gateStatus: effectiveSelected ? state.gateBySession?.[effectiveSelected] ?? null : null,
    activeDiff: null,
  };
}
