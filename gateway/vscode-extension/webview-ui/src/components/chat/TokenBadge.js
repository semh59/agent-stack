import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy TokenBadge — Token usage indicator with budget bar
   ═══════════════════════════════════════════════════════════════════ */
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { formatTokens } from "@/lib/utils";
export function TokenBadge() {
    const { tokenUsage, tokenBudget } = useChatStore();
    if (tokenUsage.total === 0)
        return null;
    const usagePercent = tokenBudget
        ? Math.min((tokenUsage.total / tokenBudget) * 100, 100)
        : null;
    const isOverBudget = tokenBudget && tokenUsage.total > tokenBudget * 0.8;
    const isCritical = tokenBudget && tokenUsage.total > tokenBudget * 0.95;
    return (_jsxs("div", { className: "flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--alloy-bg-tertiary)] border border-[var(--alloy-border-subtle)]", children: [_jsx(Coins, { className: cn("w-3 h-3", isCritical
                    ? "text-[var(--alloy-error)]"
                    : isOverBudget
                        ? "text-[var(--alloy-warning)]"
                        : "text-[var(--alloy-accent)]") }), _jsx("span", { className: cn("text-[11px] font-mono", isCritical
                    ? "text-[var(--alloy-error)]"
                    : isOverBudget
                        ? "text-[var(--alloy-warning)]"
                        : "text-[var(--alloy-text-secondary)]"), children: formatTokens(tokenUsage.total) }), usagePercent !== null && (_jsx("div", { className: "w-12 h-1 bg-[var(--alloy-bg-primary)] rounded-full overflow-hidden", children: _jsx("div", { className: cn("h-full rounded-full transition-all duration-300", isCritical
                        ? "bg-[var(--alloy-error)]"
                        : isOverBudget
                            ? "bg-[var(--alloy-warning)]"
                            : "bg-[var(--alloy-accent)]"), style: { width: `${usagePercent}%` } }) }))] }));
}
