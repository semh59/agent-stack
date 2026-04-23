import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy Webview App — Root component
   Handles ALL message types from ChatViewProvider.ts exactly.
   Provides tabbed navigation: Chat ↔ Accounts.
   ═══════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect } from "react";
import { MessageSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatShell } from "@/components/chat/ChatShell";
import { AccountPanel } from "@/components/accounts/AccountPanel";
import { useVSCodeApi } from "@/hooks/useVSCodeApi";
import { useChatStore } from "@/store/chatStore";
import { usePipelineStore } from "@/store/pipelineStore";
import { uid } from "@/lib/utils";
/* ── Tab bar ──────────────────────────────────────────────────── */
function TabBar() {
    const { activeView, setActiveView, accounts } = useChatStore();
    const hasIssue = accounts.some((a) => a.status === "error");
    const activeCount = accounts.filter((a) => a.status === "active").length;
    return (_jsxs("div", { className: "flex shrink-0 border-b border-[var(--alloy-border-subtle)] bg-[var(--alloy-bg-secondary)]", children: [_jsxs("button", { onClick: () => setActiveView("chat"), className: cn("flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium", "border-b-2 transition-colors duration-150", activeView === "chat"
                    ? "border-[var(--alloy-accent)] text-[var(--alloy-text-primary)]"
                    : "border-transparent text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-secondary)]"), children: [_jsx(MessageSquare, { className: "w-3 h-3" }), "Chat"] }), _jsxs("button", { onClick: () => setActiveView("accounts"), className: cn("relative flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium", "border-b-2 transition-colors duration-150", activeView === "accounts"
                    ? "border-[var(--alloy-accent)] text-[var(--alloy-text-primary)]"
                    : "border-transparent text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-secondary)]"), children: [_jsx(Users, { className: "w-3 h-3" }), "Accounts", hasIssue ? (_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[var(--alloy-error)] absolute top-1.5 right-1" })) : activeCount > 0 ? (_jsx("span", { className: "ml-0.5 px-1 py-0.5 rounded-full bg-[var(--alloy-accent-subtle)] text-[var(--alloy-accent)] text-[9px] font-bold leading-none", children: activeCount })) : (_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[var(--alloy-text-muted)] opacity-40" }))] })] }));
}
/* ── Root App ─────────────────────────────────────────────────── */
export default function App() {
    const chatStore = useChatStore();
    const pipelineStore = usePipelineStore();
    /* ── Incoming messages from extension ──────────────────────── */
    const handleMessage = useCallback((msg) => {
        switch (msg.type) {
            case "agentStart":
                pipelineStore.updatePhase({ phase: msg.agent, status: "started", progress: 0 });
                chatStore.addMessage({
                    id: uid(), sessionId: "", role: "system",
                    content: `▶ ${msg.agent} started (order: ${msg.order})`,
                    timestamp: new Date().toISOString(),
                });
                break;
            case "agentComplete":
                pipelineStore.updatePhase({ phase: msg.agent, status: "completed", progress: 100 });
                chatStore.addMessage({
                    id: uid(), sessionId: "", role: "system",
                    content: `✓ ${msg.agent} completed`,
                    timestamp: new Date().toISOString(),
                });
                break;
            case "rarvPhase":
                pipelineStore.updatePhase({ phase: msg.phase, status: "started", progress: 50 });
                chatStore.addMessage({
                    id: uid(), sessionId: "", role: "system",
                    content: `RARV Phase: ${msg.phase}`,
                    timestamp: new Date().toISOString(),
                });
                break;
            case "log":
                // Gateway internal logs — do NOT pollute the chat UI. Silently dropped.
                break;
            case "system":
                // Only surface meaningful system messages (not repeated token warnings)
                chatStore.addMessage({
                    id: uid(), sessionId: "", role: "system",
                    content: msg.value,
                    timestamp: new Date().toISOString(),
                });
                if (chatStore.isAddingAccount)
                    chatStore.setAddingAccount(false);
                break;
            case "error":
                // Tag with isError so MessageBubble can render it as a red notification
                chatStore.addMessage({
                    id: uid(), sessionId: "", role: "system",
                    content: msg.value,
                    timestamp: new Date().toISOString(),
                    isError: true,
                });
                chatStore.setAddingAccount(false);
                break;
            case "user":
                // Don't double-add — we already add optimistically in handleSend
                break;
            case "approvalRequired":
                chatStore.addApproval({
                    approvalId: msg.id,
                    tool: "file_operation",
                    operation: "write",
                    target: msg.content,
                    autoApproved: false,
                });
                break;
            /* ── Accounts: _sendAccounts sends Google OAuth accounts only.
                  No provider field is included in the payload.
                  All accounts here are google; Claude/Anthropic is
                  handled via gateway config separately.                ── */
            case "accounts": {
                const rawAccounts = Array.isArray(msg.payload) ? msg.payload : [];
                const mapped = rawAccounts.map((a) => {
                    // ChatViewProvider._sendAccounts doesn't send provider — default google
                    const providerStr = String(a.provider ?? "").toLowerCase();
                    const isAnthropic = providerStr.includes("anthropic") || providerStr.includes("claude");
                    return {
                        email: String(a.email ?? ""),
                        provider: isAnthropic ? "anthropic" : "google",
                        expiresAt: Number(a.expiresAt ?? 0),
                        isValid: Boolean(a.isValid ?? a.status === "active"),
                        status: a.status === "active" ? "active"
                            : a.status === "error" ? "error"
                                : "active",
                    };
                });
                chatStore.setAccounts(mapped);
                chatStore.setAddingAccount(false);
                if (mapped.length > 0)
                    chatStore.setConnected(true);
                break;
            }
            case "models":
                if (Array.isArray(msg.payload)) {
                    chatStore.setAvailableModels(msg.payload);
                    chatStore.setConnected(true);
                    if (msg.payload.length > 0 && !chatStore.selectedModel) {
                        chatStore.setSelectedModel(msg.payload[0].id);
                    }
                }
                break;
            case "pipeline_status":
                if (msg.status !== undefined) {
                    pipelineStore.setPipelineStatus({ type: "pipeline_status", status: msg.status });
                }
                break;
            case "authToken":
                chatStore.setConnected(true);
                break;
            case "autonomyEvent":
                chatStore.addMessage({
                    id: uid(), sessionId: msg.sessionId ?? "", role: "system",
                    content: `[Autonomy] ${msg.eventType ?? "event"}`,
                    timestamp: msg.timestamp ?? new Date().toISOString(),
                });
                pipelineStore.addMissionEvent({
                    type: msg.eventType ?? "unknown",
                    sessionId: msg.sessionId,
                    data: msg.payload,
                    timestamp: msg.timestamp ?? new Date().toISOString(),
                });
                break;
            case "modelSwitchEvent":
            case "gateEvent":
            case "budgetEvent":
            case "queueEvent":
                pipelineStore.addMissionEvent({
                    type: msg.type,
                    data: "payload" in msg ? msg.payload : undefined,
                    timestamp: new Date().toISOString(),
                });
                break;
        }
    }, [chatStore, pipelineStore]);
    const { postMessage } = useVSCodeApi(handleMessage);
    /* ── Boot: request initial data immediately on mount ───────── */
    useEffect(() => {
        postMessage({ type: "getAccounts" });
        postMessage({ type: "getModels" });
        postMessage({ type: "getPipelineStatus" });
    }, [postMessage]);
    /* ── Chat handlers ────────────────────────────────────────── */
    const handleSendMessage = useCallback((text) => {
        chatStore.addMessage({
            id: uid(), sessionId: "", role: "user",
            content: text,
            timestamp: new Date().toISOString(),
        });
        postMessage({ type: "sendMessage", value: text });
    }, [chatStore, postMessage]);
    const handleStopStreaming = useCallback(() => {
        chatStore.stopStreaming();
    }, [chatStore]);
    const handleApprove = useCallback((approvalId) => {
        chatStore.removeApproval(approvalId);
        postMessage({ type: "approveAction", actionId: approvalId });
    }, [chatStore, postMessage]);
    const handleReject = useCallback((approvalId) => {
        chatStore.removeApproval(approvalId);
        postMessage({ type: "rejectAction", actionId: approvalId });
    }, [chatStore, postMessage]);
    const handleClear = useCallback(() => {
        chatStore.clearMessages();
    }, [chatStore]);
    /* ── Render ───────────────────────────────────────────────── */
    const { activeView } = chatStore;
    return (_jsxs("div", { className: "flex flex-col h-full bg-[var(--alloy-bg-primary)]", children: [_jsx(TabBar, {}), _jsx("div", { className: "flex-1 min-h-0 overflow-hidden", children: activeView === "chat" ? (_jsx(ChatShell, { onSendMessage: handleSendMessage, onStopStreaming: handleStopStreaming, onApprove: handleApprove, onReject: handleReject, onClear: handleClear })) : (_jsx(AccountPanel, { postMessage: postMessage })) })] }));
}
