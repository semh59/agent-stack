export interface LegacyApiEnvelope<T> {
  data: T;
  meta: Record<string, unknown>;
  errors: null | Array<{ message: string }>;
}

const GATEWAY_BASE_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:51122";
const GATEWAY_WS_LOGS_URL =
  import.meta.env.VITE_GATEWAY_WS_LOGS_URL ??
  import.meta.env.VITE_GATEWAY_WS_URL ??
  "ws://127.0.0.1:51122/ws/logs";
const TOKEN_STORAGE_KEY = "gateway_auth_token";

function readToken(): string | null {
  if (typeof window === "undefined") return import.meta.env.VITE_GATEWAY_TOKEN ?? null;
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? import.meta.env.VITE_GATEWAY_TOKEN ?? null;
}

function authHeaders(token: string, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<LegacyApiEnvelope<T>> {
  const token = readToken();
  if (!token) {
    return {
      data: null as T,
      meta: { timestamp: new Date().toISOString() },
      errors: [{ message: "Gateway auth token missing" }],
    };
  }

  const response = await fetch(`${GATEWAY_BASE_URL}${path}`, {
    ...init,
    headers: authHeaders(token, init.headers),
  });

  if (!response.ok) {
    return {
      data: null as T,
      meta: { status: response.status, timestamp: new Date().toISOString() },
      errors: [{ message: `Request failed (${response.status})` }],
    };
  }

  return (await response.json()) as LegacyApiEnvelope<T>;
}

export const getAccounts = async (): Promise<LegacyApiEnvelope<unknown[]>> => fetchJson<unknown[]>("/api/accounts");

export const getActiveAccount = async (): Promise<LegacyApiEnvelope<unknown>> => fetchJson<unknown>("/api/accounts/active");

export const setActiveAccount = async (email: string): Promise<LegacyApiEnvelope<unknown>> =>
  fetchJson<unknown>("/api/accounts/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

export const getPipelineStatus = async (): Promise<LegacyApiEnvelope<unknown>> => fetchJson<unknown>("/api/pipelines/status");

export const startPipeline = async (userTask: string, planMode?: string): Promise<LegacyApiEnvelope<unknown>> =>
  fetchJson<unknown>("/api/pipelines/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userTask, planMode }),
  });

export const stopPipeline = async (): Promise<LegacyApiEnvelope<unknown>> =>
  fetchJson<unknown>("/api/pipelines/stop", { method: "POST" });

export const connectLogsWS = (onMessage: (data: unknown) => void): { close: () => void } => {
  const token = readToken();
  if (!token) {
    return { close: () => {} };
  }

  const ws = new WebSocket(`${GATEWAY_WS_LOGS_URL}?token=${encodeURIComponent(token)}`);
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data) as unknown);
    } catch {
      // ignore malformed payloads in compatibility layer
    }
  };

  return {
    close: () => {
      ws.close();
    },
  };
};
