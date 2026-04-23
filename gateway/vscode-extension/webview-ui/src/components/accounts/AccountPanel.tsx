/* ═══════════════════════════════════════════════════════════════════
   Alloy AccountPanel — Connect Google (Antigravity) & Claude accounts

   Backend reality (ChatViewProvider.ts):
   • Google accounts  → OAuth via http://127.0.0.1:51122/api/auth/login
                        Tracked in AccountManager, sent as `accounts` msg
   • Claude/Anthropic → Gateway config (gatewayAuthToken env/setting)
                        Available if Anthropic models appear in `models` msg
   ═══════════════════════════════════════════════════════════════════ */

import { useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  Chrome,
  Bot,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore, type AccountInfo } from "@/store/chatStore";
import type { OutgoingMessage } from "@/lib/vscode";

interface AccountPanelProps {
  postMessage: (msg: OutgoingMessage) => void;
}

/* ── Status indicator ─────────────────────────────────────────── */

function LiveDot({ active }: { active: boolean }) {
  if (!active) return <span className="h-2 w-2 rounded-full bg-[var(--alloy-error)]" />;
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--alloy-success)] opacity-60" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--alloy-success)]" />
    </span>
  );
}

/* ── Single Google account row ────────────────────────────────── */

function GoogleAccountRow({
  account,
  onRemove,
}: {
  account: AccountInfo;
  onRemove: (email: string) => void;
}) {
  const expiresIn = account.expiresAt
    ? Math.max(0, Math.floor((account.expiresAt - Date.now()) / 1000 / 60))
    : null;

  const isActive = account.status === "active";

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-3 py-2.5 rounded-lg border",
        "transition-colors duration-150",
        isActive
          ? "bg-[rgba(66,133,244,0.06)] border-[rgba(66,133,244,0.18)]"
          : "bg-[rgba(239,68,68,0.06)] border-[rgba(239,68,68,0.15)]"
      )}
    >
      {/* Google logo */}
      <div className="w-7 h-7 rounded-md bg-[var(--alloy-bg-tertiary)] border border-[var(--alloy-border-subtle)] flex items-center justify-center shrink-0">
        <Chrome className="w-3.5 h-3.5 text-[#4285F4]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[11px] font-semibold text-[#4285F4]">Google</span>
          {account.status === "loading" ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin text-[var(--alloy-text-muted)]" />
          ) : (
            <LiveDot active={isActive} />
          )}
        </div>
        <p className="text-[11px] text-[var(--alloy-text-secondary)] truncate">{account.email}</p>
        {expiresIn !== null && isActive && (
          <p className="text-[10px] text-[var(--alloy-text-muted)]">
            Token expires in{" "}
            {expiresIn < 60 ? `${expiresIn}m` : `${Math.floor(expiresIn / 60)}h`}
          </p>
        )}
        {!isActive && (
          <p className="text-[10px] text-[var(--alloy-error)]">
            Auth failed — reconnect below
          </p>
        )}
      </div>

      <button
        onClick={() => onRemove(account.email)}
        title="Remove account"
        className={cn(
          "opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0",
          "w-6 h-6 rounded flex items-center justify-center",
          "text-[var(--alloy-text-muted)] hover:text-[var(--alloy-error)]",
          "hover:bg-[rgba(239,68,68,0.1)]"
        )}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

/* ── Add account button card ─────────────────────────────────── */

function AddCard({
  icon,
  label,
  sublabel,
  onConnect,
  isLoading,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  onConnect: () => void;
  isLoading: boolean;
  accent: string;
}) {
  return (
    <button
      onClick={onConnect}
      disabled={isLoading}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left",
        "border border-dashed border-[var(--alloy-border-default)]",
        "bg-[var(--alloy-bg-secondary)]",
        "hover:bg-[var(--alloy-bg-hover)] hover:border-[var(--alloy-border-strong)]",
        "transition-all duration-150 active:scale-[0.98]",
        isLoading && "opacity-50 cursor-not-allowed pointer-events-none"
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
          accent
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-[var(--alloy-text-primary)]">{label}</p>
        <p className="text-[10px] text-[var(--alloy-text-muted)]">{sublabel}</p>
      </div>
      {isLoading ? (
        <Loader2 className="w-3.5 h-3.5 text-[var(--alloy-accent)] animate-spin shrink-0" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 text-[var(--alloy-text-muted)] shrink-0" />
      )}
    </button>
  );
}

/* ── Claude status card ──────────────────────────────────────── */

function ClaudeStatusCard({ hasAnthropicModels }: { hasAnthropicModels: boolean }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-3 py-3 rounded-lg border",
        hasAnthropicModels
          ? "bg-[rgba(217,119,6,0.06)] border-[rgba(217,119,6,0.2)]"
          : "bg-[var(--alloy-bg-secondary)] border-[var(--alloy-border-default)]"
      )}
    >
      <div className="w-8 h-8 rounded-lg bg-[rgba(217,119,6,0.1)] border border-[rgba(217,119,6,0.2)] flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-[#D97706]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[12px] font-semibold text-[#D97706]">Claude</span>
          {hasAnthropicModels ? (
            <>
              <LiveDot active={true} />
              <span className="text-[10px] text-[var(--alloy-success)]">Connected</span>
            </>
          ) : (
            <>
              <LiveDot active={false} />
              <span className="text-[10px] text-[var(--alloy-text-muted)]">Not configured</span>
            </>
          )}
        </div>
        <p className="text-[10px] text-[var(--alloy-text-muted)] leading-relaxed">
          {hasAnthropicModels
            ? "Anthropic API key active via gateway config."
            : "Set the Anthropic API key in VS Code settings → Alloy AI → Gateway Auth Token, or via the ALLOY_GATEWAY_TOKEN env variable."}
        </p>
      </div>
    </div>
  );
}

