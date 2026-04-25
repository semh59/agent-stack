import { useState, useEffect } from "react";
import { Section, Button, Badge } from "../../../../components/sovereign/primitives";
import { Users, Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAppStore } from "../../../../store/appStore";

export function AccountsPage() {
  const { accounts, activeAccount, fetchAccounts, addAccount, removeAccount, setActiveAccount } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  async function handleAdd() {
    setAdding(true);
    try { await addAccount(); } finally { setAdding(false); }
  }

  async function handleRefresh() {
    setLoading(true);
    try { await fetchAccounts(); } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Users size={16} />}
        title="Google Hesaplari"
        description="Birden fazla hesap ekleyerek token maliyetlerini dagitabilirsiniz."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--color-alloy-border)] text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <Button size="sm" onClick={() => void handleAdd()} disabled={adding}>
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Hesap ekle
            </Button>
          </div>
        }
      >
        <div className="flex flex-col divide-y divide-[var(--color-alloy-border)]">
          {accounts.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Users size={28} className="text-[var(--color-alloy-text-dim)]" />
              <p className="text-[13px] text-[var(--color-alloy-text-sec)]">Henuz hesap yok</p>
              <Button size="sm" onClick={() => void handleAdd()} disabled={adding}>
                <Plus size={13} />
                Ilk hesabi ekle
              </Button>
            </div>
          )}
          {accounts.map((acc) => (
            <div key={acc.email} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-alloy-surface-hover)] text-[11px] font-semibold text-[var(--color-alloy-text-sec)]">
                {acc.email.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[13px] font-medium text-[var(--color-alloy-text)]">{acc.email}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {acc.isValid
                    ? <CheckCircle2 size={11} className="text-[var(--color-alloy-success)]" />
                    : <AlertCircle size={11} className="text-[var(--color-alloy-error)]" />}
                  <span className="text-[11px] text-[var(--color-alloy-text-sec)]">
                    {acc.isValid ? "Aktif" : "Gecersiz"}
                  </span>
                  {acc.email === activeAccount && (
                    <Badge tone="blue" className="ml-1">Aktif</Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {acc.email !== activeAccount && (
                  <button
                    type="button"
                    onClick={() => setActiveAccount(acc.email)}
                    className="rounded-lg border border-[var(--color-alloy-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
                  >
                    Sec
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void removeAccount(acc.email)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-alloy-text-dim)] hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
