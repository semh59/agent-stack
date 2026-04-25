import { useEffect, useMemo, useState } from "react";
import { Clock, FileText, Search, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { useAppStore } from "../store/appStore";

export function PipelineHistoryView() {
  const {
    sessionOrder,
    sessionsById,
    activeSessionId,
    selectAutonomySession,
    timelineBySession,
    diffBySession,
    gateBySession,
    fetchAutonomySessions,
  } = useAppStore();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<"logs" | "artifacts">("logs");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchAutonomySessions().catch(console.error);
  }, [fetchAutonomySessions]);

  const sessions = useMemo(
    () =>
      sessionOrder
        .map((id) => sessionsById[id])
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
        .filter((session) => {
          const haystack = `${session.objective} ${session.id} ${session.account}`.toLowerCase();
          return haystack.includes(query.toLowerCase());
        }),
    [sessionOrder, sessionsById, query],
  );

  const selectedId = activeSessionId ?? sessions[0]?.id ?? null;
  const selected = selectedId ? sessionsById[selectedId] ?? null : null;
  const timeline = selectedId ? timelineBySession[selectedId] ?? [] : [];
  const touchedFiles = selectedId ? diffBySession[selectedId] ?? [] : [];
  const gate = selectedId ? gateBySession[selectedId] ?? null : null;

  return (
    <div className="flex h-full gap-6">
      <div className="w-1/3 min-w-[280px] bg-[var(--color-alloy-surface)] border border-[var(--color-alloy-border)] rounded-lg flex flex-col min-h-0">
        <div className="p-4 border-b border-[var(--color-alloy-border)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-alloy-text-sec)]" size={16} />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search sessions...")}
              className="w-full bg-[var(--color-alloy-bg)] border border-[var(--color-alloy-border)] rounded-md pl-9 pr-3 py-2 text-sm text-white"
            />
          </div>
          <p className="mt-3 text-xs text-[var(--color-alloy-text-sec)]">{sessions.length} {t("sessions")}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => selectAutonomySession(session.id)}
              className={clsx(
                "w-full text-left p-4 border-b border-[var(--color-alloy-border)]",
                selectedId === session.id
                  ? "bg-[var(--color-alloy-bg)] border-l-2 border-l-[var(--color-alloy-accent)]"
                  : "border-l-2 border-l-transparent",
              )}
            >
              <div className="flex justify-between items-start gap-2">
                <span className="text-xs text-[var(--color-alloy-text-sec)]">{session.id}</span>
                <span className="text-[10px] uppercase tracking-wide text-[var(--color-alloy-text-sec)]">{session.state}</span>
              </div>
              <p className="mt-1 text-sm text-white line-clamp-2">{session.objective || "-"}</p>
              <p className="mt-2 text-xs text-[var(--color-alloy-text-sec)] flex items-center gap-1">
                <Clock size={12} /> {new Date(session.createdAt).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-[var(--color-alloy-surface)] border border-[var(--color-alloy-border)] rounded-lg flex flex-col min-h-0">
        <div className="h-16 border-b border-[var(--color-alloy-border)] px-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg text-white">{selected?.objective || t("No session selected")}</h2>
            <p className="text-xs text-[var(--color-alloy-text-sec)]">
              {selected ? `${selected.state} • ${selected.account}` : t("No session selected")}
            </p>
          </div>
        </div>

        <div className="flex border-b border-[var(--color-alloy-border)] px-4">
          <button
            type="button"
            onClick={() => setActiveTab("logs")}
            className={clsx(
              "px-4 py-3 text-sm uppercase tracking-wide border-b-2",
              activeTab === "logs"
                ? "border-[var(--color-alloy-accent)] text-[var(--color-alloy-accent)]"
                : "border-transparent text-[var(--color-alloy-text-sec)]",
            )}
          >
            {t("History")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("artifacts")}
            className={clsx(
              "px-4 py-3 text-sm uppercase tracking-wide border-b-2",
              activeTab === "artifacts"
                ? "border-[var(--color-alloy-accent)] text-[var(--color-alloy-accent)]"
                : "border-transparent text-[var(--color-alloy-text-sec)]",
            )}
          >
            {t("Artifacts")}
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto bg-[#0a0a0c] m-4 rounded border border-[var(--color-alloy-border)]">
          {activeTab === "logs" ? (
            <div className="space-y-2 text-xs">
              {timeline.length === 0 ? (
                <div className="h-32 flex flex-col items-center justify-center text-[var(--color-alloy-text-sec)]">
                  <Terminal size={24} />
                  <p className="mt-2">{t("No timeline events yet.")}</p>
                </div>
              ) : (
                timeline.map((entry) => (
                  <div key={entry.id} className="flex gap-3">
                    <span className="text-[var(--color-alloy-text-sec)] shrink-0">
                      {new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                    <span className="text-orange-300 shrink-0 w-28 truncate">{entry.type}</span>
                    <span className="text-gray-300 flex-1">{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--color-alloy-text-sec)] mb-2">{t("Touched Files")}</p>
                {touchedFiles.length === 0 ? <p className="text-sm text-white">{t("No diff payload.")}</p> : null}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {touchedFiles.map((file) => (
                    <div key={file} className="bg-[var(--color-alloy-surface)] border border-[var(--color-alloy-border)] rounded p-2 flex items-center gap-2 text-xs text-white">
                      <FileText size={14} className="text-[var(--color-alloy-text-sec)]" />
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--color-alloy-text-sec)] mb-2">Gate</p>
                {gate ? (
                  <div className={clsx("rounded border p-3 text-xs", gate.passed ? "border-green-800/40 text-green-300" : "border-red-800/40 text-red-300")}>
                    <p>{gate.passed ? t("Passed") : t("Blocked")}</p>
                    {gate.blockingIssues.map((issue) => (
                      <p key={issue} className="mt-1">{issue}</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-white">{t("No gate payload.")}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
