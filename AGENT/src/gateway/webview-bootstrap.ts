import * as fs from "node:fs";
import * as path from "node:path";

export interface WebviewAssetResolution {
  scriptFileName: string;
  styleFileName: string;
  strategy: "fixed-index" | "html-entry" | "fallback-scan";
  notes: string[];
}

interface FsOps {
  existsSync: (targetPath: string) => boolean;
  readFileSync: (targetPath: string, encoding: BufferEncoding) => string;
  readdirSync: (targetPath: string) => string[];
}

const defaultFsOps: FsOps = {
  existsSync: fs.existsSync,
  readFileSync: (targetPath: string, encoding: BufferEncoding) =>
    fs.readFileSync(targetPath, encoding),
  readdirSync: (targetPath: string) => fs.readdirSync(targetPath),
};

function normalizeAssetReference(reference: string): string | null {
  const withoutQuery = reference.split("?")[0]?.split("#")[0]?.trim() ?? "";
  if (!withoutQuery) return null;
  const normalized = withoutQuery.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts[parts.length - 1]?.trim();
  return fileName || null;
}

function resolveFromHtml(html: string, attribute: "src" | "href"): string | null {
  const regex = new RegExp(`<[^>]+${attribute}=["']([^"']+)["'][^>]*>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const normalized = normalizeAssetReference(raw);
    if (!normalized) continue;
    if (attribute === "src" && normalized.endsWith(".js")) return normalized;
    if (attribute === "href" && normalized.endsWith(".css")) return normalized;
  }
  return null;
}

function pickAsset(
  files: string[],
  preferredFileName: string,
  extension: ".js" | ".css",
): string {
  const extensionFiles = files.filter((file) => file.endsWith(extension));
  if (extensionFiles.includes(preferredFileName)) {
    return preferredFileName;
  }

  const nonVendor = extensionFiles.filter((file) => !/^vendor[-_]/i.test(file));
  if (nonVendor.length > 0) {
    return nonVendor.sort()[0]!;
  }

  if (extensionFiles.length > 0) {
    return extensionFiles.sort()[0]!;
  }

  return preferredFileName;
}

export function resolveWebviewAssets(
  distPath: string,
  assetsPath: string,
  fsOps: FsOps = defaultFsOps,
): WebviewAssetResolution {
  const notes: string[] = [];
  const fixedScript = "index.js";
  const fixedStyle = "index.css";
  const fixedScriptPath = path.join(assetsPath, fixedScript);
  const fixedStylePath = path.join(assetsPath, fixedStyle);

  if (fsOps.existsSync(fixedScriptPath) && fsOps.existsSync(fixedStylePath)) {
    return {
      scriptFileName: fixedScript,
      styleFileName: fixedStyle,
      strategy: "fixed-index",
      notes,
    };
  }

  const indexHtmlPath = path.join(distPath, "index.html");
  if (fsOps.existsSync(indexHtmlPath)) {
    try {
      const html = fsOps.readFileSync(indexHtmlPath, "utf-8");
      const htmlScript = resolveFromHtml(html, "src");
      const htmlStyle = resolveFromHtml(html, "href");
      const scriptValid =
        htmlScript !== null && fsOps.existsSync(path.join(assetsPath, htmlScript));
      const styleValid =
        htmlStyle !== null && fsOps.existsSync(path.join(assetsPath, htmlStyle));
      if (scriptValid && styleValid) {
        return {
          scriptFileName: htmlScript!,
          styleFileName: htmlStyle!,
          strategy: "html-entry",
          notes,
        };
      }
      notes.push("index.html asset references were missing or invalid.");
    } catch (error) {
      notes.push(`index.html parse failed: ${String(error)}`);
    }
  } else {
    notes.push("index.html not found; using fallback asset scan.");
  }

  let files: string[] = [];
  try {
    if (fsOps.existsSync(assetsPath)) {
      files = fsOps.readdirSync(assetsPath);
    } else {
      notes.push("assets directory not found; using static defaults.");
    }
  } catch (error) {
    notes.push(`assets scan failed: ${String(error)}`);
  }

  return {
    scriptFileName: pickAsset(files, fixedScript, ".js"),
    styleFileName: pickAsset(files, fixedStyle, ".css"),
    strategy: "fallback-scan",
    notes,
  };
}

export interface BuildWebviewHtmlOptions {
  title: string;
  nonce: string;
  cspSource: string;
  connectSources: string[];
  styleUri: string;
  scriptUri: string;
}

export function buildWebviewHtml(options: BuildWebviewHtmlOptions): string {
  const connectSources = Array.from(new Set(options.connectSources)).join(" ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${options.nonce}' ${options.cspSource}; style-src ${options.cspSource} 'unsafe-inline'; font-src ${options.cspSource} https://fonts.gstatic.com; img-src ${options.cspSource} data: https:; connect-src ${connectSources};">
  <link href="${options.styleUri}" rel="stylesheet">
  <title>${options.title}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${options.nonce}">
    (function () {
      const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
      const post = function (type, payload) {
        if (!vscode) return;
        try {
          vscode.postMessage({ type: type, payload: payload || {} });
        } catch {
          // no-op
        }
      };
      const toMessage = function (reason) {
        if (typeof reason === "string") return reason;
        if (reason && typeof reason.message === "string") return reason.message;
        try {
          return JSON.stringify(reason);
        } catch {
          return String(reason);
        }
      };

      window.__LOJINEXT_BOOT = {
        ready: function (payload) { post("ui_boot_ready", payload || {}); },
        fail: function (payload) { post("ui_boot_failed", payload || {}); },
      };

      post("ui_boot_started", { timestamp: new Date().toISOString() });

      window.addEventListener("error", function (event) {
        post("ui_boot_failed", {
          message: event.message || "Runtime error",
          source: event.filename || "",
          line: event.lineno || 0,
          column: event.colno || 0,
        });
      }, true);

      window.addEventListener("unhandledrejection", function (event) {
        post("ui_boot_failed", {
          message: "Unhandled rejection: " + toMessage(event.reason),
        });
      });
    })();
  </script>
  <script nonce="${options.nonce}" type="module" src="${options.scriptUri}"></script>
</body>
</html>`;
}

export class WebviewBootGate<T> {
  private ready = false;
  private readonly queue: T[] = [];
  private readonly maxQueueSize: number;

  constructor(maxQueueSize: number = 200) {
    this.maxQueueSize = Math.max(1, maxQueueSize);
  }

  public reset(): void {
    this.ready = false;
    this.queue.length = 0;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public enqueue(message: T, send: (next: T) => void): void {
    if (this.ready) {
      send(message);
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push(message);
  }

  public markReady(send: (next: T) => void): void {
    if (this.ready) return;
    this.ready = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next !== undefined) {
        send(next);
      }
    }
  }
}
