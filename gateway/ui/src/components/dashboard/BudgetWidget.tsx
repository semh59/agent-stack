import { clsx } from "clsx";
import { useAppStore } from "../../store/appStore";

export function BudgetWidget() {
  const { activeAccount, accountQuotas } = useAppStore();

  if (!activeAccount) {
    return null;
  }

  const activeQuota = accountQuotas.find((q) => q.email === activeAccount)?.quota;

  if (!activeQuota) {
    return null;
  }

  return (
    <div className="ml-auto flex items-center gap-6">
      {Object.entries(activeQuota).slice(0, 2).map(([key, val]) => (
        <div key={key} className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-gray-500 font-bold uppercase tracking-tighter">
              {key}
            </span>
            <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className={clsx(
                  "h-full transition-all duration-1000",
                  (val.remainingFraction || 0) < 0.2
                    ? "bg-red-500"
                    : (val.remainingFraction || 0) < 0.5
                    ? "bg-yellow-500"
                    : "bg-[var(--color-alloy-accent)]"
                )}
                style={{ width: `${(val.remainingFraction || 0) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
