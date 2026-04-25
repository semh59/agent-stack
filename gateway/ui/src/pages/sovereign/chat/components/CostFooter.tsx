import { RotateCcw } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";

export function CostFooter() {
  const { sessionTokens, sessionCostUsd, clearSessionCost } = useAlloyStore();
  const total = sessionTokens.input + sessionTokens.output;

  if (total === 0 && sessionCostUsd === 0) return null;

  return (
    <div className="flex items-center justify-between border-t border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] px-5 py-1.5">
      <div className="flex items-center gap-4 text-xs text-[var(--color-alloy-text-dim)]">
        <span>
          Giriş{" "}
          <span className="font-mono text-[var(--color-alloy-text-sec)]">{sessionTokens.input.toLocaleString()}</span>
        </span>
        <span>
          Çıkış{" "}
          <span className="font-mono text-[var(--color-alloy-text-sec)]">{sessionTokens.output.toLocaleString()}</span>
        </span>
        <span>
          Toplam{" "}
          <span className="font-mono text-[var(--color-alloy-text-sec)]">{total.toLocaleString()}</span>{" "}
          token
        </span>
        {sessionCostUsd > 0 && (
          <span className="border-l border-[var(--color-alloy-border)] pl-4">
            <span className="font-mono text-[var(--color-alloy-text-sec)]">${sessionCostUsd.toFixed(4)}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clearSessionCost}
        title="Sayaçları sıfırla"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--color-alloy-text-dim)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text-sec)] transition-colors"
      >
        <RotateCcw size={11} />
        Sıfırla
      </button>
    </div>
  );
}
