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
import { Badge } from "../../../../components/alloy/primitives";
import { FormattedMessage } from "./message-format";

export function MessageList() {
  const { conversations, activeConversationId } = useAlloyStore();
  const convo = activeConversationId
    ? conversations[activeConversationId]
    : null;

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const messageCount = convo?.messages.length ?? 0;
  const lastContentLen =
    convo?.messages[convo.messages.length - 1]?.content.length ?? 0;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messageCount, lastContentLen]);

  if (!convo) {
    return <EmptyState />;
  }

  if (convo.messages.length === 0) {
    return <EmptyConversation />;
  }

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
        {convo.messages.map((msg) => (
          <article
            key={msg.id}
            className={clsx(
              "flex gap-4",
              msg.role === "user" ? "flex-row-reverse" : "flex-row",
            )}
          >
            <div
              className={clsx(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                msg.role === "user"
                  ? "border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] text-[var(--color-alloy-text)]"
                  : "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)]/10 text-[var(--color-alloy-accent)]",
              )}
            >
              {msg.role === "user" ? <UserIcon size={14} /> : <Bot size={14} />}
            </div>
            <div
              className={clsx(
                "min-w-0 flex-1 rounded-2xl border px-4 py-3",
                msg.role === "user"
                  ? "border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]"
                  : "border-[var(--color-alloy-accent)]/20 bg-[var(--color-alloy-accent)]/5",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--color-alloy-text-sec)]">
                <span>{msg.role === "user" ? "You" : "Assistant"}</span>
                {msg.model ? <Badge tone="accent">{msg.model}</Badge> : null}
                {msg.pending ? <Badge tone="warning">streaming…</Badge> : null}
              </div>
              <FormattedMessage content={msg.content} role={msg.role} />
              {(msg.tokens?.input || msg.tokens?.output) && !msg.pending ? (
                <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--color-alloy-text-sec)]">
                  <Sparkles size={10} />
                  <span>
                    in {msg.tokens.input ?? 0} tok · out {msg.tokens.output ?? 0} tok
                  </span>
                </div>
              ) : null}
            </div>
          </article>
        ))}
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
