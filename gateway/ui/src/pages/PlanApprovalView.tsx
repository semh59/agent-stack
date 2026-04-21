import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { GearStatusCard, PhaseStatusCard } from "../components/autonomy/StatusCards";

const REQUIRED_PLAN_SECTIONS = [
  "Objective",
  "Scope",
  "Current Phase",
  "Current Model",
  "Proposed Steps",
  "Expected Touch Points",
  "Risks / Gate Expectations",
  "Next Action",
];

function parsePlanSections(plan: string): Array<{ title: string; body: string }> | null {
  const trimmed = plan.trim();
  if (!trimmed.includes("## ")) return null;

  const matches = [...trimmed.matchAll(/^##\s+(.+)$/gm)];
  if (matches.length === 0) return null;

  const sections = matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1]!.index ?? trimmed.length : trimmed.length;
    const block = trimmed.slice(start, end).trim();
    const [headingLine, ...contentLines] = block.split("\n");
    return {
      title: headingLine.replace(/^##\s+/, "").trim(),
      body: contentLines.join("\n").trim(),
    };
  });

  const titles = sections.map((section) => section.title);
  return REQUIRED_PLAN_SECTIONS.every((title) => titles.includes(title)) ? sections : null;
}

function formatBudgetSummary(
  budget:
    | {
        usage: { cyclesUsed: number; currentTPM: number; requestsUsed: number };
        limits: { maxCycles: number; maxTPM: number; maxRPD: number };
      }
    | null
    | undefined,
): string {
  if (!budget) return "Budget verisi bekleniyor.";
  return `Cycle ${budget.usage.cyclesUsed}/${budget.limits.maxCycles} • TPM ${budget.usage.currentTPM.toLocaleString()}/${budget.limits.maxTPM.toLocaleString()} • RPD ${budget.usage.requestsUsed.toLocaleString()}/${budget.limits.maxRPD.toLocaleString()}`;
}

