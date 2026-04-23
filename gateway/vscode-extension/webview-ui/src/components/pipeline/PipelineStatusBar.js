import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy PipelineStatusBar — Compact pipeline progress indicator
   ═══════════════════════════════════════════════════════════════════ */
import { Activity, CheckCircle2, XCircle, Loader2, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/shared";
import { usePipelineStore } from "@/store/pipelineStore";
export function PipelineStatusBar() {
    const { pipelineStatus, phases, isPipelineRunning } = usePipelineStore();
    if (!pipelineStatus)
        return null;
    const statusConfig = {
        idle: { icon: _jsx(Activity, { className: "w-3 h-3" }), variant: "default", label: "Idle" },
        standby: { icon: _jsx(Activity, { className: "w-3 h-3" }), variant: "default", label: "Standby" },
        active: { icon: _jsx(Loader2, { className: "w-3 h-3 animate-spin" }), variant: "processing", label: "Active" },
        running: { icon: _jsx(Loader2, { className: "w-3 h-3 animate-spin" }), variant: "processing", label: "Running" },
        paused: { icon: _jsx(Pause, { className: "w-3 h-3" }), variant: "warning", label: "Paused" },
        completed: { icon: _jsx(CheckCircle2, { className: "w-3 h-3" }), variant: "success", label: "Completed" },
        failed: { icon: _jsx(XCircle, { className: "w-3 h-3" }), variant: "error", label: "Failed" },
    };
    const statusKey = pipelineStatus.status.status;
    const config = statusConfig[statusKey] ?? statusConfig.idle;
    const overallProgress = phases.length > 0
        ? Math.round(phases.reduce((sum, p) => sum + (p.status === "completed" ? 100 : p.progress ?? 0), 0) /
            phases.length)
        : 0;
    return (_jsxs("div", { className: cn("flex items-center gap-2 px-3 py-1.5", "bg-[var(--alloy-bg-secondary)] border-b border-[var(--alloy-border-subtle)]", "text-[var(--alloy-text-secondary)]"), children: [_jsx("span", { className: "text-[var(--alloy-accent)]", children: config.icon }), _jsx("span", { className: "text-[11px] font-medium", children: "Pipeline" }), _jsx(Badge, { variant: config.variant, size: "xs", dot: true, children: config.label }), phases.length > 0 && (_jsx("div", { className: "flex items-center gap-1 ml-2", children: phases.map((phase, i) => (_jsxs("div", { className: "flex items-center gap-1", children: [_jsx(PhaseDot, { status: phase.status }), _jsx("span", { className: "text-[10px] text-[var(--alloy-text-muted)]", children: phase.name }), i < phases.length - 1 && (_jsx("div", { className: "w-3 h-px bg-[var(--alloy-border-default)]" }))] }, phase.name))) })), _jsx("div", { className: "flex-1" }), isPipelineRunning && (_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("div", { className: "w-16 h-1 bg-[var(--alloy-bg-tertiary)] rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-[var(--alloy-accent)] rounded-full transition-all duration-500", style: { width: `${overallProgress}%` } }) }), _jsxs("span", { className: "text-[10px] font-mono text-[var(--alloy-text-muted)]", children: [overallProgress, "%"] })] }))] }));
}
function PhaseDot({ status }) {
    return (_jsx("div", { className: cn("w-1.5 h-1.5 rounded-full shrink-0", status === "completed" && "bg-[var(--alloy-success)]", status === "running" && "bg-[var(--alloy-accent)] animate-pulse", status === "failed" && "bg-[var(--alloy-error)]", status === "pending" && "bg-[var(--alloy-text-muted)]") }));
}
