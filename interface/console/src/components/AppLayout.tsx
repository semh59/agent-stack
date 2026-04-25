import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  MessageSquare,
  Zap,
  Clock,
  Settings,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  Layout,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store/appStore";
import { useAlloyStore } from "../store/alloyStore";

const navItems = [
  { icon: Layout,        label: "Projeler", path: "/projects" },
  { icon: MessageSquare, label: "Chat",     path: "/chat" },
  { icon: Zap,           label: "Gorevler", path: "/dashboard" },
  { icon: Clock,         label: "Gecmis",   path: "/pipeline/history" },
  { icon: Settings,      label: "Ayarlar",  path: "/settings" },
];

const FULL_BLEED_PREFIXES = ["/chat", "/settings", "/projects", "/project/"];

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const {
    sidebarOpen,
    toggleSidebar,
    activeAccount,
    theme,
    toggleTheme,
    wsTransportState,
    retryAutonomyTransport,
  } = useAppStore(
    useShallow((s) => ({
      sidebarOpen:            s.sidebarOpen,
      toggleSidebar:          s.toggleSidebar,
      activeAccount:          s.activeAccount,
      theme:                  s.theme,
      toggleTheme:            s.toggleTheme,
      wsTransportState:       s.wsTransportState,
      retryAutonomyTransport: s.retryAutonomyTransport,
    }))
  );

  const location = useLocation();
  const isFullBleed = FULL_BLEED_PREFIXES.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const { initializeWebSocket, fetchAccounts } = useAppStore.getState();
    initializeWebSocket();
    void fetchAccounts();
    const unsub = useAppStore.subscribe(
      (s) => s.activeAccount,
      (acc) => { if (acc) void useAlloyStore.getState().loadSettings(); },
      { fireImmediately: true }
    );
    return unsub;
  }, []);

  const wsOnline = wsTransportState === "connected" || wsTransportState === "open";
  const currentNav = navItems.find((n) => location.pathname.startsWith(n.path));
  const initials = activeAccount
    ? activeAccount.split("@")[0].slice(0, 2).toUpperCase()
    : "?";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-alloy-bg)] text-[var(--color-alloy-text)]">

      {/* Sidebar */}
      <aside className={clsx(
        "flex shrink-0 flex-col border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] transition-[width] duration-200 ease-in-out",
        sidebarOpen ? "w-[220px]" : "w-[60px]",
      )}>
        {/* Logo */}
        <div className="flex h-14 items-center border-b border-[var(--color-alloy-border)] px-3">
          {sidebarOpen ? (
            <>
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-alloy-accent)] text-[11px] font-bold text-white">
                  A
                </div>
                <span className="truncate text-sm font-semibold">Alloy</span>
              </div>
              <button
                onClick={toggleSidebar}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-alloy-text-dim)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)] transition-colors"
                aria-label="Daralt"
              >
                <ChevronLeft size={15} />
              </button>
            </>
          ) : (
            <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-alloy-accent)] text-[11px] font-bold text-white">
              A
            </div>
          )}
        </div>

        {/* Nav links */}
        <nav className="alloy-scroll flex-1 overflow-x-hidden overflow-y-auto px-2 py-3 space-y-0.5">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                title={!sidebarOpen ? item.label : undefined}
                aria-label={item.label}
                className={clsx(
                  "flex items-center rounded-lg py-2 text-sm font-medium transition-colors duration-100",
                  sidebarOpen ? "gap-3 px-3" : "justify-center px-2",
                  active
                    ? "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]"
                    : "text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)]",
                )}
              >
                <item.icon size={17} className="shrink-0" />
                {sidebarOpen && <span className="truncate">{t(item.label)}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Expand button (collapsed only) */}
        {!sidebarOpen && (
          <div className="flex justify-center border-t border-[var(--color-alloy-border)] py-2">
            <button
              onClick={toggleSidebar}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-alloy-text-dim)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)] transition-colors"
              aria-label="Genislet"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        {/* Account footer */}
        <div className={clsx(
          "border-t border-[var(--color-alloy-border)] p-2",
          !sidebarOpen && "flex justify-center",
        )}>
          {sidebarOpen ? (
            <div className="flex items-center gap-2 rounded-lg px-2 py-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface-hover)] text-[11px] font-semibold text-[var(--color-alloy-text-sec)]">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-[var(--color-alloy-text)]">
                  {activeAccount || "Bagli degil"}
                </p>
                <div className="flex items-center gap-1">
                  {wsOnline
                    ? <Wifi size={10} className="text-[var(--color-alloy-success)]" />
                    : <WifiOff size={10} className="text-[var(--color-alloy-error)]" />}
                  <span className="text-[11px] text-[var(--color-alloy-text-dim)]">
                    {wsOnline ? "Bagli" : "Baglanti yok"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface-hover)] text-[11px] font-semibold text-[var(--color-alloy-text-sec)]"
              title={activeAccount || "Bagli degil"}
            >
              {initials}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top header bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] px-5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[var(--color-alloy-text)]">
              {currentNav ? t(currentNav.label) : "Konsol"}
            </span>
            {wsTransportState === "error" && (
              <button
                onClick={retryAutonomyTransport}
                className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
              >
                <WifiOff size={11} />
                Yeniden baglan
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const next = i18n.language === "en" ? "tr" : "en";
                void i18n.changeLanguage(next);
              }}
              className="flex h-8 items-center gap-1 rounded-md border border-[var(--color-alloy-border)] px-2.5 text-xs font-medium text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)] transition-colors"
            >
              {i18n.language.toUpperCase()}
            </button>
            <button
              onClick={toggleTheme}
              aria-label="Temayi degistir"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-alloy-border)] text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-text)] transition-colors"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className={clsx(
          "flex min-h-0 flex-1",
          isFullBleed ? "overflow-hidden" : "flex-col overflow-auto p-6",
        )}>
          {isFullBleed ? (
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <Outlet />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-5xl">
              <Outlet />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
