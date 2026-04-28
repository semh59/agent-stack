import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Cloud, Network, Layers, Server, NotebookPen,
  Gauge, Database, Palette, RotateCcw, Save, AlertCircle, Users,
} from "lucide-react";

import { useAlloyStore } from "../../../store/alloyStore";
import { useToast } from "../../../components/sovereign/Toast";
import { useTranslation } from "react-i18next";

import { ProvidersPage }    from "./pages/ProvidersPage";
import { RoutingPage }      from "./pages/RoutingPage";
import { PipelinePage }     from "./pages/PipelinePage";
import { McpPage }          from "./pages/McpPage";
import { RulesPage }        from "./pages/RulesPage";
import { ObservabilityPage } from "./pages/ObservabilityPage";
import { DataPage }         from "./pages/DataPage";
import { AppearancePage }   from "./pages/AppearancePage";
import { AccountsPage }     from "./pages/AccountsPage";

type PageId =
  | "providers" | "routing" | "pipeline" | "mcp" | "rules"
  | "observability" | "data" | "appearance" | "accounts";

const NAV: Array<{ id: PageId; label: string; icon: ReactNode; sub: string }> = [
  { id: "providers",    label: "Sağlayıcılar", icon: <Cloud size={16} />,       sub: "AI modelleri bağla" },
  { id: "routing",      label: "Yönlendirme",  icon: <Network size={16} />,     sub: "Model atamaları" },
  { id: "pipeline",     label: "Pipeline",     icon: <Layers size={16} />,      sub: "İşleme mantığı" },
  { id: "mcp",          label: "MCP",          icon: <Server size={16} />,      sub: "Araçlar ve sunucular" },
  { id: "rules",        label: "Kurallar",     icon: <NotebookPen size={16} />, sub: "Sistem talimatları" },
  { id: "observability",label: "Analitik",     icon: <Gauge size={16} />,       sub: "Log ve kullanım" },
  { id: "data",         label: "Veri",         icon: <Database size={16} />,    sub: "Depolama" },
  { id: "appearance",   label: "Görünüm",      icon: <Palette size={16} />,     sub: "Tema ve ekran" },
  { id: "accounts",     label: "Hesaplar",     icon: <Users size={16} />,       sub: "Girişler / OAuth" },
];

export function AlloySettingsShell() {
  const { t } = useTranslation();
  const [active, setActive] = useState<PageId>("providers");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const { notify } = useToast();
  const {
    settings, settingsDraftPatch, settingsLoading, settingsSaving, settingsError,
    loadSettings, saveSettingsDraft, clearSettingsDraft, resetAllSettings,
  } = useAlloyStore();

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const isDirty = useMemo(() => Object.keys(settingsDraftPatch).length > 0, [settingsDraftPatch]);
  const dirtyCount = Object.keys(settingsDraftPatch).length;

  const onSave = async () => {
    try {
      await saveSettingsDraft();
      notify({ tone: "success", title: "Ayarlar kaydedildi", description: "Değişiklikler ağ geçidine uygulandı." });
    } catch (err) {
      notify({ tone: "error", title: "Kaydedilemedi", description: err instanceof Error ? err.message : String(err) });
    }
  };

  const onReset = async () => {
    setShowResetConfirm(false);
    try {
      await resetAllSettings();
      notify({ tone: "warning", title: "Varsayılana sıfırlandı", description: "API anahtarlarını yeniden girin." });
    } catch (err) {
      notify({ tone: "error", title: "Sıfırlama başarısız", description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-alloy-bg)]">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] px-6 py-3">
        <div>
          <h1 className="text-sm font-semibold text-[var(--color-alloy-text)]">Ayarlar</h1>
          <p className="text-xs text-[var(--color-alloy-text-sec)]">Gateway ve model yapılandırması</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={settingsSaving}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-red-600 transition-colors disabled:opacity-40"
          >
            <RotateCcw size={13} />
            Sıfırla
          </button>

          <button
            onClick={clearSettingsDraft}
            disabled={!isDirty || settingsSaving}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            İptal
          </button>

          <button
            onClick={() => void onSave()}
            disabled={!isDirty || settingsSaving}
            className={clsx(
              "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed",
              isDirty
                ? "bg-[var(--color-alloy-accent)] text-white hover:bg-[var(--color-alloy-accent-hover)]"
                : "bg-[var(--color-alloy-surface-hover)] text-[var(--color-alloy-text-dim)]",
            )}
          >
            {settingsSaving
              ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              : <Save size={13} />}
            {isDirty ? `Kaydet (${dirtyCount})` : "Kaydedildi"}
          </button>
        </div>
      </div>

      {/* Error */}
      {settingsError && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} className="shrink-0 text-red-500" />
          {settingsError}
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Nav */}
        <nav className="alloy-scroll w-[220px] shrink-0 overflow-y-auto border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] p-3 space-y-0.5">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item.id)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                active === item.id
                  ? "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]"
                  : "text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)]",
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              <div className="min-w-0">
                <span className="block text-sm font-medium leading-snug">{t(item.label)}</span>
                <span className="block truncate text-[11px] text-[var(--color-alloy-text-dim)]">{t(item.sub)}</span>
              </div>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="alloy-scroll min-w-0 flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl">
            {settingsLoading && !settings ? (
              <div className="flex flex-col items-center justify-center py-24 text-[var(--color-alloy-text-dim)]">
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-alloy-border)] border-t-[var(--color-alloy-accent)]" />
                <span className="text-sm">Yükleniyor…</span>
              </div>
            ) : !settings ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
                <AlertCircle size={28} className="mx-auto mb-3 text-amber-500" />
                <h3 className="text-sm font-semibold text-amber-800">Bağlantı kurulamadı</h3>
                <p className="mt-1 text-xs text-amber-700">Gateway yanıt vermedi. Durumu kontrol edin.</p>
              </div>
            ) : (
              <ActivePage id={active} />
            )}
          </div>
        </div>
      </div>

      {/* Reset confirmation */}
      {showResetConfirm && (
        <ResetConfirmation onConfirm={() => void onReset()} onCancel={() => setShowResetConfirm(false)} />
      )}
    </div>
  );
}

function ActivePage({ id }: { id: PageId }) {
  switch (id) {
    case "providers":    return <ProvidersPage />;
    case "routing":      return <RoutingPage />;
    case "pipeline":     return <PipelinePage />;
    case "mcp":          return <McpPage />;
    case "rules":        return <RulesPage />;
    case "observability": return <ObservabilityPage />;
    case "data":         return <DataPage />;
    case "appearance":   return <AppearancePage />;
    case "accounts":     return <AccountsPage />;
    default: { const _x: never = id; return <>{_x}</>; }
  }
}

function ResetConfirmation({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] p-6 shadow-[var(--shadow-alloy-lg)]">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
          <RotateCcw size={18} className="text-red-600" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-alloy-text)]">Tüm ayarlar sıfırlansın mı?</h3>
        <p className="mt-1 text-sm text-[var(--color-alloy-text-sec)]">
          Tüm API anahtarları, yönlendirme kuralları ve yapılandırmalar silinecek. Bu işlem geri alınamaz.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[var(--color-alloy-border)] px-4 py-2 text-sm font-medium text-[var(--color-alloy-text)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
          >
            İptal
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Sıfırla
          </button>
        </div>
      </div>
    </div>
  );
}
