import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/MicroAnimations.css";
import "./i18n";
import App from "./App.tsx";
import { useAppStore } from "./store/appStore";

declare global {
  interface Window {
    __LOJINEXT_BOOT?: {
      ready: (payload?: Record<string, unknown>) => void;
      fail: (payload?: Record<string, unknown>) => void;
    };
  }
}

function reportBootReady(payload?: Record<string, unknown>): void {
  window.__LOJINEXT_BOOT?.ready(payload);
}

function reportBootFailure(error: unknown): void {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown UI boot failure";
  window.__LOJINEXT_BOOT?.fail({ message });
}

useAppStore.getState().initializeWebSocket();

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Missing root element '#root'");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  reportBootReady({
    route: window.location.hash || "#/",
    timestamp: new Date().toISOString(),
  });
} catch (error) {
  reportBootFailure(error);
  throw error;
}
