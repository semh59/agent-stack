/**
 * Alloy provider connectivity tests.
 *
 * When a user hits "Test connection" in the console, we DON'T wire the full
 * LLM client stack â€” that's slow, noisy, and leaks credentials on errors.
 * Instead each provider has a lightweight probe that hits the cheapest
 * possible endpoint (usually a /models list) with a short timeout and
 * maps the result into a uniform `ProbeResult`.
 *
 * Every probe is:
 *   - synchronous from the caller's PoV (returns Promise<ProbeResult>)
 *   - non-throwing (errors become `{ ok: false, reason }`)
 *   - time-bounded via AbortController
 *   - side-effect free (no state mutation; no disk I/O)
 */
import type { Settings } from "./schema.js";

export interface ProbeResult {
  ok: boolean;
  /** Observed latency in ms. */
  latency_ms: number;
  /** Short operator-visible reason â€” e.g. "ok", "unauthorized", "timeout". */
  reason: string;
  /** Extra human-readable detail. Safe to show in the UI. */
  detail?: string;
  /** If the endpoint returned a model list, a count â€” helps users spot misconfig. */
  models_seen?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function okProbe(
  started: number,
  detail?: string,
  models_seen?: number,
): ProbeResult {
  return {
    ok: true,
    latency_ms: Date.now() - started,
    reason: "ok",
    ...(detail !== undefined ? { detail } : {}),
    ...(models_seen !== undefined ? { models_seen } : {}),
  };
}

function failProbe(
  started: number,
  reason: string,
  detail?: string,
): ProbeResult {
  return {
    ok: false,
    latency_ms: Date.now() - started,
    reason,
    ...(detail !== undefined ? { detail } : {}),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function classifyError(err: unknown): { reason: string; detail: string } {
  if (err instanceof Error) {
    if (err.name === "AbortError") return { reason: "timeout", detail: "request aborted" };
    if ("code" in err && (err as { code?: string }).code === "ECONNREFUSED") {
      return { reason: "unreachable", detail: "connection refused" };
    }
    if ("code" in err && (err as { code?: string }).code === "ENOTFOUND") {
      return { reason: "unreachable", detail: "dns resolution failed" };
    }
    return { reason: "error", detail: err.message };
  }
  return { reason: "error", detail: String(err) };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Per-provider probes
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function probeOllama(
  cfg: Settings["providers"]["ollama"],
): Promise<ProbeResult> {
  const started = Date.now();
  const base = cfg.base_url.replace(/\/$/, "");
  try {
    const res = await fetchWithTimeout(`${base}/api/tags`, {
      method: "GET",
      timeoutMs: cfg.timeout_s * 1000,
    });
    if (!res.ok) {
      return failProbe(started, `http_${res.status}`, await res.text().catch(() => ""));
    }
    const json = (await res.json()) as { models?: Array<unknown> };
    const count = Array.isArray(json.models) ? json.models.length : 0;
    return okProbe(started, `default model: ${cfg.default_model}`, count);
  } catch (err) {
    const { reason, detail } = classifyError(err);
    return failProbe(started, reason, detail);
  }
}

export async function probeOpenRouter(
  cfg: Settings["providers"]["openrouter"],
  apiKey: string | null,
): Promise<ProbeResult> {
  const started = Date.now();
  if (!apiKey) return failProbe(started, "missing_api_key", "api_key not set");

  try {
    const res = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(cfg.http_referer ? { "HTTP-Referer": cfg.http_referer } : {}),
      },
    });
    if (res.status === 401) return failProbe(started, "unauthorized", "api key rejected");
    if (!res.ok) return failProbe(started, `http_${res.status}`);
    const json = (await res.json()) as { data?: Array<unknown> };
    const count = Array.isArray(json.data) ? json.data.length : 0;
    return okProbe(started, `default model: ${cfg.default_model}`, count);
  } catch (err) {
    const { reason, detail } = classifyError(err);
    return failProbe(started, reason, detail);
  }
}

export async function probeAnthropic(
  cfg: Settings["providers"]["anthropic"],
  apiKey: string | null,
): Promise<ProbeResult> {
  const started = Date.now();
  if (!apiKey) return failProbe(started, "missing_api_key", "api_key not set");

  // Anthropic's lightweight probe: POST /v1/messages with max_tokens=1 is
  // the cheapest valid call. We try /v1/models first (newer API) and fall
  // back to the /v1/messages probe if models is unsupported.
  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (res.status === 401) return failProbe(started, "unauthorized", "api key rejected");
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<unknown> };
      const count = Array.isArray(json.data) ? json.data.length : 0;
      return okProbe(started, `default model: ${cfg.default_model}`, count);
    }
    return failProbe(started, `http_${res.status}`);
  } catch (err) {
    const { reason, detail } = classifyError(err);
    return failProbe(started, reason, detail);
  }
}

