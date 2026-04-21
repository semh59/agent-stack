import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FastForward, Pause, Play, Terminal, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { useAppStore } from "../store/appStore";
import { connectLogsWS, stopPipeline } from "../utils/api";
import { GearStatusCard, PhaseStatusCard } from "../components/autonomy/StatusCards";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function ActivePipelineView() {
  const navigate = useNavigate();
  const {
    activeAccount,
    pipelineStatus,
    logs,
    addLog,
    fetchPipelineStatus,
    autonomySession,
    autonomyTimeline,
    gateStatus,
    budgetStatus,
    pauseAutonomySession,
    resumeAutonomySession,
    stopAutonomySession,
  } = useAppStore();
  const { t } = useTranslation();

  const [isPaused, setIsPaused] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = connectLogsWS((data) => {
      const payload = isRecord(data) ? data : {};
      const messageType = typeof payload.type === "string" ? payload.type : "info";
      const phase = typeof payload.phase === "string" ? payload.phase : "";
      const message = typeof payload.message === "string" ? payload.message : "";
      const output = typeof payload.output === "string" ? payload.output : "";

      const logLine = {
        id: Date.now(),
        time: new Date().toLocaleTimeString("en-US", { hour12: false }),
        source: messageType,
        text: phase || message || output,
        type: (messageType === "error" ? "error" : "info") as "info" | "error",
      };
      addLog(logLine);
      fetchPipelineStatus().catch(console.error);
    });

    return () => socket.close();
  }, [addLog, fetchPipelineStatus]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autonomyTimeline]);

  const handlePauseResume = async () => {
    if (!autonomySession) {
      setIsPaused((prev) => !prev);
      return;
    }
    if (autonomySession.state === "paused") {
      await resumeAutonomySession("Resume from active view");
      setIsPaused(false);
      return;
    }
    await pauseAutonomySession("Pause from active view");
    setIsPaused(true);
  };

  const handleStop = async () => {
    if (autonomySession) {
      await stopAutonomySession("Stopped from active view");
      return;
    }
    await stopPipeline();
    setIsPaused(true);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-alloy-bg)]">
      <div className="h-16 border-b border-[var(--color-alloy-border)] flex items-center justify-between px-6 bg-[var(--color-alloy-surface)]">
        <div>
          <h2 className="text-lg font-display text-white flex items-center gap-3">
            <span>{pipelineStatus?.state?.userTask || autonomySession?.id || t("Active Session")}</span>
            <span className="text-xs text-[var(--color-alloy-text-sec)]">
              {autonomySession ? `Autonomy: ${autonomySession.state}` : pipelineStatus?.state?.pipelineStatus ?? "idle"}
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {autonomySession?.reviewStatus === "plan_pending" ? (
            <button
              onClick={() => navigate(`/pipeline/${autonomySession.id}/plan`)}
              className="flex items-center gap-2 text-xs bg-amber-500/5 border border-amber-400/30 text-amber-300 px-3 py-1.5 rounded-md"
            >
              {t("Plan Approval")}
            </button>
          ) : null}
          <button
            onClick={handlePauseResume}
            className="flex items-center gap-2 text-xs bg-[var(--color-alloy-bg)] border border-[var(--color-alloy-border)] px-3 py-1.5 rounded-md"
          >
            {isPaused || autonomySession?.state === "paused" ? (
              <Play size={14} className="text-[var(--color-alloy-success)]" />
            ) : (
              <Pause size={14} className="text-[var(--color-alloy-warning)]" />
            )}
            {isPaused || autonomySession?.state === "paused" ? t("Resume") : t("Pause")}
          </button>
          <button className="flex items-center gap-2 text-xs bg-[var(--color-alloy-bg)] border border-[var(--color-alloy-border)] px-3 py-1.5 rounded-md">
            <FastForward size={14} /> {t("Skip")}
          </button>
          <button
            onClick={handleStop}
            className="flex items-center gap-2 text-xs bg-[var(--color-alloy-bg)] border border-red-900/50 text-red-400 px-3 py-1.5 rounded-md"
          >
            <XCircle size={14} /> {t("Cancel")}
          </button>
          <span className="text-xs text-[var(--color-alloy-text-sec)]">{activeAccount || t("No account")}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[2fr_1fr]">
        <div className="min-h-0 bg-[#0a0a0c] flex flex-col">
          <div className="p-3 border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] text-xs text-[var(--color-alloy-text-sec)] flex items-center gap-2">
            <Terminal size={12} /> {t("LIVE STREAM")}
          </div>

          <div className="flex-1 p-4 overflow-y-auto font-body text-xs space-y-1.5">
            {autonomyTimeline.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <span className="text-[var(--color-alloy-text-sec)] shrink-0 opacity-70">[{new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false })}]</span>
                <span className="font-medium shrink-0 w-24 truncate text-orange-300">[{entry.type}]</span>
                <span className="flex-1 text-gray-300">{entry.message}</span>
              </div>
            ))}

            {logs.map((log) => (
              <div key={log.id} className="flex gap-3">
                <span className="text-[var(--color-alloy-text-sec)] shrink-0 opacity-70">[{log.time}]</span>
                <span className="font-medium shrink-0 w-24 truncate text-[var(--color-alloy-accent)]">[{log.source}]</span>
                <span className={clsx("flex-1", log.type === "error" ? "text-red-400" : "text-gray-300")}>{log.text}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        <div className="border-l border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] p-4 space-y-4">
          <PhaseStatusCard session={autonomySession} />
          <GearStatusCard session={autonomySession} />

          <div>
            <span className="text-xs text-[var(--color-alloy-text-sec)] uppercase">Gate Status</span>
            <p
              className={clsx(
                "mt-2 text-sm border rounded-md px-3 py-2",
                gateStatus?.passed ? "border-green-700/40 text-green-300" : "border-red-700/40 text-red-300",
              )}
            >
              {gateStatus ? (gateStatus.passed ? "Passed" : `Blocked (${gateStatus.blockingIssues.length})`) : "N/A"}
            </p>
          </div>

          <div>
            <span className="text-xs text-[var(--color-alloy-text-sec)] uppercase">Impacted Scopes</span>
            <p className="mt-2 text-sm text-white">{gateStatus?.impactedScopes.join(", ") || "-"}</p>
          </div>

          {gateStatus?.audit ? (
            <div>
              <span className="text-xs text-[var(--color-alloy-text-sec)] uppercase">Audit</span>
              <p className="mt-2 text-sm text-white">
                critical={gateStatus.audit.critical}, high={gateStatus.audit.high}, moderate={gateStatus.audit.moderate}
              </p>
            </div>
          ) : null}

          {budgetStatus ? (
            <div>
              <span className="text-xs text-[var(--color-alloy-text-sec)] uppercase">Budget</span>
              <p className="mt-2 text-sm text-white">
                cycle {budgetStatus.usage.cyclesUsed}/{budgetStatus.limits.maxCycles}, TPM{" "}
                {budgetStatus.usage.currentTPM.toLocaleString()}/{budgetStatus.limits.maxTPM.toLocaleString()}, RPD{" "}
                {budgetStatus.usage.requestsUsed.toLocaleString()}/{budgetStatus.limits.maxRPD.toLocaleString()}
              </p>
              {budgetStatus.warning && !budgetStatus.exceeded ? (
                <p className="mt-1 text-xs text-amber-300">{budgetStatus.warningReason}</p>
              ) : null}
              {budgetStatus.exceeded ? (
                <p className="mt-1 text-xs text-red-400">{budgetStatus.exceedReason}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
