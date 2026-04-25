import clsx from "clsx";
import { MessageSquare, Plus, Trash2, SquarePen } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "az once";
  if (mins < 60) return `${mins}d once`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}s once`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}g once`;
  return date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export function ConversationList() {
  const {
    conversations,
    activeConversationId,
    startNewChat,
    selectConversation,
    clearHistory,
  } = useAlloyStore();

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]">
      <div className="flex h-14 items-center justify-between border-b border-[var(--color-alloy-border)] px-4">
        <span className="text-sm font-semibold text-[var(--color-alloy-text)]">Chats</span>
        <button
          onClick={() => void startNewChat()}
          title="New chat"
          aria-label="New chat"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-accent-dim)] hover:text-[var(--color-alloy-accent)] hover:border-[var(--color-alloy-accent)] transition-colors"
        >
          <SquarePen size={15} />
        </button>
      </div>

      <div className="alloy-scroll min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <MessageSquare size={28} className="mb-3 text-[var(--color-alloy-border)]" />
            <p className="text-sm text-[var(--color-alloy-text-dim)]">No chat history yet</p>
            <button
              onClick={() => void startNewChat()}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-[var(--color-alloy-accent)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--color-alloy-accent-hover)] transition-colors"
            >
              <Plus size={13} />
              New chat
            </button>
          </div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {conversations.map((convo) => {
              const active = activeConversationId === convo.id;
              return (
                <li key={convo.id}>
                  <button
                    onClick={() => selectConversation(convo.id)}
                    className={clsx(
                      "group flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors",
                      active
                        ? "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]"
                        : "hover:bg-[var(--color-alloy-surface-hover)] text-[var(--color-alloy-text)]",
                    )}
                  >
                    <span className={clsx(
                      "block truncate text-sm font-medium leading-snug",
                      active ? "text-[var(--color-alloy-accent)]" : "text-[var(--color-alloy-text)]",
                    )}>
                      {convo.title || "New chat"}
                    </span>
                    <span className="text-[11px] text-[var(--color-alloy-text-dim)]">
                      {timeAgo(new Date(convo.updatedAt))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {conversations.length > 0 && (
        <div className="border-t border-[var(--color-alloy-border)] p-2">
          <button
            onClick={clearHistory}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[var(--color-alloy-text-sec)] hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={13} />
            Gecmisi temizle
          </button>
        </div>
      )}
    </aside>
  );
}
