/* ═══════════════════════════════════════════════════════════════════
   Alloy PipelineStatusBar — Compact pipeline progress indicator
   ═══════════════════════════════════════════════════════════════════ */

import { Activity, CheckCircle2, XCircle, Loader2, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/shared";
import { usePipelineStore } from "@/store/pipelineStore";

export function PipelineStatusBar() {
  const { pipelineStatus, phases, isPipelineRunning } = usePipelineStore();

  if (!pipelineStatus) return null;

  const statusConfig: Record<string, { icon: React.ReactNode; variant: "default" | "processing" | "warning" | "success" | "error"; label: string }> = {
    idle: { icon: <Activity className="w-3 h-3" />, variant: "default", label: "Idle" },
    standby: { icon: <Activity className="w-3 h-3" />, variant: "default", label: "Standby" },
    active: { icon: <Loader2 className="w-3 h-3 animate-spin" />, variant: "processing", label: "Active" },
    running: { icon: <Loader2 className="w-3 h-3 animate-spin" />, variant: "processing", label: "Running" },
    paused: { icon: <Pause className="w-3 h-3" />, variant: "warning", label: "Paused" },
    completed: { icon: <CheckCircle2 className="w-3 h-3" />, variant: "success", label: "Completed" },
    failed: { icon: <XCircle className="w-3 h-3" />, variant: "error", label: "Failed" },
  };

  const statusKey = pipelineStatus.status.status;
  const config = statusConfig[statusKey] ?? statusConfig.idle;

  const overallProgress = phases.length > 0
    ? Math.round(
        phases.reduce((sum, p) => sum + (p.status === "completed" ? 100 : p.progress ?? 0), 0) /
        phases.length
      )
    : 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5",
        "bg-[var(--alloy-bg-secondary)] border-b border-[var(--alloy-border-subtle)]",
        "text-[var(--alloy-text-secondary)]"
      )}
    >
      <span className="text-[var(--alloy-accent)]">{config.icon}</span>
      <span className="text-[11px] font-medium">Pipeline</span>
      <Badge variant={config.variant} size="xs" dot>
        {config.label}
      </Badge>

      {/* Phase indicators */}
      {phases.length > 0 && (
        <div className="flex items-center gap-1 ml-2">
          {phases.map((phase, i) => (
            <div key={phase.name} className="flex items-center gap-1">
              <PhaseDot status={phase.status} />
              <span className="text-[10px] text-[var(--alloy-text-muted)]">{phase.name}</span>
              {i < phases.length - 1 && (
                <div className="w-3 h-px bg-[var(--alloy-border-default)]" />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* Progress bar */}
      {isPipelineRunning && (
        <div className="flex items-center gap-1.5">
          <div className="w-16 h-1 bg-[var(--alloy-bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--alloy-accent)] rounded-full transition-all duration-500"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-[var(--alloy-text-muted)]">
            {overallProgress}%
          </span>
        </div>
      )}
    </div>
  );
}

function PhaseDot({ status }: { status: string }) {
  return (
    <div
      className={cn(
        "w-1.5 h-1.5 rounded-full shrink-0",
        status === "completed" && "bg-[var(--alloy-success)]",
        status === "running" && "bg-[var(--alloy-accent)] animate-pulse",
        status === "failed" && "bg-[var(--alloy-error)]",
        status === "pending" && "bg-[var(--alloy-text-muted)]"
      )}
    />
  );
}