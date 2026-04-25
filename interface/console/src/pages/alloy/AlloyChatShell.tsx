import { useEffect } from "react";
import { useAlloyStore } from "../../../store/alloyStore";
import { ConversationList } from "./components/ConversationList";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { CostFooter } from "./components/CostFooter";

export function AlloyChatShell() {
  const {
    settings,
    loadSettings,
    conversations,
    loadConversations,
    startNewChat,
    activeConversationId,
  } = useAlloyStore();

  useEffect(() => {
    if (!settings) void loadSettings();
  }, [settings, loadSettings]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (conversations.length === 0 && !activeConversationId) {
      void startNewChat();
    }
  }, [conversations, activeConversationId, startNewChat]);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--color-alloy-bg)]">
      <ConversationList />
      <main className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <MessageList />
        <Composer />
        <CostFooter />
      </main>
    </div>
  );
}
