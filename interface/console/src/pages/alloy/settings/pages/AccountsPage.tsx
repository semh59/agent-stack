import { useState, useEffect } from "react";
import { Section, Button, Badge } from "../../../../components/sovereign/primitives";
import { Users, Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAppStore } from "../../../../store/appStore";
import type { GoogleAccount } from "../../../../store/types";

const PROVIDER_LABELS: Record<string, { label: string; color: string }> = {
  google: { label: "Google", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  anthropic: { label: "Anthropic", color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
  other: { label: "Diğer", color: "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300" },
};

function ProviderBadge({ provider }: { provider?: string }) {
  const info = PROVIDER_LABELS[provider ?? "other"] ?? PROVIDER_LABELS.other;
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${info.color}`}>
      {info.label}
    </span>
  );
}

export function AccountsPage() {
  const { accounts, activeAccount, fetchAccounts, addAccount, removeAccount, selectAccount } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [addingProvider, setAddingProvider] = useState<string | null>(null);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  async function handleAdd(provider: "google" | "claude") {
    setAddingProvider(provider);
    try { await addAccount(provider); } finally { setAddingProvider(null); }
  }

  async function handleRefresh() {
    setLoading(true);
    try { await fetchAccounts(); } finally { setLoading(false); }
  }

  const googleAccounts = accounts.filter((a) => !a.provider || a.provider === "google");
  const anthropicAccounts = accounts.filter((a) => a.provider === "anthropic");
  const otherAccounts = accounts.filter((a) => a.provider && a.provider !== "google" && a.provider !== "anthropic");

  function renderAccountList(list: GoogleAccount[]) {
    return list.map((acc) => (
      <div key={acc.email} className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-alloy-surface-hover)] text-[11px] font-semibold text-[var(--color-alloy-text-sec)]">
          {acc.email.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-medium text-[var(--color-alloy-text)]">{acc.email}</p>
            <ProviderBadge provider={acc.provider} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {acc.isValid
              ? <CheckCircle2 size={11} className="text-[var(--color-alloy-success)]" />
              : <AlertCircle size={11} className="text-[var(--color-alloy-error)]" />}
            <span className="text-[11px] text-[var(--color-alloy-text-sec)]">
              {acc.isValid ? "Aktif" : "Gecersiz"}
            </span>
            {acc.email === activeAccount && (
              <Badge tone="accent" className="ml-1">Seçili</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {acc.email !== activeAccount && (
            <button
              type="button"
              onClick={() => void selectAccount(acc.email)}
              className="rounded-lg border border-[var(--color-alloy-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
            >
              Seç
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
    ));
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Users size={16} />}
        title="Hesaplar"
        description="Birden fazla hesap ekleyerek token maliyetlerini dağıtabilirsiniz."
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
            <Button size="sm" onClick={() => void handleAdd("google")} disabled={addingProvider !== null}>
              {addingProvider === "google" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Google Ekle
            </Button>
            <Button size="sm" onClick={() => void handleAdd("claude")} disabled={addingProvider !== null}>
              {addingProvider === "claude" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Anthropic Ekle
            </Button>
          </div>
        }
      >
        <div className="flex flex-col divide-y divide-[var(--color-alloy-border)]">
          {accounts.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Users size={28} className="text-[var(--color-alloy-text-dim)]" />
              <p className="text-[13px] text-[var(--color-alloy-text-sec)]">Henüz hesap yok</p>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void handleAdd("google")} disabled={addingProvider !== null}>
                  <Plus size={13} />
                  Google Ekle
                </Button>
                <Button size="sm" onClick={() => void handleAdd("claude")} disabled={addingProvider !== null}>
                  <Plus size={13} />
                  Anthropic Ekle
                </Button>
              </div>
            </div>
          )}

          {googleAccounts.length > 0 && (
            <>
              <div className="px-4 py-2 text-[11px] font-semibold text-[var(--color-alloy-text-sec)] uppercase tracking-wider">
                Google Hesapları
              </div>
              {renderAccountList(googleAccounts)}
            </>
          )}

          {anthropicAccounts.length > 0 && (
            <>
              <div className="px-4 py-2 text-[11px] font-semibold text-[var(--color-alloy-text-sec)] uppercase tracking-wider">
                Anthropic Hesapları
              </div>
              {renderAccountList(anthropicAccounts)}
            </>
          )}

          {otherAccounts.length > 0 && (
            <>
              <div className="px-4 py-2 text-[11px] font-semibold text-[var(--color-alloy-text-sec)] uppercase tracking-wider">
                Diğer Hesaplar
              </div>
              {renderAccountList(otherAccounts)}
            </>
          )}
        </div>
      </Section>
    </div>
  );
}