/**
 * Sovereign Settings shell — the outer chrome for the full settings console.
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
 * Save and discard operate on the shared draft patch in the sovereign store.
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
} from "lucide-react";

import { useSovereignStore } from "../../../store/sovereignStore";
import { useToast } from "../../../components/sovereign/Toast";
import { Button, Card } from "../../../components/sovereign/primitives";

import { ProvidersPage } from "./pages/ProvidersPage";
import { RoutingPage } from "./pages/RoutingPage";
import { PipelinePage } from "./pages/PipelinePage";
import { McpPage } from "./pages/McpPage";
import { RulesPage } from "./pages/RulesPage";
import { ObservabilityPage } from "./pages/ObservabilityPage";
import { DataPage } from "./pages/DataPage";
import { AppearancePage } from "./pages/AppearancePage";

type PageId =
  | "providers"
  | "routing"
  | "pipeline"
  | "mcp"
  | "rules"
  | "observability"
  | "data"
  | "appearance";

const NAV: Array<{ id: PageId; label: string; icon: ReactNode; sub: string }> = [
  { id: "providers", label: "Providers", icon: <Cloud size={16} />, sub: "Models & API keys" },
  { id: "routing", label: "Routing", icon: <Network size={16} />, sub: "Which model for which role" },
  { id: "pipeline", label: "Pipeline", icon: <Layers size={16} />, sub: "Optimization stack" },
  { id: "mcp", label: "MCP", icon: <Server size={16} />, sub: "Connected servers & tools" },
  { id: "rules", label: "Rules & Prompts", icon: <NotebookPen size={16} />, sub: "System prompt, modes, commands" },
  { id: "observability", label: "Observability", icon: <Gauge size={16} />, sub: "Logs, metrics, traces" },
  { id: "data", label: "Data", icon: <Database size={16} />, sub: "Storage paths" },
  { id: "appearance", label: "Appearance", icon: <Palette size={16} />, sub: "Theme, language, density" },
];

export function SovereignSettingsShell() {
  const [active, setActive] = useState<PageId>("providers");
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
  } = useSovereignStore();

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
    if (!window.confirm("Reset ALL settings to defaults? This clears saved API keys and routing.")) return;
    try {
      await resetAllSettings();
      notify({ tone: "warning", title: "Reset to defaults", description: "Re-enter provider API keys to continue." });
    } catch (err) {
      notify({
        tone: "error",
        title: "Reset failed",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-loji-border)] bg-[var(--color-loji-surface)]/50 px-6 py-4 backdrop-blur-sm">
        <div>
          <h1 className="font-display text-lg tracking-wide text-white">Sovereign Settings</h1>
          <p className="text-xs text-[var(--color-loji-text-sec)]">
            Every knob the console exposes — live-validated, encrypted at rest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={onReset} disabled={settingsSaving}>
            Reset
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSettingsDraft} disabled={!isDirty || settingsSaving}>
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={14} />}
            onClick={onSave}
            disabled={!isDirty}
            loading={settingsSaving}
          >
            {isDirty ? `Save (${Object.keys(settingsDraftPatch).length})` : "Saved"}
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
        <nav className="flex w-[240px] shrink-0 flex-col gap-1 border-r border-[var(--color-loji-border)] bg-[var(--color-loji-surface)]/40 p-3">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item.id)}
              className={clsx(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                active === item.id
                  ? "border-[var(--color-loji-accent)]/40 bg-[var(--color-loji-accent)]/10 text-white"
                  : "border-transparent text-[var(--color-loji-text-sec)] hover:bg-[var(--color-loji-border)] hover:text-white",
              )}
            >
              <span className={clsx("mt-0.5 shrink-0", active === item.id ? "text-[var(--color-loji-accent)]" : "")}>
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-[11px] text-[var(--color-loji-text-sec)]">{item.sub}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {settingsLoading && !settings ? (
            <Card className="text-sm text-[var(--color-loji-text-sec)]">Loading settings…</Card>
          ) : !settings ? (
            <Card tone="warning" className="text-sm text-amber-200">
              Settings unavailable. The gateway may be starting up.
            </Card>
          ) : (
            <ActivePage id={active} />
          )}
        </div>
      </div>
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
    default: {
      const exhaustive: never = id;
      return <>{exhaustive}</>;
    }
  }
}
