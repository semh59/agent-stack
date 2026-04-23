import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  Zap,
  Menu,
  Globe,
  Sun,
  Moon,
  Activity,
  Shield,
  Terminal,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store/appStore";
import { useAlloyStore } from "../store/alloyStore";

const navItems = [
  { icon: Terminal, label: "Chat", path: "/chat" },
  { icon: Zap, label: "Start Task", path: "/dashboard" },
  { icon: Activity, label: "History", path: "/pipeline/history" },
  { icon: Shield, label: "Settings", path: "/settings" },
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
          "flex flex-col border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          sidebarOpen ? "w-[240px]" : "w-[68px]",
        )}
      >
        <div className="flex h-[64px] items-center border-b border-[var(--color-alloy-border)] px-5">
          <button
            onClick={toggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-alloy-text-sec)] transition-all hover:bg-[var(--color-alloy-accent-dim)] hover:text-[var(--color-alloy-accent)] group"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <Menu size={20} className="group-hover:scale-110 transition-transform" />
          </button>
          
          {sidebarOpen && (
            <div className="ml-4 flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
               <div className="relative">
                 <div className="flex h-7 w-7 items-center justify-center rounded bg-molten text-[11px] font-black text-black shadow-alloy-molten-glow border border-white/20">
                   Λ
                 </div>
                 <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[var(--color-alloy-surface)] bg-emerald-500 animate-pulse" />
               </div>
               <div className="flex flex-col">
                 <span className="font-display text-sm font-black tracking-[0.25em] text-white leading-tight">ALLOY</span>
                 <span className="text-[8px] font-bold text-white/30 tracking-widest uppercase">AI Engine</span>
               </div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-2 alloy-scroll overflow-x-hidden overflow-y-auto px-3 py-6">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={clsx(
                  "group relative flex items-center rounded-lg py-2.5 transition-all duration-200",
                  sidebarOpen ? "px-3" : "justify-center",
                  isActive
                    ? "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)] shadow-[inset_0_0_12px_rgba(0,240,255,0.05)] border border-[var(--color-alloy-accent)]/20"
                    : "text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-white border border-transparent",
                )}
                title={!sidebarOpen ? item.label : undefined}
                aria-label={item.label}
              >
                {isActive && (
                  <div className="absolute left-[-4px] h-5 w-[4px] rounded-r bg-[var(--color-alloy-accent)] shadow-alloy-glow" />
                )}
                <item.icon size={18} className={clsx("shrink-0 transition-transform group-hover:scale-110", isActive ? "text-[var(--color-alloy-accent)]" : "opacity-50 group-hover:opacity-100")} />
                {sidebarOpen ? <span className="ml-4 truncate text-[11px] font-black uppercase tracking-widest">{t(item.label)}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-[var(--color-alloy-border)] p-4">
          {sidebarOpen ? (
            <div className="flex flex-col rounded-xl bg-black/40 p-3 border border-white/10 shadow-inner">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-alloy-molten-glow" />
                <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">Status</span>
              </div>
              <span className="truncate text-[11px] font-mono text-white/90" title={activeAccount || t("No account")}>
                {activeAccount || "Not Connected"}
              </span>
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-[var(--color-alloy-surface-hover)] text-xs font-black uppercase text-white shadow-lg transition-transform hover:scale-105 active:scale-95">
              {activeAccount ? activeAccount[0] : "!"}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-alloy-bg)]">
        <header className="flex h-[64px] items-center justify-between border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/60 px-8 backdrop-blur-xl z-20">
          <div className="flex flex-col">
            <h1 className="font-display text-sm uppercase tracking-[0.2em] text-white/40">
              Workspace &gt; <span className="text-[var(--color-alloy-accent)] text-shadow-glow">{t(navItems.find((n) => location.pathname.startsWith(n.path))?.label || "Console")}</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-3 rounded-full border border-white/5 bg-black/40 px-4 py-1.5 text-[10px] font-bold tracking-widest text-white/60">
              <div className="h-2 w-2 animate-pulse-cyan rounded-full bg-[var(--color-alloy-accent)] shadow-alloy-glow" />
              ENGINE ONLINE
            </div>
            
            <div className="h-4 w-[1px] bg-white/10" />

            <button
              onClick={toggleLanguage}
              className="rounded-lg border border-white/5 bg-[var(--color-alloy-surface)] p-2 text-[var(--color-alloy-text-sec)] transition-all hover:bg-[var(--color-alloy-surface-hover)] hover:text-white"
            >
              <div className="flex items-center gap-1.5">
                <Globe size={14} className="opacity-70" />
                <span className="text-[10px] font-bold uppercase tracking-tight">{i18n.language}</span>
              </div>
            </button>
            
            <button
              onClick={toggleTheme}
              className="rounded-lg border border-white/5 bg-[var(--color-alloy-surface)] p-2 text-[var(--color-alloy-text-sec)] transition-all hover:bg-[var(--color-alloy-surface-hover)] hover:text-white"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
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
