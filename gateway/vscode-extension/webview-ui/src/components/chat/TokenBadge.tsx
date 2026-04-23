/* ═══════════════════════════════════════════════════════════════════
   Alloy TokenBadge — Token usage indicator with budget bar
   ═══════════════════════════════════════════════════════════════════ */

import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { formatTokens } from "@/lib/utils";

export function TokenBadge() {
  const { tokenUsage, tokenBudget } = useChatStore();

  if (tokenUsage.total === 0) return null;

  const usagePercent = tokenBudget
    ? Math.min((tokenUsage.total / tokenBudget) * 100, 100)
    : null;

  const isOverBudget = tokenBudget && tokenUsage.total > tokenBudget * 0.8;
  const isCritical = tokenBudget && tokenUsage.total > tokenBudget * 0.95;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--alloy-bg-tertiary)] border border-[var(--alloy-border-subtle)]">
      <Coins
        className={cn(
          "w-3 h-3",
          isCritical
            ? "text-[var(--alloy-error)]"
            : isOverBudget
            ? "text-[var(--alloy-warning)]"
            : "text-[var(--alloy-accent)]"
        )}
      />
      <span
        className={cn(
          "text-[11px] font-mono",
          isCritical
            ? "text-[var(--alloy-error)]"
            : isOverBudget
            ? "text-[var(--alloy-warning)]"
            : "text-[var(--alloy-text-secondary)]"
        )}
      >
        {formatTokens(tokenUsage.total)}
      </span>
      {usagePercent !== null && (
        <div className="w-12 h-1 bg-[var(--alloy-bg-primary)] rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              isCritical
                ? "bg-[var(--alloy-error)]"
                : isOverBudget
                ? "bg-[var(--alloy-warning)]"
                : "bg-[var(--alloy-accent)]"
            )}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      )}
    </div>
  );
}