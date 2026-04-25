/**
 * AutonomyConsole — shows live pipeline phase statuses as a compact status strip.
 */

import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";

type PhaseStatus = "idle" | "started" | "completed" | "error";

interface Phase {
  name: string;
  status: PhaseStatus;
  progress?: number;
}

interface AutonomyConsoleProps {
  phases: Phase[];
  className?: string;
}

function PhaseIcon({ status }: { status: PhaseStatus }) {
  switch (status) {
    case "completed": return <CheckCircle2 size={13} className="text-[var(--color-alloy-success)] shrink-0" />;
    case "started":   return <Loader2 size={13} className="text-[var(--color-alloy-accent)] animate-spin shrink-0" />;
    case "error":     return <AlertCircle size={13} className="text-[var(--color-alloy-error)] shrink-0" />;
    default:          return <Circle size={13} className="text-[var(--color-alloy-text-dim)] shrink-0" />;
  }
}

export function AutonomyConsole({ phases, className = "" }: AutonomyConsoleProps) {
  if (phases.length === 0) return null;

  return (
    <div className={`rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] overflow-hidden ${className}`}>
      <div className="border-b border-[var(--color-alloy-border)] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-alloy-text-dim)]">
          Pipeline Durumu
        </span>
      </div>
      <div className="flex flex-col divide-y divide-[var(--color-alloy-border)]">
        {phases.map((phase) => (
          <div key={phase.name} className="flex items-center gap-2.5 px-3 py-2">
            <PhaseIcon status={phase.status} />
            <span className="flex-1 text-[12px] text-[var(--color-alloy-text)]">{phase.name}</span>
            {phase.status === "started" && phase.progress !== undefined && (
              <span className="text-[11px] text-[var(--color-alloy-text-dim)]">{phase.progress}%</span>
            )}
            {phase.status === "completed" && (
              <span className="text-[11px] text-[var(--color-alloy-success)]">Tamamlandi</span>
            )}
            {phase.status === "error" && (
              <span className="text-[11px] text-[var(--color-alloy-error)]">Hata</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
