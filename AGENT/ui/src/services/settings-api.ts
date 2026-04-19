/**
 * Settings API client — talks to the gateway's `/api/settings/*` endpoints.
 *
 * The gateway always returns the redacted view of settings (secrets become
 * `{ set, updated_at }` placeholders). PATCH semantics: any key you omit
 * is left as-is on the server; to clear a secret, PATCH with an empty
 * string or `null`.
 */

// The full shape is defined server-side by Zod; on the client we type it
// loosely as an opaque object to avoid a source-level schema duplication.
// The UI only needs to read/write via field paths, which we handle with
// helpers in `settings-paths.ts`.
export type RedactedSettings = Record<string, unknown>;

export interface ApiEnvelope<T> {
  data: T | null;
  meta: Record<string, unknown>;
  errors: Array<{ code?: string; message: string; [k: string]: unknown }>;
}

export interface ProbeResult {
  ok: boolean;
  latency_ms: number;
  reason: string;
  detail?: string;
  models_seen?: number;
}

const BASE = "/api/settings";

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? (JSON.parse(text) as ApiEnvelope<T>) : { data: null, meta: {}, errors: [] };
  if (!res.ok || (body.errors && body.errors.length > 0)) {
    const message = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
    const err = new Error(message) as Error & { status: number; details?: unknown };
    err.status = res.status;
    err.details = body.errors;
    throw err;
  }
  return body.data as T;
}

export async function fetchSettings(): Promise<RedactedSettings> {
  const res = await fetch(BASE, { credentials: "include" });
  return parse<RedactedSettings>(res);
}

export async function patchSettings(
  patch: Record<string, unknown>,
): Promise<RedactedSettings> {
  const res = await fetch(BASE, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  return parse<RedactedSettings>(res);
}

export async function putSettings(
  full: Record<string, unknown>,
): Promise<RedactedSettings> {
  const res = await fetch(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(full),
  });
  return parse<RedactedSettings>(res);
}

export async function resetSettings(): Promise<RedactedSettings> {
  const res = await fetch(`${BASE}/reset`, {
    method: "POST",
    credentials: "include",
  });
  return parse<RedactedSettings>(res);
}

export async function testProvider(name: string): Promise<ProbeResult> {
  const res = await fetch(`${BASE}/test/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
  });
  return parse<ProbeResult>(res);
}

export async function fetchSettingsSchema(): Promise<{
  schema: unknown;
  secret_paths: string[];
}> {
  const res = await fetch(`${BASE}/schema`, { credentials: "include" });
  return parse<{ schema: unknown; secret_paths: string[] }>(res);
}
