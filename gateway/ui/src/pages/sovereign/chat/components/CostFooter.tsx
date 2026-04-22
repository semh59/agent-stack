/**
 * CostFooter — sticky bottom ribbon with aggregated session usage.
 *
 * Shows total input / output tokens and (once per-model pricing lands on the
 * server) an estimated USD spend for the session. The "reset" button zeroes
 * the session counters without wiping chat history.
 */
import { Coins, RotateCcw } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";

export function CostFooter() {
  const { sessionTokens, sessionCostUsd, clearSessionCost } = useAlloyStore();
  const total = sessionTokens.input + sessionTokens.output;

  return (
    <div className="flex items-center justify-between border-t border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/80 px-6 py-2 text-[11px] backdrop-blur-sm">
      <div className="flex items-center gap-4 text-[var(--color-alloy-text-sec)]">
        <span className="flex items-center gap-1.5">
          <Coins size={11} className="text-[var(--color-alloy-accent)]" />
          <span className="font-ui uppercase tracking-widest">Session</span>
        </span>
        <span>
          <span className="text-[var(--color-alloy-text-sec)]">input</span>{" "}
          <span className="font-mono text-white">
            {sessionTokens.input.toLocaleString()}
          </span>{" "}
          tok
        </span>
        <span>
          <span className="text-[var(--color-alloy-text-sec)]">output</span>{" "}
          <span className="font-mono text-white">
            {sessionTokens.output.toLocaleString()}
          </span>{" "}
          tok
        </span>
        <span>
          <span className="text-[var(--color-alloy-text-sec)]">total</span>{" "}
          <span className="font-mono text-white">{total.toLocaleString()}</span>{" "}
          tok
        </span>
        {sessionCostUsd > 0 ? (
          <span className="flex items-center gap-1.5 border-l border-white/5 pl-4">
            <span className="text-[var(--color-alloy-text-sec)]">spend</span>{" "}
            <span className="font-mono text-white">
              ${sessionCostUsd.toFixed(4)}
            </span>
          </span>
        ) : null}
        
        {/* Placeholder for granular per-message cost which will be integrated with the ledger API */}
        <span className="text-[10px] text-[var(--color-alloy-text-sec)]/50 italic">
          (transparency ledger active)
        </span>
      </div>
      {total > 0 ? (
        <button
          type="button"
          onClick={clearSessionCost}
          className="flex items-center gap-1 text-[var(--color-alloy-text-sec)] transition-colors hover:text-white"
          title="Reset session counters"
        >
          <RotateCcw size={10} />
          <span>reset</span>
        </button>
      ) : null}
    </div>
  );
}
