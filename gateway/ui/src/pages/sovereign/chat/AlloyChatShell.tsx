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
        
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-1 flex-col min-w-0 relative">
            <MessageList />
            <Composer />
            <CostFooter />
          </div>
          
          {/* Side Panel for Surgical Fixes & Plan Previews */}
          <div className="w-[400px] border-l border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/30 backdrop-blur-sm hidden xl:block">
            <SurgicalEditor />
          </div>
        </div>
      </main>
    </div>
  );
}
