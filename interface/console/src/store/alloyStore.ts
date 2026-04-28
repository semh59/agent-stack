/**
 * Alloy store — independent of the existing `appStore` so the masterpiece
 * UI slices don't have to extend the legacy AppState interface.
 *
 * Slices:
 *   • settings — server-backed provider / routing / pipeline / MCP config
 *   • chat     — local conversation list + optimize bridge wiring
 *
 * We reach for Zustand's persist wrapper on purpose-built slices (chat) while
 * leaving volatile state (settings draft patch) in-memory so a refresh discards
 * unsaved edits.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  createAlloySettingsSlice,
  type AlloySettingsSlice,
} from "./slices/alloy/settingsSlice";
import {
  createAlloyChatSlice,
  type AlloyChatSlice,
} from "./slices/alloy/chatSlice";

export type AlloyState = AlloySettingsSlice & AlloyChatSlice;

/**
 * Only chat persists across reloads. Settings hydrate from the gateway, and
 * probe results / draft patches are intentionally session-scoped.
 */
export const useAlloyStore = create<AlloyState>()(
  persist(
    (...a) => ({
      ...createAlloySettingsSlice(...a),
      ...createAlloyChatSlice(...a),
    }),
    {
      name: "alloy.v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        conversations: s.conversations,
        activeConversationId: s.activeConversationId,
        sessionCostUsd: s.sessionCostUsd,
        sessionTokens: s.sessionTokens,
      }),
    },
  ),
);