export async function probeOpenAI(
  cfg: Settings["providers"]["openai"],
  apiKey: string | null,
): Promise<ProbeResult> {
  const started = Date.now();
  if (!apiKey) return failProbe(started, "missing_api_key", "api_key not set");

  const base = cfg.base_url.replace(/\/$/, "");
  try {
    const res = await fetchWithTimeout(`${base}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(cfg.organization_id ? { "OpenAI-Organization": cfg.organization_id } : {}),
      },
    });
    if (res.status === 401) return failProbe(started, "unauthorized", "api key rejected");
    if (!res.ok) return failProbe(started, `http_${res.status}`);
    const json = (await res.json()) as { data?: Array<unknown> };
    const count = Array.isArray(json.data) ? json.data.length : 0;
    return okProbe(started, `default model: ${cfg.default_model}`, count);
  } catch (err) {
    const { reason, detail } = classifyError(err);
    return failProbe(started, reason, detail);
  }
}

export async function probeLMStudio(
  cfg: Settings["providers"]["lmstudio"],
): Promise<ProbeResult> {
  const started = Date.now();
  const base = cfg.base_url.replace(/\/$/, "");
  try {
    const res = await fetchWithTimeout(`${base}/models`, { method: "GET" });
    if (!res.ok) return failProbe(started, `http_${res.status}`);
    const json = (await res.json()) as { data?: Array<unknown> };
    const count = Array.isArray(json.data) ? json.data.length : 0;
    return okProbe(started, `default model: ${cfg.default_model}`, count);
  } catch (err) {
    const { reason, detail } = classifyError(err);
    return failProbe(started, reason, detail);
  }
}

export async function probeAzure(
  cfg: Settings["providers"]["azure"],
  apiKey: string | null,
): Promise<ProbeResult> {
  const started = Date.now();
  if (!cfg.endpoint) return failProbe(started, "missing_endpoint", "endpoint not set");
  if (!apiKey) return failProbe(started, "missing_api_key", "api_key not set");

  const base = cfg.endpoint.replace(/\/$/, "");
  try {
    // Azure OpenAI exposes deployments via /openai/deployments?api-version=â€¦
    const res = await fetchWithTimeout(
      `${base}/openai/deployments?api-version=${encodeURIComponent(cfg.api_version)}`,
      {
        method: "GET",
        headers: { "api-key": apiKey },
      },
    );
    if (res.status === 401 || res.status === 403) {
      return failProbe(started, "unauthorized", "api key rejected");
    }
    if (!res.ok) return failProbe(started, `http_${res.status}`);
    const json = (await res.json()) as { data?: Array<unknown> };
    const count = Array.isArray(json.data) ? json.data.length : 0;
    return okProbe(
      started,
      cfg.deployment ? `deployment: ${cfg.deployment}` : undefined,
      count,
    );
  } catch (err) {
    const { reason, detail } = classifyError(err);
    return failProbe(started, reason, detail);
  }
}

export async function probeGoogle(
  _cfg: Settings["providers"]["google"],
): Promise<ProbeResult> {
  // Google provider is OAuth-driven â€” there's no static api_key to test.
  // The canonical "am I connected?" check belongs in the accounts service.
  // Here we simply report "unverified" so the UI can route the user to the
  // accounts page instead of showing a false green checkmark.
  const started = Date.now();
  return failProbe(
    started,
    "oauth_required",
    "Google requires OAuth â€” connect an account under Accounts, not here.",
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Entry point â€” run one probe by name
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ProviderName =
  | "ollama"
  | "openrouter"
  | "anthropic"
  | "openai"
  | "google"
  | "lmstudio"
  | "azure";

export async function probeProvider(
  name: ProviderName,
  settings: Settings,
  secrets: {
    openrouter?: string | null;
    anthropic?: string | null;
    openai?: string | null;
    azure?: string | null;
  },
): Promise<ProbeResult> {
  switch (name) {
    case "ollama":
      return probeOllama(settings.providers.ollama);
    case "openrouter":
      return probeOpenRouter(settings.providers.openrouter, secrets.openrouter ?? null);
    case "anthropic":
      return probeAnthropic(settings.providers.anthropic, secrets.anthropic ?? null);
    case "openai":
      return probeOpenAI(settings.providers.openai, secrets.openai ?? null);
    case "lmstudio":
      return probeLMStudio(settings.providers.lmstudio);
    case "azure":
      return probeAzure(settings.providers.azure, secrets.azure ?? null);
    case "google":
      return probeGoogle(settings.providers.google);
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown provider: ${exhaustive as string}`);
    }
  }
}
