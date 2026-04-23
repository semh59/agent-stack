/**
 * ConversationList — left rail that lists all chats, newest first.
 *
 * Each row shows the auto-derived title, a short "updated X ago" timestamp,
 * and a trash icon on hover. The active conversation is highlighted with the
 * accent token so it's obvious at a glance.
 */
import clsx from "clsx";
import { MessageSquare, Plus, Trash2, Activity } from "lucide-react";
import { useAlloyStore } from "../../../../store/alloyStore";

export function ConversationList() {
  const {
    conversations,
    activeConversationId,
    startNewChat,
    selectConversation,
    clearHistory
  } = useAlloyStore();

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-[var(--color-alloy-border)] bg-black/20 backdrop-blur-3xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-4 bg-white/5">
        <div className="flex flex-col">
          <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--color-alloy-accent)]">MISSION_LOGS</span>
          <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">ARCHIVE_SYSTEM</span>
        </div>
        <button
          onClick={() => startNewChat()}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-alloy-accent)]/20 bg-[var(--color-alloy-accent)]/10 text-[var(--color-alloy-accent)] transition-all hover:bg-[var(--color-alloy-accent)] hover:text-black shadow-alloy-molten-glow"
        >
          <Plus size={14} />
        </button>
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
                      "group relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-all duration-300",
                      isActive
                        ? "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)]/10 shadow-[0_0_15px_rgba(0,240,255,0.05)] border-l-4 border-l-[var(--color-alloy-accent)]"
                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10"
                    )}
                    onClick={() => selectConversation(convo.id)}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={clsx(
                        "truncate text-[11px] font-black uppercase tracking-wider",
                        isActive ? "text-[var(--color-alloy-accent)]" : "text-white/40"
                      )}>
                        {isActive && <Activity size={10} className="inline mr-2 animate-pulse" />}
                        {convo.title}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2 border-t border-white/5 pt-2">
                      <span className="font-mono text-[9px] text-white/20 tracking-tighter">
                         TS_{new Date(convo.updatedAt).getTime().toString(16).slice(-6).toUpperCase()}
                      </span>
                      {isActive ? (
                        <span className="text-[8px] font-bold text-[var(--color-alloy-accent)] animate-pulse">ACTIVE_SESSION</span>
                      ) : (
                        <span className="text-[8px] font-bold text-white/10">ARCHIVED</span>
                      )}
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