export function PlanApprovalView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    gatewayToken,
    activeAccount,
    sessionsById,
    planArtifactsBySession,
    budgetBySession,
    gateBySession,
    diffBySession,
    selectAutonomySession,
    fetchAutonomySessionDetail,
    fetchAutonomyArtifacts,
    approveAutonomyPlan,
    rejectAutonomyPlan,
  } = useAppStore();

  const authMissing = !gatewayToken && !activeAccount;
  const [loading, setLoading] = useState(!authMissing);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);

  const sessionId = id ?? null;
  const session = sessionId ? sessionsById[sessionId] ?? null : null;
  const artifacts = sessionId ? planArtifactsBySession[sessionId] ?? null : null;
  const budget = sessionId ? budgetBySession[sessionId] ?? null : null;
  const gate = sessionId ? gateBySession[sessionId] ?? null : null;
  const touchedFiles = sessionId ? diffBySession[sessionId] ?? [] : [];

  const structuredPlan = useMemo(() => parsePlanSections(artifacts?.plan ?? ""), [artifacts?.plan]);
  const readOnlyReview = session?.reviewStatus !== "plan_pending";
  const hasPlan = Boolean(artifacts?.plan?.trim());

  useEffect(() => {
    if (authMissing) {
      return;
    }
    if (!sessionId) {
      setScreenError("Session ID is required for the plan view.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    selectAutonomySession(sessionId);
    setLoading(true);
    setScreenError(null);

    void Promise.all([
      fetchAutonomySessionDetail(sessionId),
      fetchAutonomyArtifacts(sessionId),
    ])
      .catch((error) => {
        if (!cancelled) {
          setScreenError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authMissing, fetchAutonomyArtifacts, fetchAutonomySessionDetail, selectAutonomySession, sessionId]);

  const handleApprove = async () => {
    if (!sessionId || !hasPlan) return;
    setPendingAction("approve");
    setScreenError(null);
    try {
      await approveAutonomyPlan(sessionId);
      navigate(`/pipeline/${sessionId}`);
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async () => {
    if (!sessionId) return;
    setPendingAction("reject");
    setScreenError(null);
    try {
      await rejectAutonomyPlan(sessionId, "Plan rejected from review screen");
      navigate("/pipeline/history");
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  if (authMissing) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-200">
        Gateway token veya aktif hesap bulunamadi. Plan onay ekranı auth olmadan kullanilamaz.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-white/10 bg-black/20">
        <div className="flex items-center gap-3 text-sm text-[var(--color-alloy-text-sec)]">
          <Loader2 className="animate-spin" size={18} />
          Plan verisi yukleniyor...
        </div>
      </div>
    );
  }

  if (screenError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
        <div className="text-sm font-semibold text-red-200">Plan ekrani yuklenemedi</div>
        <p className="mt-2 text-sm text-red-100/80">{screenError}</p>
        <button
          type="button"
          onClick={() => sessionId && void Promise.all([fetchAutonomySessionDetail(sessionId), fetchAutonomyArtifacts(sessionId)])}
          className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-white"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-[var(--color-alloy-text-sec)]">
        Session detayi bulunamadi.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-black/20 p-6 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.35em] text-[var(--color-alloy-text-sec)]">
              Plan Onay Ekrani
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">{session.objective || "Mission objective bekleniyor"}</h2>
            <p className="mt-2 text-sm text-[var(--color-alloy-text-sec)]">
              Session: {session.id} • Account: {session.account || "N/A"} • Review: {session.reviewStatus}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(`/pipeline/${session.id}`)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-white"
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={!hasPlan || readOnlyReview || pendingAction !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "approve" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Approve
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={readOnlyReview || pendingAction !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "reject" ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
              Reject
            </button>
          </div>
        </div>

        {readOnlyReview ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
            Bu session review beklemiyor. Mevcut durum: <strong>{session.reviewStatus}</strong>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PhaseStatusCard session={session} />
            <GearStatusCard session={session} />
          </div>

          <section className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <div className="mb-4 text-[10px] font-black uppercase tracking-[0.35em] text-[var(--color-alloy-text-sec)]">
              Plan Summary
            </div>
            {!hasPlan ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[var(--color-alloy-text-sec)]">
                Plan artifact bulunamadi. Approve aksiyonu bu durumda kapali kalir.
              </div>
            ) : structuredPlan ? (
              <div className="space-y-4">
                {structuredPlan.map((section) => (
                  <article key={section.title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-white">{section.title}</h3>
                    <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--color-alloy-text-sec)]">
                      {section.body}
                    </pre>
                  </article>
                ))}
              </div>
            ) : (
              <pre className="rounded-2xl border border-white/10 bg-black/20 p-4 whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--color-alloy-text-sec)]">
                {artifacts?.plan}
              </pre>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <div className="text-[10px] font-black uppercase tracking-[0.35em] text-[var(--color-alloy-text-sec)]">
              Quick Facts
            </div>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--color-alloy-text-sec)]">Budget</div>
                <p className="mt-2 text-white">{formatBudgetSummary(budget)}</p>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--color-alloy-text-sec)]">Gate</div>
                <p className="mt-2 text-white">
                  {gate ? (gate.passed ? "Passed" : `Blocked (${gate.blockingIssues.length})`) : "Gate sonucu bekleniyor."}
                </p>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--color-alloy-text-sec)]">Touched Areas</div>
                <ul className="mt-2 space-y-2 text-[var(--color-alloy-text-sec)]">
                  {(touchedFiles.length > 0 ? touchedFiles : ["No touched files yet."]).map((filePath) => (
                    <li key={filePath} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs">
                      {filePath}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <div className="text-[10px] font-black uppercase tracking-[0.35em] text-[var(--color-alloy-text-sec)]">
              Session Meta
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-[10px] font-black uppercase tracking-widest text-[var(--color-alloy-text-sec)]">Updated</dt>
                <dd className="mt-1 text-white">{session.updatedAt}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-black uppercase tracking-widest text-[var(--color-alloy-text-sec)]">Review Updated</dt>
                <dd className="mt-1 text-white">{session.reviewUpdatedAt ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-black uppercase tracking-widest text-[var(--color-alloy-text-sec)]">Branch</dt>
                <dd className="mt-1 text-white">{session.branchName ?? "patch_only"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
