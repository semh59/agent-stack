import { usePipelineStore } from "@/store/pipelineStore";

type StatusKey = "idle" | "standby" | "active" | "running" | "paused" | "completed" | "failed";

const STATUS_CFG: Record<StatusKey, { label: string; color: string; spinning: boolean }> = {
  idle:      { label: "Bekliyor",      color: "var(--a-text3)",   spinning: false },
  standby:   { label: "Hazır",         color: "var(--a-text3)",   spinning: false },
  active:    { label: "Çalışıyor",     color: "var(--a-accent)",  spinning: true  },
  running:   { label: "Çalışıyor",     color: "var(--a-accent)",  spinning: true  },
  paused:    { label: "Duraklatıldı",  color: "var(--a-warning)", spinning: false },
  completed: { label: "Tamamlandı",    color: "var(--a-success)", spinning: false },
  failed:    { label: "Hata",          color: "var(--a-error)",   spinning: false },
};

function phaseColor(status: string): string {
  if (status === "completed") return "var(--a-success)";
  if (status === "started" || status === "running") return "var(--a-accent)";
  if (status === "failed") return "var(--a-error)";
  return "var(--a-border)";
}

export function PipelineStatusBar() {
  const { pipelineStatus, phases, isPipelineRunning } = usePipelineStore();

  if (!pipelineStatus) return null;

  const statusKey = (pipelineStatus.status.status ?? "idle") as StatusKey;
  const cfg = STATUS_CFG[statusKey] ?? STATUS_CFG.idle;

  const overallProgress = phases.length > 0
    ? Math.round(
        phases.reduce((sum, p) => sum + (p.status === "completed" ? 100 : p.progress ?? 0), 0) / phases.length
      )
    : 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "4px 12px", background: "var(--a-bg2)",
      borderBottom: "1px solid var(--a-border)", flexShrink: 0,
    }}>
      {/* Status indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, color: cfg.color }}>
        {cfg.spinning
          ? <span style={{ fontSize: 10, display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
          : <span style={{ fontSize: 10 }}>◎</span>
        }
        <span style={{ fontSize: 10, fontWeight: 500 }}>{cfg.label}</span>
      </div>

      {/* Phases */}
      {phases.length > 0 && (
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
          <span style={{ color: "var(--a-border)", fontSize: 10 }}>·</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto" }}>
            {phases.map((phase, i) => (
              <div key={phase.name} style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: phaseColor(phase.status),
                  display: "inline-block",
                }} />
                <span style={{
                  fontSize: 9,
                  color: phase.status === "running"
                    ? "var(--a-text)"
                    : "var(--a-text3)",
                }}>
                  {phase.name}
                </span>
                {i < phases.length - 1 && <span style={{ color: "var(--a-text3)", fontSize: 9, opacity: 0.5 }}>›</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {isPipelineRunning && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: "auto" }}>
          <div style={{ width: 40, height: 3, background: "var(--a-bg3)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{
              height: "100%", background: "var(--a-accent)", borderRadius: 99,
              width: `${overallProgress}%`, transition: "width 0.5s ease",
            }} />
          </div>
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--a-accent)", width: 24, textAlign: "right" }}>
            {overallProgress}%
          </span>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
