/* ═══════════════════════════════════════════════════════════════════
   Alloy ChatShell — Main chat interface orchestrator
   Includes: onboarding gate, context chips, message list, HITL approvals
   ═══════════════════════════════════════════════════════════════════ */

import { useRef, useEffect, useCallback } from "react";
import { Trash2, Wifi, WifiOff, Users, ArrowRight, Chrome, Bot, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { usePipelineStore } from "@/store/pipelineStore";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { FileOpCard } from "./FileOpCard";
import { Button } from "@/components/shared";
import { PipelineStatusBar } from "@/components/pipeline/PipelineStatusBar";

interface ChatShellProps {
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onApprove: (approvalId: string, modified?: string) => void;
  onReject: (approvalId: string, reason?: string) => void;
  onClear: () => void;
}

export function ChatShell({
  onSendMessage,
  onStopStreaming,
  onApprove,
  onReject,
  onClear,
}: ChatShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="flex flex-col h-full bg-[var(--alloy-bg-primary)]">
      {/* Pipeline Status Bar */}
      <PipelineStatusBar />

      {/* Connection banner */}
      {!isConnected && accounts.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 bg-[rgba(239,68,68,0.08)] border-b border-[rgba(239,68,68,0.15)]">
          <WifiOff className="w-3 h-3 text-[var(--alloy-error)]" />
          <span className="text-[11px] text-[var(--alloy-error)]">Disconnected from Gateway</span>
        </div>
      )}

      {/* Messages / Empty state */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {needsSetup ? (
          <OnboardingState onGoToAccounts={() => setActiveView("accounts")} />
        ) : !hasMessages ? (
          <EmptyState onQuickAction={onSendMessage} />
        ) : (
          <div className="flex flex-col py-3 px-2">
            {messages.map((msg, i) => {
              const prev = i > 0 ? messages[i - 1] : null;
              const isSystem = msg.role === "system";
              const prevIsSystem = prev?.role === "system";
              // Collapse spacing between consecutive system notifications
              const gap = isSystem && prevIsSystem ? "mt-0.5" : isSystem ? "mt-2" : "mt-3";
              return (
                <div key={msg.id} className={i === 0 ? "" : gap}>
                  <MessageBubble message={msg} />
                </div>
              );
            })}
            {pendingList.map((approval) => (
              <div key={approval.approvalId} className="mt-3">
                <FileOpCard
                  approval={approval}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer bar */}
      {hasMessages && !needsSetup && (
        <div className="flex items-center justify-between px-3 py-1 border-t border-[var(--alloy-border-subtle)] bg-[var(--alloy-bg-secondary)]">
          <span className="text-[10px] text-[var(--alloy-text-muted)]">
            {messages.length} messages
          </span>
          <Button
            variant="ghost"
            size="xs"
            icon={<Trash2 className="w-3 h-3" />}
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Input — hidden during setup */}
      {!needsSetup && (
        <ChatInput onSend={onSendMessage} onStop={onStopStreaming} />
      )}
    </div>
  );
}

/* ── Onboarding state (shown when no accounts at all) ─────────────── */

function OnboardingState({ onGoToAccounts }: { onGoToAccounts: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-5 py-8 text-center">
      {/* Logo */}
      <div className="relative mb-5">
        <div className="w-14 h-14 rounded-2xl bg-[var(--alloy-accent-subtle)] border border-[var(--alloy-accent-muted)] flex items-center justify-center shadow-[var(--alloy-glow-md)]">
          <span className="text-xl font-bold alloy-text-gradient">A</span>
        </div>
      </div>

      <h2 className="text-[15px] font-semibold text-[var(--alloy-text-primary)] mb-1">
        Connect your first account
      </h2>
      <p className="text-[11px] text-[var(--alloy-text-tertiary)] mb-5 max-w-[240px] leading-relaxed">
        Alloy needs at least one AI provider to start. Connect Google or Claude to begin.
      </p>

      {/* Provider tiles */}
      <div className="flex gap-2 mb-5 w-full max-w-[260px]">
        <div className="flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl bg-[rgba(66,133,244,0.06)] border border-[rgba(66,133,244,0.15)]">
          <Chrome className="w-5 h-5 text-[#4285F4]" />
          <span className="text-[11px] font-medium text-[var(--alloy-text-primary)]">Google</span>
          <span className="text-[9px] text-[var(--alloy-text-muted)]">Gemini · OAuth</span>
        </div>
        <div className="flex items-center text-[var(--alloy-text-muted)] text-[10px]">or</div>
        <div className="flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl bg-[rgba(217,119,6,0.06)] border border-[rgba(217,119,6,0.15)]">
          <Bot className="w-5 h-5 text-[#D97706]" />
          <span className="text-[11px] font-medium text-[var(--alloy-text-primary)]">Claude</span>
          <span className="text-[9px] text-[var(--alloy-text-muted)]">Anthropic · API Key</span>
        </div>
      </div>

      <button
        onClick={onGoToAccounts}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium",
          "bg-[var(--alloy-accent)] text-white",
          "hover:bg-[var(--alloy-accent-hover)] transition-colors duration-150",
          "active:scale-[0.97]"
        )}
      >
        <Users className="w-3.5 h-3.5" />
        Set up accounts
        <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}

/* ── Ready empty state (accounts connected, no messages yet) ──────── */

function EmptyState({ onQuickAction }: { onQuickAction: (text: string) => void }) {
  const { accounts, availableModels } = useChatStore();

  const googleAccounts = accounts.filter((a) => a.provider === "google" && a.status === "active");
  const hasAnthropicModels = availableModels.some((m) =>
    m.provider.toLowerCase().includes("anthropic")
  );

  const quickActions = [
    { icon: "🔧", label: "Refactor", prompt: "Refactor this code for better readability and performance" },
    { icon: "🐛", label: "Debug", prompt: "Help me debug the issue in my current file" },
    { icon: "📝", label: "Tests", prompt: "Generate comprehensive tests for my code" },
    { icon: "🚀", label: "Pipeline", prompt: "Start an autonomous pipeline for this task" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-5 py-6 text-center">
      {/* Logo */}
      <div className="relative mb-4">
        <div className="w-14 h-14 rounded-2xl bg-[var(--alloy-accent-subtle)] border border-[var(--alloy-accent-muted)] flex items-center justify-center shadow-[var(--alloy-glow-md)]">
          <span className="text-xl font-bold alloy-text-gradient">A</span>
        </div>
        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--alloy-success)] flex items-center justify-center">
          <Wifi className="w-2 h-2 text-white" />
        </div>
      </div>

      <h2 className="text-[14px] font-semibold text-[var(--alloy-text-primary)] mb-1">
        <span className="alloy-text-gradient">Alloy</span> is ready
      </h2>

      {/* Provider status chips */}
      <div className="flex items-center gap-1.5 mb-4">
        {googleAccounts.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(66,133,244,0.1)] border border-[rgba(66,133,244,0.2)] text-[#4285F4]">
            <Zap className="w-2.5 h-2.5" />
            {googleAccounts.length > 1 ? `${googleAccounts.length} Google` : "Google"}
          </span>
        )}
        {hasAnthropicModels && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(217,119,6,0.1)] border border-[rgba(217,119,6,0.2)] text-[#D97706]">
            <Zap className="w-2.5 h-2.5" />
            Claude
          </span>
        )}
      </div>

      <p className="text-[11px] text-[var(--alloy-text-tertiary)] mb-4 max-w-[230px] leading-relaxed">
        Ask anything or pick a quick action. Type <code className="px-1 py-0.5 rounded bg-[var(--alloy-bg-tertiary)] text-[var(--alloy-accent)] text-[10px]">@</code> to attach context.
      </p>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-1.5 w-full max-w-[270px]">
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={() => onQuickAction(action.prompt)}
            className={cn(
              "flex items-center gap-2 p-2.5 rounded-lg text-left",
              "bg-[var(--alloy-bg-secondary)] border border-[var(--alloy-border-default)]",
              "hover:bg-[var(--alloy-bg-hover)] hover:border-[var(--alloy-border-strong)]",
              "active:scale-[0.97] transition-all duration-150 cursor-pointer"
            )}
          >
            <span className="text-base">{action.icon}</span>
            <span className="text-[11px] font-medium text-[var(--alloy-text-primary)]">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