/* ── Main Panel ──────────────────────────────────────────────── */

export function AccountPanel({ postMessage }: AccountPanelProps) {
  const { accounts, availableModels, isAddingAccount, setAddingAccount } = useChatStore();

  /* Request fresh account list on mount */
  useEffect(() => {
    postMessage({ type: "getAccounts" });
    postMessage({ type: "getModels" });
  }, [postMessage]);

  const handleRefresh = useCallback(() => {
    postMessage({ type: "getAccounts" });
    postMessage({ type: "getModels" });
  }, [postMessage]);

  const handleAddGoogleAccount = useCallback(() => {
    setAddingAccount(true);
    postMessage({ type: "addAccount" });
    // Extension opens browser for Google OAuth.
    // It sends back a "system" or "accounts" message when complete.
  }, [postMessage, setAddingAccount]);

  const handleRemove = useCallback(
    (email: string) => {
      postMessage({ type: "removeAccount", payload: email });
      setTimeout(() => postMessage({ type: "getAccounts" }), 400);
    },
    [postMessage]
  );

  const googleAccounts = accounts.filter((a) => a.provider === "google");
  const hasAnthropicModels = availableModels.some(
    (m) => m.provider.toLowerCase().includes("anthropic") || m.provider.toLowerCase() === "anthropic"
  );

  const allGood = googleAccounts.length > 0 && hasAnthropicModels;
  const hasAnyIssue =
    googleAccounts.some((a) => a.status === "error") || (!hasAnthropicModels && availableModels.length > 0);

  return (
    <div className="flex flex-col h-full bg-[var(--alloy-bg-primary)]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--alloy-border-subtle)]">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--alloy-text-primary)]">
            Accounts
          </h2>
          <p className="text-[10px] text-[var(--alloy-text-muted)] mt-0.5">
            {googleAccounts.length > 0
              ? `${googleAccounts.length} Google account${googleAccounts.length > 1 ? "s" : ""} connected`
              : "No accounts connected"}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)] hover:bg-[var(--alloy-bg-hover)] transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        {/* All good banner */}
        {allGood && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)]">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--alloy-success)] shrink-0" />
            <span className="text-[11px] text-[var(--alloy-success)]">
              All providers ready
            </span>
          </div>
        )}

        {/* Issue banner */}
        {hasAnyIssue && !allGood && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.15)]">
            <AlertCircle className="w-3.5 h-3.5 text-[var(--alloy-error)] shrink-0" />
            <span className="text-[11px] text-[var(--alloy-error)]">
              Some providers need attention
            </span>
          </div>
        )}

        {/* ── Google · Antigravity ── */}
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <Chrome className="w-3 h-3 text-[#4285F4]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--alloy-text-muted)]">
              Google · Antigravity / Gemini
            </span>
          </div>

          <div className="space-y-1.5">
            {googleAccounts.map((acc) => (
              <GoogleAccountRow key={acc.email} account={acc} onRemove={handleRemove} />
            ))}

            <AddCard
              icon={<Chrome className="w-4 h-4 text-[#4285F4]" />}
              label={googleAccounts.length > 0 ? "Add another Google account" : "Sign in with Google"}
              sublabel="OAuth via Antigravity endpoint · opens browser"
              onConnect={handleAddGoogleAccount}
              isLoading={isAddingAccount}
              accent="bg-[rgba(66,133,244,0.1)] border border-[rgba(66,133,244,0.2)]"
            />
          </div>
        </section>

        {/* ── Claude · Anthropic ── */}
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <Bot className="w-3 h-3 text-[#D97706]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--alloy-text-muted)]">
              Claude · Anthropic
            </span>
          </div>

          <ClaudeStatusCard hasAnthropicModels={hasAnthropicModels} />

          {!hasAnthropicModels && (
            <p className="text-[10px] text-[var(--alloy-text-muted)] px-1 mt-2 leading-relaxed">
              Open{" "}
              <code className="bg-[var(--alloy-bg-tertiary)] px-1 rounded text-[var(--alloy-text-secondary)]">
                Settings → Extensions → Alloy AI
              </code>{" "}
              and set your API key, or set{" "}
              <code className="bg-[var(--alloy-bg-tertiary)] px-1 rounded text-[var(--alloy-text-secondary)]">
                ALLOY_GATEWAY_TOKEN
              </code>{" "}
              in your environment.
            </p>
          )}
        </section>

        {/* ── Footer note ── */}
        <div className="rounded-lg bg-[var(--alloy-bg-secondary)] border border-[var(--alloy-border-subtle)] p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3 h-3 text-[var(--alloy-text-muted)] mt-0.5 shrink-0" />
            <p className="text-[10px] text-[var(--alloy-text-muted)] leading-relaxed">
              Google accounts authenticate via OAuth in your browser and are stored securely
              by the gateway. Tokens refresh automatically.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
