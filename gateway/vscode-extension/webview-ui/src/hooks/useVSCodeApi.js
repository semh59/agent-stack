/* ═══════════════════════════════════════════════════════════════════
   useVSCodeApi — typed VS Code webview message bridge
   Uses window.__vsCodeApi exposed by webview-bootstrap.ts HTML template.
   NEVER calls acquireVsCodeApi() — it can only be called once.
   ═══════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useCallback } from "react";
// The HTML template calls acquireVsCodeApi() once and stores it on window
function getVsCodeApi() {
    return window.__vsCodeApi ?? null;
}
export function useVSCodeApi(onMessage) {
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;
    useEffect(() => {
        const handler = (event) => {
            const msg = event.data;
            if (msg && typeof msg === "object" && "type" in msg) {
                onMessageRef.current(msg);
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);
    const postMessage = useCallback((msg) => {
        const api = getVsCodeApi();
        if (api) {
            api.postMessage(msg);
        }
        else {
            console.warn("[Alloy] postMessage: VS Code API not available", msg);
        }
    }, []);
    return { postMessage };
}
export { getVsCodeApi };
