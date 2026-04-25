/* ═══════════════════════════════════════════════════════════════════
   useVSCodeApi — typed VS Code webview message bridge
   Uses window.__vsCodeApi exposed by webview-bootstrap.ts HTML template.
   NEVER calls acquireVsCodeApi() — it can only be called once.
   ═══════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useCallback } from "react";
import type { IncomingMessage, OutgoingMessage } from "@/lib/vscode";

interface VsCodeApi {
  postMessage(msg: OutgoingMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// The HTML template calls acquireVsCodeApi() once and stores it on window
function getVsCodeApi(): VsCodeApi | null {
  return (window as any).__vsCodeApi ?? null;
}

export function useVSCodeApi(onMessage: (msg: IncomingMessage) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as IncomingMessage;
      if (msg && typeof msg === "object" && "type" in msg) {
        onMessageRef.current(msg);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const postMessage = useCallback((msg: OutgoingMessage) => {
    const api = getVsCodeApi();
    if (api) {
      api.postMessage(msg);
    } else {
      console.warn("[Alloy] postMessage: VS Code API not available", msg);
    }
  }, []);

  return { postMessage };
}

export { getVsCodeApi };