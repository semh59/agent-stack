/**
 * MessageList — the scrollable feed of user / assistant turns.
 *
 * Auto-scrolls to the bottom whenever a new message lands or the pending
 * placeholder resolves. Each turn shows a role label, the rendered body, and a
 * footer with latency + token counts (assistant only).
 */
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Bot, Sparkles, User as UserIcon } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";
import { FormattedMessage } from "./message-format";

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
              "flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
              msg.role === "user" ? "flex-row-reverse" : "flex-row",
            )}
          >
            <div
              className={clsx(
                "mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 shadow-sm transition-all",
                msg.role === "user"
                  ? "border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] text-[var(--color-alloy-text)]"
                  : "border-[var(--color-alloy-accent)]/30 bg-[var(--color-alloy-accent)]/5 text-[var(--color-alloy-accent)]",
              )}
            >
              {msg.role === "user" ? <UserIcon size={16} /> : <Bot size={16} />}
            </div>
            <div
              className={clsx(
                "min-w-0 flex-1 rounded-2xl border px-5 py-4 transition-all",
                msg.role === "user"
                  ? "border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/80"
                  : "border-[var(--color-alloy-accent)]/20 bg-[var(--color-alloy-accent)]/5 backdrop-blur-sm",
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-alloy-text-sec)]">
                  <span>{msg.role === "user" ? "User" : "Alloy AI"}</span>
                  {msg.isStreaming && (
                    <span className="flex items-center gap-1 text-[var(--color-alloy-accent)]">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0.2s]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0.4s]" />
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-[var(--color-alloy-text-sec)]/50">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="prose prose-invert max-w-none text-sm leading-relaxed text-white/90">
                <FormattedMessage content={msg.content} role={msg.role} />
              </div>
            </div>
          </article>
        ))}
        {isGenerating && messages.length === 0 && (
           <div className="flex items-center gap-3 text-sm text-[var(--color-alloy-text-sec)]">
              <div className="h-2 w-2 animate-ping rounded-full bg-[var(--color-alloy-accent)]" />
              Waking up agents...
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
