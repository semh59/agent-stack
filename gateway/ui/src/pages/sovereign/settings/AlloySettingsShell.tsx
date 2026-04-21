/**
 * Alloy Settings shell — the outer chrome for the full settings console.
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Settings                               [Save] [Discard]   │
 *   ├────────────┬───────────────────────────────────────────────┤
 *   │ Providers  │                                               │
 *   │ Routing    │        <active settings page>                 │
 *   │ Pipeline   │                                               │
 *   │ MCP        │                                               │
 *   │ Rules      │                                               │
 *   │ Obs.       │                                               │
 *   │ Data       │                                               │
 *   │ Appearance │                                               │
 *   └────────────┴───────────────────────────────────────────────┘
 *
 * Left rail = navigation. Right column = currently-selected page.
 * Save and discard operate on the shared draft patch in the alloy store.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Cloud,
  Network,
  Layers,
  Server,
  NotebookPen,
  Gauge,
  Database,
  Palette,
  RotateCcw,
  Save,
  AlertCircle,
  Users,
} from "lucide-react";

import { useAlloyStore } from "../../../store/alloyStore";
import { useToast } from "../../../components/sovereign/Toast";
import { Button, Card } from "../../../components/sovereign/primitives";
import { useTranslation } from "react-i18next";

import { ProvidersPage } from "./pages/ProvidersPage";
import { RoutingPage } from "./pages/RoutingPage";
import { PipelinePage } from "./pages/PipelinePage";
import { McpPage } from "./pages/McpPage";
import { RulesPage } from "./pages/RulesPage";
import { ObservabilityPage } from "./pages/ObservabilityPage";
import { DataPage } from "./pages/DataPage";
import { AppearancePage } from "./pages/AppearancePage";
import { AccountsPage } from "./pages/AccountsPage";

type PageId =
  | "providers"
  | "routing"
  | "pipeline"
  | "mcp"
  | "rules"
  | "observability"
  | "data"
  | "appearance"
  | "accounts";

const NAV: Array<{ id: PageId; label: string; icon: ReactNode; sub: string }> = [
  { id: "providers", label: "Providers", icon: <Cloud size={16} />, sub: "Models & API keys" },
  { id: "routing", label: "Routing", icon: <Network size={16} />, sub: "Which model for which role" },
  { id: "pipeline", label: "Pipeline", icon: <Layers size={16} />, sub: "Optimization stack" },
  { id: "mcp", label: "MCP", icon: <Server size={16} />, sub: "Connected servers & tools" },
  { id: "rules", label: "Rules & Prompts", icon: <NotebookPen size={16} />, sub: "System prompt, modes, commands" },
  { id: "observability", label: "Observability", icon: <Gauge size={16} />, sub: "Logs, metrics, traces" },
  { id: "data", label: "Data", icon: <Database size={16} />, sub: "Storage paths" },
  { id: "appearance", label: "Appearance", icon: <Palette size={16} />, sub: "Theme, language, density" },
  { id: "accounts", label: "Accounts", icon: <Users size={16} />, sub: "Authorized credentials" },
];

export function AlloySettingsShell() {
  const { t } = useTranslation();
  const [active, setActive] = useState<PageId>("providers");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const { notify } = useToast();
  const {
    settings,
    settingsDraftPatch,
    settingsLoading,
    settingsSaving,
    settingsError,
    loadSettings,
    saveSettingsDraft,
    clearSettingsDraft,
    resetAllSettings,
  } = useAlloyStore();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const isDirty = useMemo(
    () => Object.keys(settingsDraftPatch).length > 0,
    [settingsDraftPatch],
  );

  const onSave = async () => {
    try {
      await saveSettingsDraft();
      notify({ tone: "success", title: "Settings saved", description: "Changes are now live across the gateway." });
    } catch (err) {
      notify({
        tone: "error",
        title: "Could not save settings",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onReset = async () => {
    setShowResetConfirm(false);
    try {
      await resetAllSettings();
      notify({ tone: "warning", title: t("Reset to defaults"), description: t("Re-enter provider API keys to continue.") });
    } catch (err) {
      notify({
        tone: "error",
        title: t("Reset failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/50 px-6 py-4 backdrop-blur-sm">
        <div>
          <h1 className="font-display text-lg tracking-wide text-white">{t("Alloy Settings")}</h1>
          <p className="text-xs text-[var(--color-alloy-text-sec)]">
            {t("Every knob the console exposes — live-validated, encrypted at rest.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => setShowResetConfirm(true)} disabled={settingsSaving}>
            {t("Reset")}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSettingsDraft} disabled={!isDirty || settingsSaving}>
            {t("Discard")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={14} />}
            onClick={onSave}
            disabled={!isDirty}
            loading={settingsSaving}
          >
            {isDirty ? `${t("Save")} (${Object.keys(settingsDraftPatch).length})` : t("Saved")}
          </Button>
        </div>
      </header>

      {settingsError ? (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          <AlertCircle size={16} />
          {settingsError}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[240px] shrink-0 flex-col gap-1 border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/40 p-3">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item.id)}
              className={clsx(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                active === item.id
                  ? "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)]/10 text-white"
                  : "border-transparent text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-border)] hover:text-white",
              )}
            >
              <span className={clsx("mt-0.5 shrink-0", active === item.id ? "text-[var(--color-alloy-accent)]" : "")}>
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(item.label)}</span>
                <span className="block text-[11px] text-[var(--color-alloy-text-sec)]">{t(item.sub)}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {settingsLoading && !settings ? (
            <Card className="text-sm text-[var(--color-alloy-text-sec)]">{t("Loading settings…")}</Card>
          ) : !settings ? (
            <Card tone="warning" className="text-sm text-amber-200">
              {t("Settings unavailable. The gateway may be starting up.")}
            </Card>
          ) : (
            <ActivePage id={active} />
          )}
        </div>
      </div>

      {showResetConfirm && (
        <ResetConfirmation 
          onConfirm={onReset} 
          onCancel={() => setShowResetConfirm(false)} 
        />
      )}
    </div>
  );
}

function ActivePage({ id }: { id: PageId }) {
  switch (id) {
    case "providers":
      return <ProvidersPage />;
    case "routing":
      return <RoutingPage />;
    case "pipeline":
      return <PipelinePage />;
    case "mcp":
      return <McpPage />;
    case "rules":
      return <RulesPage />;
    case "observability":
      return <ObservabilityPage />;
    case "data":
      return <DataPage />;
    case "appearance":
      return <AppearancePage />;
    case "accounts":
      return <AccountsPage />;
    default: {
      const exhaustive: never = id;
      return <>{exhaustive}</>;
    }
  }
}

function ResetConfirmation({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="max-w-sm border-red-500/40 shadow-2xl animate-in zoom-in-95 duration-200" tone="danger">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-2">
            <RotateCcw size={24} />
          </div>
          <h3 className="text-lg font-display text-white tracking-wide uppercase">{t("Reset All Settings?")}</h3>
          <p className="text-sm text-red-200/70">
            {t("This clears ALL saved API keys, routing rules, and provider configurations. This action cannot be undone.")}
          </p>
          <div className="flex gap-3 w-full pt-4">
            <Button variant="ghost" className="flex-1" onClick={onCancel}>{t("Cancel")}</Button>
            <Button variant="danger" className="flex-1" onClick={onConfirm}>{t("Reset Everything")}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
