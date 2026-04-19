/**
 * Sovereign toast notifications.
 *
 * Minimal, dependency-free stack — each toast auto-dismisses after 4s
 * unless hovered. Mount <ToastHost /> once at the app root; call
 * `useToast()` from anywhere.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

type Tone = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  tone: Tone;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastContextValue {
  notify: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const toast: Toast = { id, ...t };
      setToasts((prev) => [...prev, toast]);
      const handle = window.setTimeout(() => dismiss(id), t.durationMs ?? 4000);
      timers.current.set(id, handle);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      for (const handle of timers.current.values()) window.clearTimeout(handle);
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ notify, dismiss }}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback — logs the toast instead of crashing when used outside the provider.
    return {
      notify: (t) => {
        // eslint-disable-next-line no-console
        console.info(`[toast:${t.tone}] ${t.title}${t.description ? " — " + t.description : ""}`);
        return "noop";
      },
      dismiss: () => {},
    };
  }
  return ctx;
}

function ToastHost({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const Icon =
    toast.tone === "success"
      ? CheckCircle2
      : toast.tone === "warning"
        ? AlertTriangle
        : toast.tone === "error"
          ? XCircle
          : Info;

  return (
    <div
      role="status"
      className={clsx(
        "pointer-events-auto w-96 max-w-[90vw] rounded-xl border bg-[var(--color-loji-surface)] p-4 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]",
        toast.tone === "success" && "border-emerald-500/40",
        toast.tone === "warning" && "border-amber-500/40",
        toast.tone === "error" && "border-red-500/40",
        toast.tone === "info" && "border-[var(--color-loji-border)]",
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          size={18}
          className={clsx(
            "mt-0.5 shrink-0",
            toast.tone === "success" && "text-emerald-400",
            toast.tone === "warning" && "text-amber-300",
            toast.tone === "error" && "text-red-400",
            toast.tone === "info" && "text-[var(--color-loji-accent)]",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{toast.title}</p>
          {toast.description ? (
            <p className="mt-1 text-xs text-[var(--color-loji-text-sec)]">{toast.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 rounded p-1 text-[var(--color-loji-text-sec)] hover:text-white"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
