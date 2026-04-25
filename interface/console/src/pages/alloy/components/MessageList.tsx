import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, MessageSquare, Sparkles, User } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";
import { FormattedMessage } from "./message-format";

function ThoughtBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface-hover)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[var(--color-alloy-surface-active)] transition-colors"
      >
        <span className="text-xs font-medium text-[var(--color-alloy-text-sec)]">
          Dusunce sureci
        </span>
        {open
          ? <ChevronUp size={13} className="text-[var(--color-alloy-text-dim)]" />
          : <ChevronDown size={13} className="text-[var(--color-alloy-text-dim)]" />}
      </button>
      {open && (
        <div className="border-t border-[var(--color-alloy-border)] px-3 py-3 font-mono text-xs leading-relaxed text-[var(--color-alloy-text-sec)]">
          {content}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[var(--color-alloy-text-dim)] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
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

  if (!activeConversationId) return <EmptyState />;
  if (messages.length === 0 && !isGenerating) return <EmptyConversation />;

  return (
    <div
      ref={scrollerRef}
      className="alloy-scroll min-h-0 flex-1 overflow-y-auto bg-[var(--color-alloy-bg)]"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
        {messages.map((msg) => (
          <article key={msg.id} className={clsx(
            "flex gap-3",
            msg.role === "user" ? "flex-row-reverse" : "flex-row",
          )}>
            <div className={clsx(
              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              msg.role === "user"
                ? "bg-[var(--color-alloy-surface-hover)] text-[var(--color-alloy-text-sec)] border border-[var(--color-alloy-border)]"
                : "bg-[var(--color-alloy-accent)] text-white",
            )}>
              {msg.role === "user"
                ? <User size={13} />
                : <span className="text-[10px] font-bold">A</span>}
            </div>

            <div className={clsx(
              "min-w-0 max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
              msg.role === "user"
                ? "rounded-tr-sm bg-[var(--color-alloy-accent)] text-white"
                : "rounded-tl-sm bg-[var(--color-alloy-surface)] border border-[var(--color-alloy-border)] text-[var(--color-alloy-text)]",
            )}>
              {msg.role === "model" && msg.content.includes("Thought:") && (
                <ThoughtBlock content={msg.content.split("Thought:")[1]?.split("\n\n")[0] ?? ""} />
              )}
              <div className={clsx(
                "prose max-w-none text-sm",
                msg.role === "user" ? "prose-invert" : "prose-slate",
              )}>
                <FormattedMessage
                  content={
                    msg.content.includes("Thought:")
                      ? msg.content.split("Thought:")[1]?.split("\n\n").slice(1).join("\n\n") ?? msg.content
                      : msg.content
                  }
                  role={msg.role}
                />
              </div>
            </div>
          </article>
        ))}

        {isGenerating && (
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-alloy-accent)] text-[10px] font-bold text-white">
              A
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] px-4 py-3">
              <TypingIndicator />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-10">
      <div className="max-w-sm space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-alloy-accent-dim)]">
          <MessageSquare size={22} className="text-[var(--color-alloy-accent)]" />
        </div>
        <h2 className="text-base font-semibold text-[var(--color-alloy-text)]">Hazir</h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)]">
          Soldan yeni bir Chat baslatın.
        </p>
      </div>
    </div>
  );
}

function EmptyConversation() {
  const { sendMessage } = useAlloyStore();
  const suggestions = [
    "Bir Python scripti yaz",
    "Bu kodu acikla",
    "Hizli bir ozet cikar",
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 p-10">
      <div className="max-w-sm space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-alloy-accent-dim)]">
          <Sparkles size={22} className="text-[var(--color-alloy-accent)]" />
        </div>
        <h2 className="text-base font-semibold text-[var(--color-alloy-text)]">Ne sormak istersiniz?</h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)]">
          First message auto-titles the chat.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => void sendMessage(s)}
            className="rounded-full border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] px-4 py-2 text-sm text-[var(--color-alloy-text-sec)] hover:border-[var(--color-alloy-accent)] hover:text-[var(--color-alloy-accent)] hover:bg-[var(--color-alloy-accent-dim)] transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
