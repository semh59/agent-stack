/**
 * AlloyChatShell — the top-level chat page.
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Conversations │       <MessageList />                         │
 *   │ (rail)        ├───────────────────────────────────────────────┤
 *   │               │       <Composer />                            │
 *   │               ├───────────────────────────────────────────────┤
 *   │               │       <CostFooter />                          │
 *   └───────────────┴───────────────────────────────────────────────┘
 *
 * This is the canonical "chat" surface that competing agent consoles ship.
 * We keep it minimal and elegant — no surprise overlays, no modal hijacks.
 * All the power lives in Settings; this view stays focused on the dialog.
 */
import { useEffect } from "react";
import { useAlloyStore } from "../../../store/alloyStore";
import { ConversationList } from "./components/ConversationList";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { CostFooter } from "./components/CostFooter";
import { SurgicalEditor } from "./components/SurgicalEditor";
import { AutonomyConsole } from "./components/AutonomyConsole";

export function AlloyChatShell() {
  const { 
    settings, 
    loadSettings, 
    conversations, 
    loadConversations, 
    startNewChat,
    activeConversationId 
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
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <AutonomyConsole />
        <MessageList />
        <Composer />
        <CostFooter />
        <SurgicalEditor />
      </main>
    </div>
  );
}
