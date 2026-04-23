import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy AccountPanel — Connect Google (Antigravity) & Claude accounts

   Backend reality (ChatViewProvider.ts):
   • Google accounts  → OAuth via http://127.0.0.1:51122/api/auth/login
                        Tracked in AccountManager, sent as `accounts` msg
   • Claude/Anthropic → Gateway config (gatewayAuthToken env/setting)
                        Available if Anthropic models appear in `models` msg
   ═══════════════════════════════════════════════════════════════════ */
import { useEffect, useCallback } from "react";
import { Trash2, Loader2, Chrome, Bot, RefreshCw, ChevronRight, ShieldCheck, AlertCircle, } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
/* ── Status indicator ─────────────────────────────────────────── */
function LiveDot({ active }) {
    if (!active)
        return _jsx("span", { className: "h-2 w-2 rounded-full bg-[var(--alloy-error)]" });
    return (_jsxs("span", { className: "relative flex h-2 w-2 shrink-0", children: [_jsx("span", { className: "animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--alloy-success)] opacity-60" }), _jsx("span", { className: "relative inline-flex rounded-full h-2 w-2 bg-[var(--alloy-success)]" })] }));
}
/* ── Single Google account row ────────────────────────────────── */
function GoogleAccountRow({ account, onRemove, }) {
    const expiresIn = account.expiresAt
        ? Math.max(0, Math.floor((account.expiresAt - Date.now()) / 1000 / 60))
        : null;
    const isActive = account.status === "active";
    return (_jsxs("div", { className: cn("group flex items-center gap-3 px-3 py-2.5 rounded-lg border", "transition-colors duration-150", isActive
            ? "bg-[rgba(66,133,244,0.06)] border-[rgba(66,133,244,0.18)]"
            : "bg-[rgba(239,68,68,0.06)] border-[rgba(239,68,68,0.15)]"), children: [_jsx("div", { className: "w-7 h-7 rounded-md bg-[var(--alloy-bg-tertiary)] border border-[var(--alloy-border-subtle)] flex items-center justify-center shrink-0", children: _jsx(Chrome, { className: "w-3.5 h-3.5 text-[#4285F4]" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-1.5 mb-0.5", children: [_jsx("span", { className: "text-[11px] font-semibold text-[#4285F4]", children: "Google" }), account.status === "loading" ? (_jsx(Loader2, { className: "w-2.5 h-2.5 animate-spin text-[var(--alloy-text-muted)]" })) : (_jsx(LiveDot, { active: isActive }))] }), _jsx("p", { className: "text-[11px] text-[var(--alloy-text-secondary)] truncate", children: account.email }), expiresIn !== null && isActive && (_jsxs("p", { className: "text-[10px] text-[var(--alloy-text-muted)]", children: ["Token expires in", " ", expiresIn < 60 ? `${expiresIn}m` : `${Math.floor(expiresIn / 60)}h`] })), !isActive && (_jsx("p", { className: "text-[10px] text-[var(--alloy-error)]", children: "Auth failed \u2014 reconnect below" }))] }), _jsx("button", { onClick: () => onRemove(account.email), title: "Remove account", className: cn("opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0", "w-6 h-6 rounded flex items-center justify-center", "text-[var(--alloy-text-muted)] hover:text-[var(--alloy-error)]", "hover:bg-[rgba(239,68,68,0.1)]"), children: _jsx(Trash2, { className: "w-3 h-3" }) })] }));
}
/* ── Add account button card ─────────────────────────────────── */
function AddCard({ icon, label, sublabel, onConnect, isLoading, accent, }) {
    return (_jsxs("button", { onClick: onConnect, disabled: isLoading, className: cn("w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left", "border border-dashed border-[var(--alloy-border-default)]", "bg-[var(--alloy-bg-secondary)]", "hover:bg-[var(--alloy-bg-hover)] hover:border-[var(--alloy-border-strong)]", "transition-all duration-150 active:scale-[0.98]", isLoading && "opacity-50 cursor-not-allowed pointer-events-none"), children: [_jsx("div", { className: cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", accent), children: icon }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-[12px] font-semibold text-[var(--alloy-text-primary)]", children: label }), _jsx("p", { className: "text-[10px] text-[var(--alloy-text-muted)]", children: sublabel })] }), isLoading ? (_jsx(Loader2, { className: "w-3.5 h-3.5 text-[var(--alloy-accent)] animate-spin shrink-0" })) : (_jsx(ChevronRight, { className: "w-3.5 h-3.5 text-[var(--alloy-text-muted)] shrink-0" }))] }));
}
/* ── Claude status card ──────────────────────────────────────── */
function ClaudeStatusCard({ hasAnthropicModels }) {
    return (_jsxs("div", { className: cn("flex items-start gap-3 px-3 py-3 rounded-lg border", hasAnthropicModels
            ? "bg-[rgba(217,119,6,0.06)] border-[rgba(217,119,6,0.2)]"
            : "bg-[var(--alloy-bg-secondary)] border-[var(--alloy-border-default)]"), children: [_jsx("div", { className: "w-8 h-8 rounded-lg bg-[rgba(217,119,6,0.1)] border border-[rgba(217,119,6,0.2)] flex items-center justify-center shrink-0", children: _jsx(Bot, { className: "w-4 h-4 text-[#D97706]" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-1.5 mb-0.5", children: [_jsx("span", { className: "text-[12px] font-semibold text-[#D97706]", children: "Claude" }), hasAnthropicModels ? (_jsxs(_Fragment, { children: [_jsx(LiveDot, { active: true }), _jsx("span", { className: "text-[10px] text-[var(--alloy-success)]", children: "Connected" })] })) : (_jsxs(_Fragment, { children: [_jsx(LiveDot, { active: false }), _jsx("span", { className: "text-[10px] text-[var(--alloy-text-muted)]", children: "Not configured" })] }))] }), _jsx("p", { className: "text-[10px] text-[var(--alloy-text-muted)] leading-relaxed", children: hasAnthropicModels
                            ? "Anthropic API key active via gateway config."
                            : "Set the Anthropic API key in VS Code settings → Alloy AI → Gateway Auth Token, or via the ALLOY_GATEWAY_TOKEN env variable." })] })] }));
}
/* ── Main Panel ──────────────────────────────────────────────── */
export function AccountPanel({ postMessage }) {
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
    const handleRemove = useCallback((email) => {
        postMessage({ type: "removeAccount", payload: email });
        setTimeout(() => postMessage({ type: "getAccounts" }), 400);
    }, [postMessage]);
    const googleAccounts = accounts.filter((a) => a.provider === "google");
    const hasAnthropicModels = availableModels.some((m) => m.provider.toLowerCase().includes("anthropic") || m.provider.toLowerCase() === "anthropic");
    const allGood = googleAccounts.length > 0 && hasAnthropicModels;
    const hasAnyIssue = googleAccounts.some((a) => a.status === "error") || (!hasAnthropicModels && availableModels.length > 0);
    return (_jsxs("div", { className: "flex flex-col h-full bg-[var(--alloy-bg-primary)]", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-[var(--alloy-border-subtle)]", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-[13px] font-semibold text-[var(--alloy-text-primary)]", children: "Accounts" }), _jsx("p", { className: "text-[10px] text-[var(--alloy-text-muted)] mt-0.5", children: googleAccounts.length > 0
                                    ? `${googleAccounts.length} Google account${googleAccounts.length > 1 ? "s" : ""} connected`
                                    : "No accounts connected" })] }), _jsx("button", { onClick: handleRefresh, className: "w-6 h-6 rounded flex items-center justify-center text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)] hover:bg-[var(--alloy-bg-hover)] transition-colors", title: "Refresh", children: _jsx(RefreshCw, { className: "w-3 h-3" }) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-3 space-y-4", children: [allGood && (_jsxs("div", { className: "flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)]", children: [_jsx(ShieldCheck, { className: "w-3.5 h-3.5 text-[var(--alloy-success)] shrink-0" }), _jsx("span", { className: "text-[11px] text-[var(--alloy-success)]", children: "All providers ready" })] })), hasAnyIssue && !allGood && (_jsxs("div", { className: "flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.15)]", children: [_jsx(AlertCircle, { className: "w-3.5 h-3.5 text-[var(--alloy-error)] shrink-0" }), _jsx("span", { className: "text-[11px] text-[var(--alloy-error)]", children: "Some providers need attention" })] })), _jsxs("section", { children: [_jsxs("div", { className: "flex items-center gap-1.5 mb-2", children: [_jsx(Chrome, { className: "w-3 h-3 text-[#4285F4]" }), _jsx("span", { className: "text-[10px] font-semibold uppercase tracking-wider text-[var(--alloy-text-muted)]", children: "Google \u00B7 Antigravity / Gemini" })] }), _jsxs("div", { className: "space-y-1.5", children: [googleAccounts.map((acc) => (_jsx(GoogleAccountRow, { account: acc, onRemove: handleRemove }, acc.email))), _jsx(AddCard, { icon: _jsx(Chrome, { className: "w-4 h-4 text-[#4285F4]" }), label: googleAccounts.length > 0 ? "Add another Google account" : "Sign in with Google", sublabel: "OAuth via Antigravity endpoint \u00B7 opens browser", onConnect: handleAddGoogleAccount, isLoading: isAddingAccount, accent: "bg-[rgba(66,133,244,0.1)] border border-[rgba(66,133,244,0.2)]" })] })] }), _jsxs("section", { children: [_jsxs("div", { className: "flex items-center gap-1.5 mb-2", children: [_jsx(Bot, { className: "w-3 h-3 text-[#D97706]" }), _jsx("span", { className: "text-[10px] font-semibold uppercase tracking-wider text-[var(--alloy-text-muted)]", children: "Claude \u00B7 Anthropic" })] }), _jsx(ClaudeStatusCard, { hasAnthropicModels: hasAnthropicModels }), !hasAnthropicModels && (_jsxs("p", { className: "text-[10px] text-[var(--alloy-text-muted)] px-1 mt-2 leading-relaxed", children: ["Open", " ", _jsx("code", { className: "bg-[var(--alloy-bg-tertiary)] px-1 rounded text-[var(--alloy-text-secondary)]", children: "Settings \u2192 Extensions \u2192 Alloy AI" }), " ", "and set your API key, or set", " ", _jsx("code", { className: "bg-[var(--alloy-bg-tertiary)] px-1 rounded text-[var(--alloy-text-secondary)]", children: "ALLOY_GATEWAY_TOKEN" }), " ", "in your environment."] }))] }), _jsx("div", { className: "rounded-lg bg-[var(--alloy-bg-secondary)] border border-[var(--alloy-border-subtle)] p-3", children: _jsxs("div", { className: "flex items-start gap-2", children: [_jsx(AlertCircle, { className: "w-3 h-3 text-[var(--alloy-text-muted)] mt-0.5 shrink-0" }), _jsx("p", { className: "text-[10px] text-[var(--alloy-text-muted)] leading-relaxed", children: "Google accounts authenticate via OAuth in your browser and are stored securely by the gateway. Tokens refresh automatically." })] }) })] })] }));
}
