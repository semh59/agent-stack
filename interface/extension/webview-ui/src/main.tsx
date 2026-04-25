/* ═══════════════════════════════════════════════════════════════════
   Alloy Webview Entry Point — with boot signaling & error recovery
   ═══════════════════════════════════════════════════════════════════ */

import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/alloy-theme.css";
import App from "./App";

/* ── Boot Signaling ─────────────────────────────────────────────── */
// The HTML template already sent "ui_boot_started" and set up window.__ALLOY_BOOT.
// We just need to call ready() or fail() when React finishes mounting.

declare const window: Window & {
  __ALLOY_BOOT?: {
    ready: () => void;
    fail: (err?: Error) => void;
  };
};

function signalBootReady() {
  try {
    window.__ALLOY_BOOT?.ready();
  } catch (e) {
    console.error("[Alloy] Failed to signal boot ready:", e);
  }
}

function signalBootFailed(err: Error) {
  try {
    window.__ALLOY_BOOT?.fail(err);
  } catch {
    // Last resort — nothing we can do
  }
}

/* ── Error Boundary ─────────────────────────────────────────────── */
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: string;
}

class BootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: error.message || String(error) };
  }

  componentDidCatch(error: Error) {
    console.error("[Alloy] React mount error:", error);
    signalBootFailed(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
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
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontWeight: "bold", fontSize: 14 }}>Alloy UI Failed to Load</div>
          <div style={{ opacity: 0.7, maxWidth: 400 }}>{this.state.error}</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: "6px 16px",
              background: "#6366f1",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      );
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

  reactRoot.render(
    <BootErrorBoundary>
      <App />
    </BootErrorBoundary>
  );

  // Signal ready after React has had a chance to mount
  // The HTML template already sent "ui_boot_started"
  requestAnimationFrame(() => {
    signalBootReady();
  });
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  signalBootFailed(err);
  console.error("[Alloy] Fatal mount error:", error);
}
