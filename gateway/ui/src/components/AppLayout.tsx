import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  MessageSquare,
  Zap,
  History,
  Settings,
  Menu,
  Globe,
  Sun,
  Moon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store/appStore";
import { useAlloyStore } from "../store/alloyStore";

const navItems = [
  { icon: MessageSquare, label: "Chat", path: "/chat" },
  { icon: Zap, label: "New Mission", path: "/dashboard" },
  { icon: History, label: "Mission History", path: "/pipeline/history" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

/**
 * Routes that want full-bleed layout (no surrounding padding, no outer
 * scroll container). These views manage their own scrolling internally.
 */
const FULL_BLEED_PREFIXES = ["/chat", "/settings"];

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const {
    sidebarOpen,
    toggleSidebar,
    activeAccount,
    theme,
    toggleTheme,
    stats,
    activeSessionId,
    autonomySessionId,
    snapshotMetaBySession,
    wsTransportState,
    wsFatalError,
    retryAutonomyTransport,
  } = useAppStore(
    useShallow((state) => ({
      sidebarOpen: state.sidebarOpen,
      toggleSidebar: state.toggleSidebar,
      activeAccount: state.activeAccount,
      theme: state.theme,
      toggleTheme: state.toggleTheme,
      stats: state.stats,
      activeSessionId: state.activeSessionId,
      autonomySessionId: state.autonomySessionId,
      snapshotMetaBySession: state.snapshotMetaBySession,
      wsTransportState: state.wsTransportState,
      wsFatalError: state.wsFatalError,
      retryAutonomyTransport: state.retryAutonomyTransport,
    }))
  );
  const location = useLocation();
  const selectedSessionId = activeSessionId ?? autonomySessionId;
  const snapshotMeta = selectedSessionId ? snapshotMetaBySession[selectedSessionId] ?? null : null;
  const isFullBleed = FULL_BLEED_PREFIXES.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const { initializeWebSocket, fetchAccounts } = useAppStore.getState();
    initializeWebSocket();
    void fetchAccounts();

    // Store Bridge: Sync alloyStore settings if account changes
    const unsub = useAppStore.subscribe(
      (state) => state.activeAccount,
      (activeAccount) => {
        if (activeAccount) {
          void useAlloyStore.getState().loadSettings();
        }
      },
      { fireImmediately: true }
    );
    return unsub;
  }, []);

  const toggleLanguage = () => {
    const next = i18n.language === "en" ? "tr" : "en";
    void i18n.changeLanguage(next);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-alloy-bg)] text-[var(--color-alloy-text)]">
      <aside
        className={clsx(
          "flex flex-col border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] transition-all duration-300",
          sidebarOpen ? "w-[260px]" : "w-[60px]",
        )}
      >
        <div className="flex h-[60px] items-center border-b border-[var(--color-alloy-border)] px-4">
          <button
            onClick={toggleSidebar}
            className="rounded p-1 text-[var(--color-alloy-text-sec)] transition-colors hover:bg-[var(--color-alloy-border)] hover:text-white"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <Menu size={20} />
          </button>
          {sidebarOpen ? <span className="ml-3 font-display text-lg tracking-wider text-white">ALLOY</span> : null}
        </div>

        <nav className="flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-2 py-4">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={clsx(
                  "group flex items-center rounded-md border px-2 py-2 transition-colors",
                  isActive
                    ? "border-[var(--color-alloy-accent)]/20 bg-[var(--color-alloy-accent)]/10 text-[var(--color-alloy-accent)]"
                    : "border-transparent text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-border)] hover:text-white",
                )}
                title={!sidebarOpen ? item.label : undefined}
                aria-label={item.label}
              >
                <item.icon size={18} className="shrink-0" />
                {sidebarOpen ? <span className="ml-3 whitespace-nowrap text-sm font-ui">{t(item.label)}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-[var(--color-alloy-border)] p-4">
          {sidebarOpen ? (
            <div className="flex flex-col">
              <span className="truncate text-sm font-medium text-white" title={activeAccount || t("No account")}>
                {activeAccount || t("No account")}
              </span>
              {stats?.accounts ? (
                <span className="mt-1 text-xs tracking-wider text-[var(--color-alloy-success)]">
                   {t("System Ready")}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-alloy-success)] bg-[var(--color-alloy-border)] text-xs font-bold uppercase text-white">
              {activeAccount ? activeAccount[0] : "?"}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-alloy-bg)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/50 px-6 backdrop-blur-sm">
          <h1 className="font-display text-lg tracking-wide text-white underline decoration-[var(--color-alloy-accent)]/30 decoration-2 underline-offset-8">
            {location.pathname.includes("/pipeline/") && location.pathname.endsWith("/plan")
              ? t("Plan Approval")
              : t(navItems.find((n) => location.pathname.startsWith(n.path))?.label || "Workspace")}
          </h1>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 rounded-full border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-3 py-1 text-xs text-[var(--color-alloy-text-sec)]">
              <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-alloy-success)]" />
              {t("SYSTEM ONLINE")}
            </span>
            <button
              onClick={toggleLanguage}
              className="rounded-full border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] p-2 text-[var(--color-alloy-text-sec)] transition-colors hover:text-white"
              aria-label="Toggle language"
            >
              <div className="flex items-center gap-1">
                <Globe size={16} />
                <span className="text-[10px] font-bold uppercase">{i18n.language}</span>
              </div>
            </button>
            <button
              onClick={toggleTheme}
              className="rounded-full border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] p-2 text-[var(--color-alloy-text-sec)] transition-colors hover:text-white"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <div
          className={clsx(
            "flex min-h-0 flex-1",
            isFullBleed ? "overflow-hidden" : "flex-col overflow-auto p-6",
          )}
        >
          {isFullBleed ? (
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <Outlet />
            </div>
          ) : (
            <>
          {snapshotMeta?.truncated ? (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {t("Snapshot limited. Showing latest state; some older logs or artifacts might have been pruned.")}
            </div>
          ) : null}

          {wsTransportState === "fatal" && wsFatalError ? (
            <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-950/60 p-6 text-white shadow-[0_20px_80px_rgba(120,0,0,0.25)]">
              <h2 className="text-lg font-semibold tracking-tight">{t("Transport Failure")}</h2>
              <p className="mt-2 text-sm text-red-100/90">
                {wsFatalError.message}
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={retryAutonomyTransport}
                  className="rounded-lg border border-red-300/30 bg-red-500/20 px-4 py-2 text-sm text-white transition hover:bg-red-500/30"
                >
                  {t("Retry Connection")}
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10"
                >
                  {t("Reload UI")}
                </button>
              </div>
            </div>
          ) : null}
          <Outlet />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
