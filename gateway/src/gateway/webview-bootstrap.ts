/* ═══════════════════════════════════════════════════════════════════
   Alloy Webview Bootstrap — HTML generation & asset resolution
   Provides buildWebviewHtml, resolveWebviewAssets, WebviewBootGate
   ═══════════════════════════════════════════════════════════════════ */

import * as fs from "fs";
import type * as vscode from "vscode";

/* ── Asset Resolution ─────────────────────────────────────────────── */

export interface ResolvedAssets {
  scriptFileName: string;
  styleFileName: string;
  strategy: string;
  notes: string[];
}

/**
 * O7 FIX: Dynamic asset discovery instead of hardcoded hashes.
 * Reads the dist/assets directory to find the actual .js and .css files.
 */
export function resolveWebviewAssets(
  distPath: string,
  assetsPath: string
): ResolvedAssets {
  const notes: string[] = [];

  // Default fallback names
  let scriptFileName = "index.js";
  let styleFileName = "index.css";
  let strategy = "fallback";

  try {
    if (!fs.existsSync(assetsPath)) {
      notes.push(`Assets directory not found: ${assetsPath}`);
      return { scriptFileName, styleFileName, strategy, notes };
    }

    const files = fs.readdirSync(assetsPath);
    const jsFiles = files.filter((f) => f.endsWith(".js"));
    const cssFiles = files.filter((f) => f.endsWith(".css"));

    // Strategy 1: Look for stable names (from Vite config)
    if (jsFiles.includes("index.js")) {
      scriptFileName = "index.js";
      strategy = "stable-name";
    } else if (jsFiles.length > 0) {
      // Strategy 2: Use the first JS file found
      scriptFileName = jsFiles[0]!;
      strategy = "discovered";
      notes.push(`Using discovered JS file: ${jsFiles[0]}`);
    } else {
      notes.push("No JS files found in assets directory");
    }

    if (cssFiles.includes("index.css")) {
      styleFileName = "index.css";
    } else if (cssFiles.length > 0) {
      styleFileName = cssFiles[0]!;
      notes.push(`Using discovered CSS file: ${cssFiles[0]}`);
    } else {
      notes.push("No CSS files found in assets directory — skipping stylesheet");
      styleFileName = "";
    }
  } catch (err) {
    notes.push(`Asset resolution error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { scriptFileName, styleFileName, strategy, notes };
}

/* ── HTML Builder ─────────────────────────────────────────────────── */

export interface BuildHtmlOptions {
  webview: vscode.Webview;
  scriptUri: vscode.Uri;
  styleUri: vscode.Uri;
  nonce: string;
  cspSource: string;
  extraConnectOrigins?: string[];
}

/**
 * Builds the complete HTML document for the webview.
 * Includes CSP, nonce, boot gate, and VS Code theme integration.
 */
export function buildWebviewHtml(options: BuildHtmlOptions): string {
  const { scriptUri, styleUri, nonce, cspSource, extraConnectOrigins = [] } = options;

  const connectSources = [
    "'self'",
    ...extraConnectOrigins,
  ].join(" ");

  const styleSheetTag = styleUri && styleUri.toString()
    ? `<link rel="stylesheet" href="${styleUri.toString()}">`
    : "";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' ${cspSource};
             style-src ${cspSource} 'unsafe-inline';
             font-src ${cspSource};
             connect-src ${connectSources};
             img-src ${cspSource} https: data:;">
  <meta name="theme-color" content="#09090b">
  ${styleSheetTag}
  <title>Alloy AI</title>
</head>
<body>
  <div id="root">
    <div id="alloy-boot-loader" style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f3a833;font-family:system-ui;font-size:14px;gap:8px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f3a833" stroke-width="2" style="animation:spin 1s linear infinite">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      Loading Alloy...
    </div>
  </div>
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  <script nonce="${nonce}">
    // ── Diagnostic: Boot timeout detection ──
    window.__ALLOY_BOOT_DIAG = { startTime: Date.now(), phase: 'inline-script' };
    setTimeout(function() {
      if (!window.__ALLOY_BOOT_DONE) {
        var el = document.getElementById('alloy-boot-loader');
        if (el) {
          el.innerHTML = '<div style="text-align:center"><div style="font-size:32px;margin-bottom:8px">⏱️</div><div style="font-weight:bold;margin-bottom:4px">Alloy UI Timeout</div><div style="opacity:0.7;font-size:11px">Phase: ' + (window.__ALLOY_BOOT_DIAG.phase || 'unknown') + '<br>Elapsed: ' + ((Date.now() - window.__ALLOY_BOOT_DIAG.startTime)/1000).toFixed(1) + 's</div><button onclick="location.reload()" style="margin-top:8px;padding:4px 12px;background:#6366f1;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px">Retry</button></div>';
        }
      }
    }, 8000);

    // ── VS Code API Acquisition (can only be called ONCE) ──
    try {
      var vscodeApi = acquireVsCodeApi();
      window.__vsCodeApi = vscodeApi;
      window.__ALLOY_BOOT_DIAG.phase = 'api-acquired';
    } catch(e) {
      window.__ALLOY_BOOT_DIAG.phase = 'api-failed:' + (e&&e.message||e);
      document.getElementById('alloy-boot-loader').innerHTML = '<div style="text-align:center;color:#ef4444"><div style="font-size:32px;margin-bottom:8px">❌</div><div style="font-weight:bold">VS Code API Error</div><div style="opacity:0.7;font-size:11px;margin-top:4px">' + (e&&e.message||String(e)) + '</div></div>';
      throw e;
    }

    // ── Boot Gate ──
    window.__ALLOY_BOOT_DIAG.phase = 'boot-gate-setup';
    var bootMessageQueue = [];
    var bootReady = false;

    window.__ALLOY_BOOT = {
      ready: function() {
        bootReady = true;
        window.__ALLOY_BOOT_DONE = true;
        window.__ALLOY_BOOT_DIAG.phase = 'ready';
        vscodeApi.postMessage({ type: 'ui_boot_ready' });
        while (bootMessageQueue.length > 0) {
          var msg = bootMessageQueue.shift();
          window.postMessage(msg, '*');
        }
      },
      fail: function(err) {
        window.__ALLOY_BOOT_DONE = true;
        window.__ALLOY_BOOT_DIAG.phase = 'failed';
        vscodeApi.postMessage({
          type: 'ui_boot_failed',
          payload: { message: (err && err.message) || String(err) }
        });
      }
    };

    // Signal boot started
    window.__ALLOY_BOOT_DIAG.phase = 'boot-started';
    vscodeApi.postMessage({ type: 'ui_boot_started' });
  </script>
  <script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

/* ── Boot Gate ────────────────────────────────────────────────────── */

/**
 * Queues messages until the webview signals it's ready.
 * Prevents message loss during React app initialization.
 */
export class WebviewBootGate<T> {
  private queue: T[] = [];
  private _ready = false;
  private _sendFn: ((msg: T) => void) | null = null;
  constructor(private readonly _timeoutMs: number = 400) {}
  enqueue(msg: T, fn: (msg: T) => void): void {
    this._sendFn = fn;
    if (this._ready) { fn(msg); } else { this.queue.push(msg); }
  }
  markReady(fn: (msg: T) => void): void {
    this._ready = true;
    this._sendFn = fn;
    for (const m of this.queue) fn(m);
    this.queue = [];
  }
  reset(): void { this._ready = false; this.queue = []; this._sendFn = null; }
}
