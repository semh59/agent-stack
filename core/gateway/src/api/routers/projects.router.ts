/**
 * Projects Router — Alloy Builder backend
 *
 * Each project lives in <projectRoot>/alloy-projects/<id>/
 * Project metadata is stored in <projectRoot>/alloy-projects/index.json
 *
 * Routes:
 *   GET    /api/projects
 *   POST   /api/projects
 *   GET    /api/projects/:id
 *   DELETE /api/projects/:id
 *   GET    /api/projects/:id/files
 *   GET    /api/projects/:id/files/:path
 *   GET    /api/projects/:id/preview
 *   POST   /api/projects/:id/message     (SSE)
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { apiError } from "../../gateway/rest-response";
import type { TokenStore } from "../../gateway/token-store";
import type { AccountManager } from "../../plugin/accounts";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  stack: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ProjectsRouterDeps {
  projectRoot: string;
  tokenStore: TokenStore;
  getAccountManager: () => AccountManager | null;
}

interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileNode[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function projectsDir(root: string): string {
  return path.join(root, "alloy-projects");
}

function indexPath(root: string): string {
  return path.join(projectsDir(root), "index.json");
}

function projectDir(root: string, id: string): string {
  return path.join(projectsDir(root), id);
}

async function ensureProjectsDir(root: string): Promise<void> {
  await fs.mkdir(projectsDir(root), { recursive: true });
}

async function readIndex(root: string): Promise<ProjectMeta[]> {
  try {
    const raw = await fs.readFile(indexPath(root), "utf-8");
    return JSON.parse(raw) as ProjectMeta[];
  } catch {
    return [];
  }
}

async function writeIndex(root: string, projects: ProjectMeta[]): Promise<void> {
  await ensureProjectsDir(root);
  await fs.writeFile(indexPath(root), JSON.stringify(projects, null, 2), "utf-8");
}

async function buildFileTree(dir: string, base = ""): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = await buildFileTree(path.join(dir, entry.name), rel);
      nodes.push({ name: entry.name, path: rel, type: "dir", children });
    } else {
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      nodes.push({ name: entry.name, path: rel, type: "file", size: stat?.size });
    }
  }
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Guess the primary stack from the project directory. */
async function detectStack(dir: string): Promise<string> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf-8")) as {
        dependencies?: Record<string, string>;
      };
      if (pkg.dependencies?.react) return "react";
      if (pkg.dependencies?.vue) return "vue";
      return "node";
    } catch { /* ignore */ }
  }
  return "html";
}

/** Derive a short project name from the description. */
function nameFromDescription(description: string): string {
  return description
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ")
    .slice(0, 60) || "Yeni Proje";
}

/** Initial boilerplate for a new HTML project. */
const INITIAL_HTML = (name: string, description: string) => `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a; color: #e2e8f0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 2rem;
    }
    .card {
      background: #1e293b; border-radius: 1rem;
      padding: 2rem; max-width: 480px; width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      border: 1px solid #334155;
    }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: .5rem; color: #f8fafc; }
    p { color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${name}</h1>
    <p>${description}</p>
  </div>
</body>
</html>
`;

// ── Router registration ────────────────────────────────────────────────────────

