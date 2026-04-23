import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy Webview Entry Point — with boot signaling & error recovery
   ═══════════════════════════════════════════════════════════════════ */
import { Component } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/alloy-theme.css";
import App from "./App";
function signalBootReady() {
    try {
        window.__ALLOY_BOOT?.ready();
    }
    catch (e) {
        console.error("[Alloy] Failed to signal boot ready:", e);
    }
}
function signalBootFailed(err) {
    try {
        window.__ALLOY_BOOT?.fail(err);
    }
    catch {
        // Last resort — nothing we can do
    }
}
class BootErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: "" };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error: error.message || String(error) };
    }
    componentDidCatch(error) {
        console.error("[Alloy] React mount error:", error);
        signalBootFailed(error);
    }
    render() {
        if (this.state.hasError) {
            return (_jsxs("div", { style: {
                    padding: 16,
                    color: "#ef4444",
                    fontFamily: "monospace",
                    fontSize: 12,
                    background: "#1a1a2e",
                    height: "100vh",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    gap: 12,
                }, children: [_jsx("div", { style: { fontSize: 32 }, children: "\u26A0\uFE0F" }), _jsx("div", { style: { fontWeight: "bold", fontSize: 14 }, children: "Alloy UI Failed to Load" }), _jsx("div", { style: { opacity: 0.7, maxWidth: 400 }, children: this.state.error }), _jsx("button", { onClick: () => window.location.reload(), style: {
                            marginTop: 8,
                            padding: "6px 16px",
                            background: "#6366f1",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 12,
                        }, children: "Retry" })] }));
        }
        return this.props.children;
    }
}
/* ── Mount ──────────────────────────────────────────────────────── */
const root = document.getElementById("root");
if (!root) {
    signalBootFailed(new Error("#root element not found in DOM"));
    throw new Error("#root not found");
}
try {
    const reactRoot = createRoot(root);
    reactRoot.render(_jsx(BootErrorBoundary, { children: _jsx(App, {}) }));
    // Signal ready after React has had a chance to mount
    // The HTML template already sent "ui_boot_started"
    requestAnimationFrame(() => {
        signalBootReady();
    });
}
catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    signalBootFailed(err);
    console.error("[Alloy] Fatal mount error:", error);
}
