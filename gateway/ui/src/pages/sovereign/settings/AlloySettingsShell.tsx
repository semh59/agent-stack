/**
 * Alloy Settings shell — the outer chrome for the full settings console.
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
import { Card } from "../../../components/sovereign/primitives";
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
  { id: "providers", label: "Providers", icon: <Cloud size={16} />, sub: "Connect AI Models" },
  { id: "routing", label: "Routing", icon: <Network size={16} />, sub: "Assign models to tasks" },
  { id: "pipeline", label: "Pipeline", icon: <Layers size={16} />, sub: "Processing logic" },
  { id: "mcp", label: "MCP", icon: <Server size={16} />, sub: "Tools & servers" },
  { id: "rules", label: "Rules", icon: <NotebookPen size={16} />, sub: "System instructions" },
  { id: "observability", label: "Analytics", icon: <Gauge size={16} />, sub: "Logs & usage" },
  { id: "data", label: "Data", icon: <Database size={16} />, sub: "Storage" },
  { id: "appearance", label: "Appearance", icon: <Palette size={16} />, sub: "Theme & display" },
  { id: "accounts", label: "Accounts", icon: <Users size={16} />, sub: "Logins/Oauth" },
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
    <div className="flex h-full flex-col bg-[var(--color-alloy-bg)] overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-8 py-6 backdrop-blur-md relative overflow-hidden">
        {/* Animated header background */}
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-alloy-accent)]/5 via-transparent to-transparent opacity-20" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3">
             <div className="h-2 w-2 rounded-full bg-molten animate-pulse shadow-alloy-molten-glow" />
             <h1 className="text-xs font-bold uppercase tracking-[0.3em] text-white">Application Settings</h1>
          </div>
          <p className="mt-1 text-[10px] text-white/30 font-medium tracking-tight">
            Configure your AI coding experience.
          </p>
        </div>
        
        <div className="flex items-center gap-4 relative z-10">
          <button 
            onClick={() => setShowResetConfirm(true)}
            disabled={settingsSaving}
            className="flex items-center gap-2 text-[10px] font-bold text-white/40 hover:text-red-400 transition-colors disabled:opacity-20 uppercase tracking-widest"
          >
            <RotateCcw size={12} />
            Reset to default
          </button>
          
          <div className="h-4 w-[1px] bg-white/10" />
          
          <button 
            onClick={clearSettingsDraft}
            disabled={!isDirty || settingsSaving}
            className="text-[10px] font-bold text-white/40 hover:text-white transition-colors disabled:opacity-20 uppercase tracking-widest"
          >
            Discard
          </button>
          
          <button
            onClick={onSave}
            disabled={!isDirty || settingsSaving}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-6 py-2 text-[10px] font-bold tracking-[0.2em] transition-all active:scale-95 shadow-lg",
              isDirty 
                ? "bg-molten text-black shadow-alloy-molten-glow" 
                : "bg-white/5 text-white/20 cursor-not-allowed border border-white/5"
            )}
          >
            <Save size={14} />
            {isDirty ? `Save Changes (${Object.keys(settingsDraftPatch).length})` : "Saved"}
          </button>
        </div>
      </header>

      {settingsError ? (
        <div className="mx-8 mt-6 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-5 py-3 text-[11px] text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
          <AlertCircle size={14} className="text-red-500" />
          <span className="font-mono tracking-tight uppercase">{settingsError}</span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[280px] shrink-0 flex-col gap-1 border-r border-white/5 bg-black/40 p-4 custom-scrollbar overflow-y-auto">
          <div className="mb-4 px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-white/20">System_Nodes</div>
          
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item.id)}
              className={clsx(
                "group relative flex items-start gap-4 rounded-xl border px-4 py-4 text-left transition-all duration-300",
                active === item.id
                  ? "border-[var(--color-alloy-accent)]/30 bg-[var(--color-alloy-accent)]/10 text-white shadow-[inset_0_0_20px_rgba(0,240,255,0.05)]"
                  : "border-transparent text-white/40 hover:bg-white/[0.03] hover:text-white"
              )}
            >
              {active === item.id && (
                <div className="absolute left-0 top-4 bottom-4 w-[2px] bg-[var(--color-alloy-accent)] shadow-alloy-glow" />
              )}
              
              <span className={clsx(
                "mt-0.5 shrink-0 transition-transform group-hover:scale-110",
                active === item.id ? "text-[var(--color-alloy-accent)]" : "text-white/20"
              )}>
                {item.icon}
              </span>
              
              <div className="min-w-0">
                <span className="block text-xs font-bold tracking-tight uppercase">{t(item.label)}</span>
                <span className={clsx(
                  "block text-[10px] leading-tight mt-1 transition-opacity",
                  active === item.id ? "text-[var(--color-alloy-accent)]/60" : "text-white/10"
                )}>
                  {t(item.sub)}
                </span>
              </div>
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-10 custom-scrollbar bg-black/20">
          <div className="max-w-4xl animate-in fade-in slide-in-from-right-4 duration-500">
            {settingsLoading && !settings ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-white/20">
                 <div className="h-10 w-10 rounded-full border-2 border-t-[var(--color-alloy-accent)] border-white/5 animate-spin mb-4" />
                 <span className="text-[10px] font-bold uppercase tracking-widest">{t("Syncing_State...")}</span>
              </div>
            ) : !settings ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 text-center">
                 <AlertCircle size={32} className="mx-auto mb-4 text-amber-500 opacity-50" />
                 <h3 className="text-sm font-bold uppercase tracking-widest text-amber-200">{t("Node_Offline")}</h3>
                 <p className="mt-2 text-xs text-amber-200/40">{t("The configuration bridge did not respond. Check gateway status.")}</p>
              </div>
            ) : (
              <ActivePage id={active} />
            )}
          </div>
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
            <button className="flex-1 px-4 py-2 bg-white/5 border border-white/5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:bg-white/10 hover:text-white transition-all rounded-lg" onClick={onCancel}>{t("Cancel")}</button>
            <button className="flex-1 px-4 py-2 bg-red-500/20 border border-red-500/20 text-[10px] font-bold uppercase tracking-widest text-red-100 hover:bg-red-500/40 hover:text-white transition-all rounded-lg" onClick={onConfirm}>{t("Reset Everything")}</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