export function registerProjectsRoutes(
  app: FastifyInstance,
  deps: ProjectsRouterDeps,
): void {
  const { projectRoot, tokenStore, getAccountManager } = deps;

  // GET /api/projects
  app.get("/api/projects", async (_req, _reply) => {
    const projects = await readIndex(projectRoot);
    return { projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  });

  // POST /api/projects
  app.post<{ Body: { description?: string } }>(
    "/api/projects",
    async (request, reply) => {
      const description = (request.body?.description ?? "").trim();
      if (!description) {
        return reply.status(400).send(apiError("description is required", { code: "BAD_REQUEST" }));
      }

      const id = randomUUID();
      const name = nameFromDescription(description);
      const now = new Date().toISOString();
      const dir = projectDir(projectRoot, id);

      await fs.mkdir(dir, { recursive: true });

      // Write initial index.html
      await fs.writeFile(path.join(dir, "index.html"), INITIAL_HTML(name, description), "utf-8");

      const meta: ProjectMeta = { id, name, description, stack: "html", createdAt: now, updatedAt: now, messageCount: 0 };
      const projects = await readIndex(projectRoot);
      projects.push(meta);
      await writeIndex(projectRoot, projects);

      return { project: meta };
    },
  );

  // GET /api/projects/:id
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (request, reply) => {
      const projects = await readIndex(projectRoot);
      const project = projects.find((p) => p.id === request.params.id);
      if (!project) return reply.status(404).send(apiError("Project not found", { code: "NOT_FOUND" }));
      return { project };
    },
  );

  // DELETE /api/projects/:id
  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (request, reply) => {
      const projects = await readIndex(projectRoot);
      const idx = projects.findIndex((p) => p.id === request.params.id);
      if (idx === -1) return reply.status(404).send(apiError("Project not found", { code: "NOT_FOUND" }));

      const [removed] = projects.splice(idx, 1);
      await writeIndex(projectRoot, projects);

      // Remove project directory
      const dir = projectDir(projectRoot, removed.id);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

      return { ok: true };
    },
  );

  // GET /api/projects/:id/files
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/files",
    async (request, reply) => {
      const dir = projectDir(projectRoot, request.params.id);
      if (!fsSync.existsSync(dir)) {
        return reply.status(404).send(apiError("Project not found", { code: "NOT_FOUND" }));
      }
      const tree = await buildFileTree(dir);
      return { tree };
    },
  );

  // GET /api/projects/:id/files/:filepath
  app.get<{ Params: { id: string; "*": string } }>(
    "/api/projects/:id/files/*",
    async (request, reply) => {
      const filePath = request.params["*"] ?? "";
      const safeRelPath = path.normalize(filePath).replace(/^(\.\.\/|\.\.\\)+/, "");
      const abs = path.join(projectDir(projectRoot, request.params.id), safeRelPath);

      try {
        const content = await fs.readFile(abs, "utf-8");
        const ext = path.extname(safeRelPath).toLowerCase();
        const mimes: Record<string, string> = {
          ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
          ".ts": "text/plain", ".tsx": "text/plain", ".json": "application/json",
          ".md": "text/plain", ".txt": "text/plain",
        };
        reply.header("Content-Type", mimes[ext] ?? "text/plain");
        return reply.send(content);
      } catch {
        return reply.status(404).send(apiError("File not found", { code: "NOT_FOUND" }));
      }
    },
  );

  // GET /api/projects/:id/preview  — serves the project's index.html
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/preview",
    async (request, reply) => {
      const dir = projectDir(projectRoot, request.params.id);
      const indexFile = path.join(dir, "index.html");
      try {
        const html = await fs.readFile(indexFile, "utf-8");
        reply.header("Content-Type", "text/html; charset=utf-8");
        reply.header("X-Frame-Options", "SAMEORIGIN");
        return reply.send(html);
      } catch {
        reply.header("Content-Type", "text/html; charset=utf-8");
        return reply.send("<html><body><p style='font-family:sans-serif;padding:2rem;color:#64748b'>index.html henüz oluşturulmadı. Alloy'a bir mesaj gönderin.</p></body></html>");
      }
    },
  );

  // POST /api/projects/:id/message  — SSE build stream
  app.post<{ Params: { id: string }; Body: { message?: string } }>(
    "/api/projects/:id/message",
    async (request, reply) => {
      const { id } = request.params;
      const message = (request.body?.message ?? "").trim();
      if (!message) {
        return reply.status(400).send(apiError("message is required", { code: "BAD_REQUEST" }));
      }

      const projects = await readIndex(projectRoot);
      const projectIdx = projects.findIndex((p) => p.id === id);
      if (projectIdx === -1) {
        return reply.status(404).send(apiError("Project not found", { code: "NOT_FOUND" }));
      }

      const dir = projectDir(projectRoot, id);

      // SSE response
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");

      function sendEvent(evt: object) {
        reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
      }

      sendEvent({ event: "status", text: "Alloy analize başlıyor…" });

      // Read current files to provide context
      const tree = await buildFileTree(dir);
      const fileSnippets: string[] = [];
      for (const node of tree.flatMap(function flatNodes(n: FileNode): FileNode[] {
        return n.type === "dir" ? (n.children ?? []).flatMap(flatNodes) : [n];
      })) {
        try {
          const content = await fs.readFile(path.join(dir, node.path), "utf-8");
          fileSnippets.push(`=== ${node.path} ===\n${content.slice(0, 2000)}`);
        } catch { /* skip */ }
      }

      const projectInfo = projects[projectIdx]!;
      const currentFilesContext = fileSnippets.length > 0
        ? `\nMevcut dosyalar:\n${fileSnippets.join("\n\n")}`
        : "\nHenüz dosya yok.";

      const systemPrompt = `Sen Alloy Builder'sın, bir web geliştirme asistanısın.
Proje: "${projectInfo.name}" — ${projectInfo.description}
${currentFilesContext}

Kullanıcının isteğine göre web projesini oluştur veya güncelle.
Yanıt formatı SADECE JSON olmalı:
{
  "summary": "Kısa açıklama (1-2 cümle)",
  "files": [
    { "path": "index.html", "content": "..." },
    { "path": "style.css", "content": "..." }
  ]
}
Dosyalar tam içerikle verilmeli. Sadece değişen dosyaları listele.`;

      sendEvent({ event: "status", text: "AI modeline bağlanıyor…" });

      try {
        const accessToken = await tokenStore.getValidAccessToken();
        const accountManager = getAccountManager();

        if (!accessToken || !accountManager) {
          sendEvent({ event: "error", text: "Hesap bağlantısı yok. Hesaplar sayfasından Google hesabı ekleyin." });
          reply.raw.end();
          return;
        }

        const { AlloyGatewayClient } = await import("../../orchestration/gateway-client");
        const client = AlloyGatewayClient.fromToken(
          accessToken,
          tokenStore.getActiveToken()?.email ?? "",
          accountManager,
        );

        sendEvent({ event: "status", text: "Kod yazılıyor…" });

        const modelId = "gemini-1.5-pro";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
        const res = await client.fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: message }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "Bilinmeyen hata");
          sendEvent({ event: "error", text: `AI hatası: ${res.status} — ${errBody.slice(0, 200)}` });
          reply.raw.end();
          return;
        }

        const data = await res.json() as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        // Extract JSON from possible markdown code fence
        const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, rawText];
        let parsed: { summary?: string; files?: { path: string; content: string }[] } = {};
        try {
          parsed = JSON.parse(jsonMatch[1]?.trim() ?? "{}") as typeof parsed;
        } catch {
          // AI didn't return valid JSON — treat the full response as a summary
          parsed = { summary: rawText.slice(0, 300), files: [] };
        }

        const files = Array.isArray(parsed.files) ? parsed.files : [];
        const summary = parsed.summary ?? "Güncelleme tamamlandı";

        sendEvent({ event: "status", text: `${files.length} dosya yazılıyor…` });

        // Write files to disk
        for (const file of files) {
          if (!file.path || typeof file.content !== "string") continue;
          const safePath = path.normalize(file.path).replace(/^(\.\.\/|\.\.\\)+/, "");
          const absPath = path.join(dir, safePath);
          await fs.mkdir(path.dirname(absPath), { recursive: true });
          await fs.writeFile(absPath, file.content, "utf-8");
        }

        // Update project metadata
        projects[projectIdx] = {
          ...projectInfo,
          updatedAt: new Date().toISOString(),
          messageCount: projectInfo.messageCount + 1,
          stack: await detectStack(dir),
        };
        await writeIndex(projectRoot, projects);

        sendEvent({ event: "done", summary, files });
      } catch (err) {
        sendEvent({ event: "error", text: err instanceof Error ? err.message : String(err) });
      }

      reply.raw.end();
    },
  );
}
