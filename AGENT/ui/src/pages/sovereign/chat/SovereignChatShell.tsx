/**
 * SovereignChatShell — the top-level chat page.
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
import { useSovereignStore } from "../../../store/sovereignStore";
import { ConversationList } from "./components/ConversationList";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { CostFooter } from "./components/CostFooter";

export function SovereignChatShell() {
  const { settings, loadSettings, conversationOrder, newConversation } =
    useSovereignStore();

  // Settings drive the ModelPicker — fetch them once so the picker has data.
  useEffect(() => {
    if (!settings) void loadSettings();
  }, [settings, loadSettings]);

  // If the persisted store hydrated with zero conversations, start a fresh
  // one so the user never stares at an empty screen on first load.
  useEffect(() => {
    if (conversationOrder.length === 0) {
      newConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full">
      <ConversationList />
      <main className="flex min-w-0 flex-1 flex-col">
        <MessageList />
        <Composer />
        <CostFooter />
      </main>
    </div>
  );
}
