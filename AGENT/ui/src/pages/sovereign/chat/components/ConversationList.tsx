/**
 * ConversationList — left rail that lists all chats, newest first.
 *
 * Each row shows the auto-derived title, a short "updated X ago" timestamp,
 * and a trash icon on hover. The active conversation is highlighted with the
 * accent token so it's obvious at a glance.
 */
import clsx from "clsx";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { Button } from "../../../../components/sovereign/primitives";

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  const seconds = Math.max(1, Math.round(delta / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(ms).toLocaleDateString();
}

export function ConversationList() {
  const {
    conversations,
    conversationOrder,
    activeConversationId,
    newConversation,
    selectConversation,
    deleteConversation,
  } = useSovereignStore();

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--color-loji-border)] bg-[var(--color-loji-surface)]/50">
      <div className="flex items-center justify-between border-b border-[var(--color-loji-border)] px-3 py-3">
        <span className="font-ui text-[11px] font-bold uppercase tracking-widest text-[var(--color-loji-text-sec)]">
          Conversations
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => newConversation()}
          title="New chat"
        >
          New
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversationOrder.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-[var(--color-loji-text-sec)]">
            No conversations yet.
            <br />
            Hit <span className="text-white">New</span> to start one.
          </div>
        ) : (
          <ul className="space-y-1">
            {conversationOrder.map((id) => {
              const convo = conversations[id];
              if (!convo) return null;
              const isActive = activeConversationId === id;
              const last = convo.messages[convo.messages.length - 1];
              const preview =
                last?.content?.replace(/\s+/g, " ").slice(0, 60) ??
                "Empty conversation";
              return (
                <li key={id}>
                  <div
                    className={clsx(
                      "group relative flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors",
                      isActive
                        ? "border-[var(--color-loji-accent)]/40 bg-[var(--color-loji-accent)]/10"
                        : "border-transparent hover:border-[var(--color-loji-border)] hover:bg-[var(--color-loji-surface-hover)]",
                    )}
                    onClick={() => selectConversation(id)}
                  >
                    <MessageSquare
                      size={14}
                      className={clsx(
                        "mt-0.5 shrink-0",
                        isActive
                          ? "text-[var(--color-loji-accent)]"
                          : "text-[var(--color-loji-text-sec)]",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-white">
                          {convo.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--color-loji-text-sec)]">
                          {relativeTime(convo.updated_at)}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-[var(--color-loji-text-sec)]">
                        {preview}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm("Delete this conversation?")) {
                          deleteConversation(id);
                        }
                      }}
                      className="absolute right-1.5 top-1.5 hidden rounded p-1 text-[var(--color-loji-text-sec)] hover:bg-[var(--color-loji-border)] hover:text-red-300 group-hover:block"
                      aria-label="Delete conversation"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
