/**
 * Sovereign store — independent of the existing `appStore` so the masterpiece
 * UI slices don't have to extend the legacy AppState interface.
 *
 * Scope: settings (this file loads the slice) and — later — chat sessions,
 * usage metering, MCP server state.
 */
import { create } from "zustand";
import {
  createSovereignSettingsSlice,
  type SovereignSettingsSlice,
} from "./slices/sovereign/settingsSlice";

export type SovereignState = SovereignSettingsSlice;

export const useSovereignStore = create<SovereignState>()((...a) => ({
  ...createSovereignSettingsSlice(...a),
}));
