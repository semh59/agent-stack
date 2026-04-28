/**
 * Projects API client — konuşur /api/projects/* ile Alloy gateway üzerinden.
 * SSE streaming ham fetch ile; geri kalan fetchJson ile.
 */

const BASE = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_GATEWAY_URL ?? "http://127.0.0.1:51122";

function token() {
  try { return localStorage.getItem("gateway_auth_token") ?? ""; } catch { return ""; }
}

function authHeaders(): Record<string, string> {
  const t = token();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status} ${r.statusText}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  stack: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
  size?: number;
}

export type BuildEvent =
  | { event: "status";  text: string }
  | { event: "chunk";   text: string }
  | { event: "done";    summary: string; files: { path: string; content: string }[] }
  | { event: "error";   text: string };

// ── API ───────────────────────────────────────────────────────────────────────

export const projectsApi = {
  list(): Promise<{ projects: ProjectMeta[] }> {
    return get("/api/projects");
  },

  create(description: string): Promise<{ project: ProjectMeta }> {
    return post("/api/projects", { description });
  },

  get(id: string): Promise<{ project: ProjectMeta }> {
    return get(`/api/projects/${id}`);
  },

  delete(id: string): Promise<void> {
    return del(`/api/projects/${id}`);
  },

  files(id: string): Promise<{ tree: FileNode[] }> {
    return get(`/api/projects/${id}/files`);
  },

  async fileContent(id: string, filePath: string): Promise<string> {
    const r = await fetch(`${BASE}/api/projects/${id}/files/${encodeURIComponent(filePath)}`, {
      headers: authHeaders(),
    });
    if (!r.ok) throw new Error(`Dosya bulunamadı: ${filePath}`);
    return r.text();
  },

  previewUrl(id: string): string {
    return `${BASE}/api/projects/${id}/preview`;
  },

  async sendMessage(
    id: string,
    message: string,
    onEvent: (evt: BuildEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const r = await fetch(`${BASE}/api/projects/${id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message }),
      signal,
    });

    if (!r.ok) throw new Error(`Build başarısız: ${r.status}`);
    if (!r.body) throw new Error("Yanıt gövdesi yok");

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as BuildEvent;
          onEvent(evt);
        } catch { /* malformed SSE satırı yoksay */ }
      }
    }
  },
};
