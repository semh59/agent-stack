import { describe, expect, it } from "vitest";

import {
  buildWebviewHtml,
  resolveWebviewAssets,
  WebviewBootGate,
} from "./webview-bootstrap";

function createMockFs(state: {
  files?: Record<string, string>;
  directories?: Record<string, string[]>;
}) {
  const normalize = (value: string): string => value.replace(/\\/g, "/");
  const files = Object.fromEntries(
    Object.entries(state.files ?? {}).map(([key, value]) => [normalize(key), value]),
  );
  const directories = Object.fromEntries(
    Object.entries(state.directories ?? {}).map(([key, value]) => [normalize(key), value]),
  );

  return {
    existsSync(targetPath: string): boolean {
      const normalizedPath = normalize(targetPath);
      return normalizedPath in files || normalizedPath in directories;
    },
    readFileSync(targetPath: string): string {
      const normalizedPath = normalize(targetPath);
      if (!(normalizedPath in files)) {
        throw new Error(`ENOENT: ${targetPath}`);
      }
      return files[normalizedPath]!;
    },
    readdirSync(targetPath: string): string[] {
      const normalizedPath = normalize(targetPath);
      if (!(normalizedPath in directories)) {
        throw new Error(`ENOENT: ${targetPath}`);
      }
      return directories[normalizedPath]!;
    },
  };
}

describe("resolveWebviewAssets", () => {
  it("prefers fixed index.js/index.css when present", () => {
    const mockFs = createMockFs({
      files: {
        "D:/dist/assets/index.js": "console.log('main')",
        "D:/dist/assets/index.css": "body{}",
      },
      directories: {
        "D:/dist/assets": ["index.js", "index.css", "vendor-react.js"],
      },
    });

    const resolved = resolveWebviewAssets("D:/dist", "D:/dist/assets", mockFs);
    expect(resolved.strategy).toBe("fixed-index");
    expect(resolved.scriptFileName).toBe("index.js");
    expect(resolved.styleFileName).toBe("index.css");
  });

  it("falls back to index.html entries when fixed files are missing", () => {
    const mockFs = createMockFs({
      files: {
        "D:/dist/index.html":
          '<link rel="stylesheet" href="./assets/main-abc.css"><script type="module" src="./assets/main-abc.js"></script>',
        "D:/dist/assets/main-abc.css": "body{}",
        "D:/dist/assets/main-abc.js": "console.log('main')",
      },
      directories: {
        "D:/dist/assets": ["main-abc.js", "main-abc.css", "vendor-react.js"],
      },
    });

    const resolved = resolveWebviewAssets("D:/dist", "D:/dist/assets", mockFs);
    expect(resolved.strategy).toBe("html-entry");
    expect(resolved.scriptFileName).toBe("main-abc.js");
    expect(resolved.styleFileName).toBe("main-abc.css");
  });

  it("uses non-vendor assets in fallback scan", () => {
    const mockFs = createMockFs({
      files: {},
      directories: {
        "D:/dist/assets": [
          "vendor-react.js",
          "vendor-state.js",
          "app-main.js",
          "vendor.css",
          "app-main.css",
        ],
      },
    });

    const resolved = resolveWebviewAssets("D:/dist", "D:/dist/assets", mockFs);
    expect(resolved.strategy).toBe("fallback-scan");
    expect(resolved.scriptFileName).toBe("app-main.js");
    expect(resolved.styleFileName).toBe("app-main.css");
  });
});

describe("buildWebviewHtml", () => {
  it("generates module script + nonce + csp invariants", () => {
    const html = buildWebviewHtml({
      title: "Mission Control",
      nonce: "nonce123",
      cspSource: "vscode-webview://test",
      connectSources: ["vscode-webview://test", "http://127.0.0.1:51122"],
      scriptUri: "vscode-resource:/assets/index.js",
      styleUri: "vscode-resource:/assets/index.css",
    });

    expect(html).toContain(`script-src 'nonce-nonce123' vscode-webview://test`);
    expect(html).toContain('<script nonce="nonce123" type="module" src="vscode-resource:/assets/index.js"></script>');
    expect(html).toContain('vscode.postMessage({ type: type, payload: payload || {} });');
    expect(html).toContain('post("ui_boot_started"');
    expect(html).toContain("window.__SOVEREIGN_BOOT");
  });
});

describe("WebviewBootGate", () => {
  it("buffers messages until markReady and flushes in order", () => {
    const gate = new WebviewBootGate<string>();
    const sent: string[] = [];

    gate.enqueue("authToken", (next) => sent.push(next));
    gate.enqueue("accounts", (next) => sent.push(next));
    expect(sent).toEqual([]);

    gate.markReady((next) => sent.push(next));
    expect(sent).toEqual(["authToken", "accounts"]);

    gate.enqueue("models", (next) => sent.push(next));
    expect(sent).toEqual(["authToken", "accounts", "models"]);
  });
});
