/**
 * TerminalTimeline — scrollable log of pipeline events in a terminal-style view.
 */

import { useEffect, useRef } from "react";
import { Terminal, CheckCircle2, AlertCircle, Info } from "lucide-react";

type EventLevel = "info" | "success" | "error" | "system";

interface TimelineEvent {
  id: string;
  level: EventLevel;
  message: string;
  timestamp: string;
  agent?: string;
}

interface TerminalTimelineProps {
  events: TimelineEvent[];
  maxHeight?: number;
}

function levelIcon(level: EventLevel) {
  switch (level) {
    case "success": return <CheckCircle2 size={12} className="text-[var(--color-alloy-success)] shrink-0 mt-0.5" />;
    case "error":   return <AlertCircle size={12} className="text-[var(--color-alloy-error)] shrink-0 mt-0.5" />;
    case "system":  return <Terminal size={12} className="text-[var(--color-alloy-accent)] shrink-0 mt-0.5" />;
    default:        return <Info size={12} className="text-[var(--color-alloy-text-dim)] shrink-0 mt-0.5" />;
  }
}

function levelColor(level: EventLevel): string {
  switch (level) {
    case "success": return "text-[var(--color-alloy-success)]";
    case "error":   return "text-[var(--color-alloy-error)]";
    case "system":  return "text-[var(--color-alloy-accent)]";
    default:        return "text-[var(--color-alloy-text-sec)]";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export function TerminalTimeline({ events, maxHeight = 360 }: TerminalTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="rounded-2xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-alloy-border)] px-5 py-3">
        <Terminal size={14} className="text-[var(--color-alloy-accent)]" />
        <span className="text-[13px] font-semibold text-[var(--color-alloy-text)]">Sistem Kayitlari</span>
        {events.length > 0 && (
          <span className="ml-auto text-[11px] text-[var(--color-alloy-text-dim)]">{events.length} olay</span>
        )}
      </div>

      <div
        className="overflow-y-auto bg-[var(--color-alloy-bg)] p-3 font-mono"
        style={{ maxHeight }}
      >
        {events.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[12px] text-[var(--color-alloy-text-dim)]">
            Henuz olay yok
          </div>
        )}
        {events.map((evt) => (
          <div key={evt.id} className="flex items-start gap-2 py-1 px-1 rounded hover:bg-[var(--color-alloy-surface-hover)] transition-colors">
            {levelIcon(evt.level)}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-[var(--color-alloy-text-dim)] shrink-0">{formatTime(evt.timestamp)}</span>
                {evt.agent && (
                  <span className="text-[10px] font-medium text-[var(--color-alloy-accent)] shrink-0">[{evt.agent}]</span>
                )}
              </div>
              <p className={`text-[12px] leading-relaxed break-words ${levelColor(evt.level)}`}>
                {evt.message}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
