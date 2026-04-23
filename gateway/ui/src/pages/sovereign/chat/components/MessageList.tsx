/**
 * MessageList — the scrollable feed of user / assistant turns.
 *
 * Auto-scrolls to the bottom whenever a new message lands or the pending
 * placeholder resolves. Each turn shows a role label, the rendered body, and a
 * footer with latency + token counts (assistant only).
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Bot, Sparkles, User as UserIcon } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";
import { FormattedMessage } from "./message-format";
import { ChevronDown, ChevronUp, History } from "lucide-react";

function ThoughtBlock({ content }: { content: string }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-[var(--color-alloy-accent)]/20 bg-black/40 shadow-inner">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-[var(--color-alloy-accent)]/5 transition-all group"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <History size={12} className="text-[var(--color-alloy-accent)]" />
            {isOpen && <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[var(--color-alloy-accent)] animate-ping" />}
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--color-alloy-accent)]/60 group-hover:text-[var(--color-alloy-accent)]">
            Thought Process
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-white/10 uppercase tracking-widest">{isOpen ? "COLLAPSE" : "EXPAND"}</span>
          {isOpen ? <ChevronUp size={12} className="text-[var(--color-alloy-accent)]" /> : <ChevronDown size={12} className="opacity-40" />}
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-white/5 p-5 font-mono text-[11px] leading-relaxed text-white/50 bg-black/40 animate-in fade-in slide-in-from-top-1 duration-300">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-black text-[var(--color-alloy-accent)] opacity-30">
            <span className="animate-pulse">&gt;</span> KERNEL_HEURISTICS_ACTIVE
          </div>
          {content}
        </div>
      )}
    </div>
  );
}

export function MessageList() {
  const { messages, activeConversationId, isGenerating } = useAlloyStore();

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const messageCount = messages.length;
  const lastContentLen = messages[messages.length - 1]?.content.length ?? 0;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messageCount, lastContentLen]);

  if (!activeConversationId) {
    return <EmptyState />;
  }

  if (messages.length === 0 && !isGenerating) {
    return <EmptyConversation />;
  }

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-y-auto custom-scrollbar bg-[var(--color-alloy-bg)]"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        {messages.map((msg) => (
          <article
            key={msg.id}
            className={clsx(
              "flex gap-5 animate-in fade-in slide-in-from-bottom-2 duration-400",
              msg.role === "user" ? "flex-row-reverse" : "flex-row",
            )}
          >
            <div
              className={clsx(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-300",
                msg.role === "user"
                  ? "border-white/10 bg-[var(--color-alloy-surface)] text-white/40"
                  : "border-[var(--color-alloy-accent)]/30 bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)] shadow-alloy-glow",
              )}
            >
              {msg.role === "user" ? <UserIcon size={14} /> : (
                <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-molten text-[8px] font-bold text-black">AL</div>
              )}
            </div>
            <div
              className={clsx(
                "min-w-0 flex-1 rounded-xl border transition-all duration-300 overflow-hidden",
                msg.role === "user"
                  ? "border-white/5 bg-[var(--color-alloy-surface)]/40 px-5 py-4"
                  : "border-[var(--color-alloy-accent)]/10 bg-black/20 backdrop-blur-sm",
              )}
            >
              {msg.role === "model" && (
                <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-5 py-2.5">
                   <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-alloy-accent)] animate-pulse-cyan shadow-alloy-glow" />
                   <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-alloy-accent)]">Alloy Reasoning &gt;</span>
                </div>
              )}
              <div className="px-5 py-5">
                {msg.role === "model" && msg.content.includes("Thought:") && (
                  <ThoughtBlock content={msg.content.split("Thought:")[1]?.split("\n\n")[0] || ""} />
                )}
                <div className="prose prose-invert max-w-none text-sm leading-relaxed text-white/90">
                  <FormattedMessage 
                    content={msg.content.includes("Thought:") ? msg.content.split("Thought:")[1]?.split("\n\n").slice(1).join("\n\n") || msg.content : msg.content} 
                    role={msg.role} 
                  />
                </div>
              </div>
            </div>
          </article>
        ))}
        {isGenerating && messages.length === 0 && (
           <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-alloy-text-sec)]">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-alloy-accent)] animate-pulse shadow-alloy-glow" />
              Initializing agents...
           </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-10">
      <div className="max-w-md space-y-2 text-center">
        <Bot size={40} className="mx-auto text-[var(--color-alloy-accent)]" />
        <h2 className="font-display text-xl tracking-wide text-white">
          Alloy is ready.
        </h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)]">
          Start a new conversation from the left rail. Everything you send will
          flow through the optimization pipeline before touching a model.
        </p>
      </div>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-10">
      <div className="max-w-md space-y-3 text-center">
        <Sparkles size={32} className="mx-auto text-[var(--color-alloy-accent)]" />
        <h2 className="font-display text-lg tracking-wide text-white">
          New conversation
        </h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)]">
          Your first message auto-names this chat. Try:
          <br />
          <span className="mt-2 inline-block italic text-[var(--color-alloy-accent)]">
            “Write a Python script that watches a folder and uploads new files to S3.”
          </span>
        </p>
      </div>
    </div>
  );
}
