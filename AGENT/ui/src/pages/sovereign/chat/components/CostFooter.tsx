/**
 * CostFooter — sticky bottom ribbon with aggregated session usage.
 *
 * Shows total input / output tokens and (once per-model pricing lands on the
 * server) an estimated USD spend for the session. The "reset" button zeroes
 * the session counters without wiping chat history.
 */
import { Coins, RotateCcw } from "lucide-react";
import { useSovereignStore } from "../../../../store/sovereignStore";

export function CostFooter() {
  const { sessionTokens, sessionCostUsd, clearSessionCost } = useSovereignStore();
  const total = sessionTokens.input + sessionTokens.output;

  return (
    <div className="flex items-center justify-between border-t border-[var(--color-loji-border)] bg-[var(--color-loji-surface)]/80 px-6 py-2 text-[11px] backdrop-blur-sm">
      <div className="flex items-center gap-4 text-[var(--color-loji-text-sec)]">
        <span className="flex items-center gap-1.5">
          <Coins size={11} className="text-[var(--color-loji-accent)]" />
          <span className="font-ui uppercase tracking-widest">Session</span>
        </span>
        <span>
          <span className="text-[var(--color-loji-text-sec)]">input</span>{" "}
          <span className="font-mono text-white">
            {sessionTokens.input.toLocaleString()}
          </span>{" "}
          tok
        </span>
        <span>
          <span className="text-[var(--color-loji-text-sec)]">output</span>{" "}
          <span className="font-mono text-white">
            {sessionTokens.output.toLocaleString()}
          </span>{" "}
          tok
        </span>
        <span>
          <span className="text-[var(--color-loji-text-sec)]">total</span>{" "}
          <span className="font-mono text-white">{total.toLocaleString()}</span>{" "}
          tok
        </span>
        {sessionCostUsd > 0 ? (
          <span>
            <span className="text-[var(--color-loji-text-sec)]">spend</span>{" "}
            <span className="font-mono text-white">
              ${sessionCostUsd.toFixed(4)}
            </span>
          </span>
        ) : null}
      </div>
      {total > 0 ? (
        <button
          type="button"
          onClick={clearSessionCost}
          className="flex items-center gap-1 text-[var(--color-loji-text-sec)] transition-colors hover:text-white"
          title="Reset session counters"
        >
          <RotateCcw size={10} />
          <span>reset</span>
        </button>
      ) : null}
    </div>
  );
}
