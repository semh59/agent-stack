/**
 * ConversationList — left rail that lists all chats, newest first.
 *
 * Each row shows the auto-derived title, a short "updated X ago" timestamp,
 * and a trash icon on hover. The active conversation is highlighted with the
 * accent token so it's obvious at a glance.
 */
import clsx from "clsx";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";
import { Button } from "../../../../components/sovereign/primitives";

export function ConversationList() {
  const {
    conversations,
    activeConversationId,
    startNewChat,
    selectConversation,
    clearHistory
  } = useAlloyStore();

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/30 backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-[var(--color-alloy-border)] px-4 py-3">
        <span className="font-ui text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-alloy-text-sec)]">
          Conversations
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          icon={<Plus size={14} />}
          onClick={() => startNewChat()}
        >
          New
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {conversations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <MessageSquare size={24} className="mx-auto mb-3 text-[var(--color-alloy-border)]" />
            <p className="text-xs text-[var(--color-alloy-text-sec)]">
              No history found.
            </p>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {conversations.map((convo) => {
              const isActive = activeConversationId === convo.id;
              return (
                <li key={convo.id}>
                  <div
                    className={clsx(
                      "group relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-all duration-200",
                      isActive
                        ? "border-[var(--color-alloy-accent)]/30 bg-[var(--color-alloy-accent)]/5 shadow-sm"
                        : "border-transparent hover:bg-[var(--color-alloy-surface-hover)] hover:border-[var(--color-alloy-border)]"
                    )}
                    onClick={() => selectConversation(convo.id)}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={clsx(
                        "truncate text-sm font-medium",
                        isActive ? "text-[var(--color-alloy-accent)]" : "text-white/90"
                      )}>
                        {convo.title}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-[var(--color-alloy-text-sec)]">
                         {new Date(convo.updatedAt).toLocaleDateString()}
                      </span>
                      {isActive && <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-alloy-accent)] shadow-[0_0_8px_var(--color-alloy-accent)]" />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="p-3 border-t border-[var(--color-alloy-border)]">
        <button 
          onClick={clearHistory}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[10px] uppercase tracking-wider text-[var(--color-alloy-text-sec)] transition hover:bg-red-500/10 hover:text-red-400"
        >
          <Trash2 size={12} />
          Wipe Cache
        </button>
      </div>
    </aside>
  );
}
