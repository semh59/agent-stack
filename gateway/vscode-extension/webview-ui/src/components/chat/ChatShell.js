import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy ChatShell — Main chat interface orchestrator
   Includes: onboarding gate, context chips, message list, HITL approvals
   ═══════════════════════════════════════════════════════════════════ */
import { useRef, useEffect } from "react";
import { Trash2, Wifi, WifiOff, Users, ArrowRight, Chrome, Bot, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { usePipelineStore } from "@/store/pipelineStore";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { FileOpCard } from "./FileOpCard";
import { Button } from "@/components/shared";
import { PipelineStatusBar } from "@/components/pipeline/PipelineStatusBar";
export function ChatShell({ onSendMessage, onStopStreaming, onApprove, onReject, onClear, }) {
    const scrollRef = useRef(null);
    const { messages, pendingApprovals, isConnected, accounts, setActiveView } = useChatStore();
    const { isPipelineRunning } = usePipelineStore();
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);
    const hasMessages = messages.length > 0;
    const pendingList = Array.from(pendingApprovals.values());
    // Show onboarding only when there are truly no accounts AND no gateway models loaded.
    // isConnected becomes true when models load — so a better gate is: no accounts AND no messages at all.
    // This prevents the onboarding from flashing open unnecessarily.
    const needsSetup = accounts.length === 0 && !isConnected && messages.length === 0;
    return (_jsxs("div", { className: "flex flex-col h-full bg-[var(--alloy-bg-primary)]", children: [_jsx(PipelineStatusBar, {}), !isConnected && accounts.length > 0 && (_jsxs("div", { className: "flex items-center gap-2 px-3 py-1 bg-[rgba(239,68,68,0.08)] border-b border-[rgba(239,68,68,0.15)]", children: [_jsx(WifiOff, { className: "w-3 h-3 text-[var(--alloy-error)]" }), _jsx("span", { className: "text-[11px] text-[var(--alloy-error)]", children: "Disconnected from Gateway" })] })), _jsx("div", { ref: scrollRef, className: "flex-1 overflow-y-auto", children: needsSetup ? (_jsx(OnboardingState, { onGoToAccounts: () => setActiveView("accounts") })) : !hasMessages ? (_jsx(EmptyState, { onQuickAction: onSendMessage })) : (_jsxs("div", { className: "flex flex-col py-3 px-2", children: [messages.map((msg, i) => {
                            const prev = i > 0 ? messages[i - 1] : null;
                            const isSystem = msg.role === "system";
                            const prevIsSystem = prev?.role === "system";
                            // Collapse spacing between consecutive system notifications
                            const gap = isSystem && prevIsSystem ? "mt-0.5" : isSystem ? "mt-2" : "mt-3";
                            return (_jsx("div", { className: i === 0 ? "" : gap, children: _jsx(MessageBubble, { message: msg }) }, msg.id));
                        }), pendingList.map((approval) => (_jsx("div", { className: "mt-3", children: _jsx(FileOpCard, { approval: approval, onApprove: onApprove, onReject: onReject }) }, approval.approvalId)))] })) }), hasMessages && !needsSetup && (_jsxs("div", { className: "flex items-center justify-between px-3 py-1 border-t border-[var(--alloy-border-subtle)] bg-[var(--alloy-bg-secondary)]", children: [_jsxs("span", { className: "text-[10px] text-[var(--alloy-text-muted)]", children: [messages.length, " messages"] }), _jsx(Button, { variant: "ghost", size: "xs", icon: _jsx(Trash2, { className: "w-3 h-3" }), onClick: onClear, children: "Clear" })] })), !needsSetup && (_jsx(ChatInput, { onSend: onSendMessage, onStop: onStopStreaming }))] }));
}
/* ── Onboarding state (shown when no accounts at all) ─────────────── */
function OnboardingState({ onGoToAccounts }) {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center h-full px-5 py-8 text-center", children: [_jsx("div", { className: "relative mb-5", children: _jsx("div", { className: "w-14 h-14 rounded-2xl bg-[var(--alloy-accent-subtle)] border border-[var(--alloy-accent-muted)] flex items-center justify-center shadow-[var(--alloy-glow-md)]", children: _jsx("span", { className: "text-xl font-bold alloy-text-gradient", children: "A" }) }) }), _jsx("h2", { className: "text-[15px] font-semibold text-[var(--alloy-text-primary)] mb-1", children: "Connect your first account" }), _jsx("p", { className: "text-[11px] text-[var(--alloy-text-tertiary)] mb-5 max-w-[240px] leading-relaxed", children: "Alloy needs at least one AI provider to start. Connect Google or Claude to begin." }), _jsxs("div", { className: "flex gap-2 mb-5 w-full max-w-[260px]", children: [_jsxs("div", { className: "flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl bg-[rgba(66,133,244,0.06)] border border-[rgba(66,133,244,0.15)]", children: [_jsx(Chrome, { className: "w-5 h-5 text-[#4285F4]" }), _jsx("span", { className: "text-[11px] font-medium text-[var(--alloy-text-primary)]", children: "Google" }), _jsx("span", { className: "text-[9px] text-[var(--alloy-text-muted)]", children: "Gemini \u00B7 OAuth" })] }), _jsx("div", { className: "flex items-center text-[var(--alloy-text-muted)] text-[10px]", children: "or" }), _jsxs("div", { className: "flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl bg-[rgba(217,119,6,0.06)] border border-[rgba(217,119,6,0.15)]", children: [_jsx(Bot, { className: "w-5 h-5 text-[#D97706]" }), _jsx("span", { className: "text-[11px] font-medium text-[var(--alloy-text-primary)]", children: "Claude" }), _jsx("span", { className: "text-[9px] text-[var(--alloy-text-muted)]", children: "Anthropic \u00B7 API Key" })] })] }), _jsxs("button", { onClick: onGoToAccounts, className: cn("flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium", "bg-[var(--alloy-accent)] text-white", "hover:bg-[var(--alloy-accent-hover)] transition-colors duration-150", "active:scale-[0.97]"), children: [_jsx(Users, { className: "w-3.5 h-3.5" }), "Set up accounts", _jsx(ArrowRight, { className: "w-3 h-3" })] })] }));
}
/* ── Ready empty state (accounts connected, no messages yet) ──────── */
function EmptyState({ onQuickAction }) {
    const { accounts, availableModels } = useChatStore();
    const googleAccounts = accounts.filter((a) => a.provider === "google" && a.status === "active");
    const hasAnthropicModels = availableModels.some((m) => m.provider.toLowerCase().includes("anthropic"));
    const quickActions = [
        { icon: "🔧", label: "Refactor", prompt: "Refactor this code for better readability and performance" },
        { icon: "🐛", label: "Debug", prompt: "Help me debug the issue in my current file" },
        { icon: "📝", label: "Tests", prompt: "Generate comprehensive tests for my code" },
        { icon: "🚀", label: "Pipeline", prompt: "Start an autonomous pipeline for this task" },
    ];
    return (_jsxs("div", { className: "flex flex-col items-center justify-center h-full px-5 py-6 text-center", children: [_jsxs("div", { className: "relative mb-4", children: [_jsx("div", { className: "w-14 h-14 rounded-2xl bg-[var(--alloy-accent-subtle)] border border-[var(--alloy-accent-muted)] flex items-center justify-center shadow-[var(--alloy-glow-md)]", children: _jsx("span", { className: "text-xl font-bold alloy-text-gradient", children: "A" }) }), _jsx("div", { className: "absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--alloy-success)] flex items-center justify-center", children: _jsx(Wifi, { className: "w-2 h-2 text-white" }) })] }), _jsxs("h2", { className: "text-[14px] font-semibold text-[var(--alloy-text-primary)] mb-1", children: [_jsx("span", { className: "alloy-text-gradient", children: "Alloy" }), " is ready"] }), _jsxs("div", { className: "flex items-center gap-1.5 mb-4", children: [googleAccounts.length > 0 && (_jsxs("span", { className: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(66,133,244,0.1)] border border-[rgba(66,133,244,0.2)] text-[#4285F4]", children: [_jsx(Zap, { className: "w-2.5 h-2.5" }), googleAccounts.length > 1 ? `${googleAccounts.length} Google` : "Google"] })), hasAnthropicModels && (_jsxs("span", { className: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(217,119,6,0.1)] border border-[rgba(217,119,6,0.2)] text-[#D97706]", children: [_jsx(Zap, { className: "w-2.5 h-2.5" }), "Claude"] }))] }), _jsxs("p", { className: "text-[11px] text-[var(--alloy-text-tertiary)] mb-4 max-w-[230px] leading-relaxed", children: ["Ask anything or pick a quick action. Type ", _jsx("code", { className: "px-1 py-0.5 rounded bg-[var(--alloy-bg-tertiary)] text-[var(--alloy-accent)] text-[10px]", children: "@" }), " to attach context."] }), _jsx("div", { className: "grid grid-cols-2 gap-1.5 w-full max-w-[270px]", children: quickActions.map((action) => (_jsxs("button", { onClick: () => onQuickAction(action.prompt), className: cn("flex items-center gap-2 p-2.5 rounded-lg text-left", "bg-[var(--alloy-bg-secondary)] border border-[var(--alloy-border-default)]", "hover:bg-[var(--alloy-bg-hover)] hover:border-[var(--alloy-border-strong)]", "active:scale-[0.97] transition-all duration-150 cursor-pointer"), children: [_jsx("span", { className: "text-base", children: action.icon }), _jsx("span", { className: "text-[11px] font-medium text-[var(--alloy-text-primary)]", children: action.label })] }, action.label))) })] }));
}
