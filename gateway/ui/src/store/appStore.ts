import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AppState } from "./types";
import { createAuthSlice } from "./slices/authSlice";
import { createUISlice } from "./slices/uiSlice";
import { createMissionSlice } from "./slices/missionSlice";
import { createWebSocketSlice } from "./slices/websocketSlice";
import { createPipelineSlice } from "./slices/pipelineSlice";

/**
 * Alloy App Store Versioning
 * Version 1: Initial modular store with localStorage.
 */
const CURRENT_STORE_VERSION = 1;

function createNoopStorage(): Storage {
  return {
    length: 0,
    clear() {},
    getItem() {
      return null;
    },
    key() {
      return null;
    },
    removeItem() {},
    setItem() {},
  };
}

function getSafeLocalStorage(): Storage {
  if (typeof globalThis.localStorage !== "undefined") {
    return globalThis.localStorage;
  }
  return createNoopStorage();
}

/**
 * Alloy App Store
 * 
 * Modular Zustand store with persistence and version control.
 */
export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createAuthSlice(...a),
      ...createUISlice(...a),
      ...createMissionSlice(...a),
      ...createWebSocketSlice(...a),
      ...createPipelineSlice(...a),
    }),
    {
      name: "alloy-app-store",
      version: CURRENT_STORE_VERSION,
      storage: createJSONStorage(getSafeLocalStorage),
      
      // Migration strategy
      migrate: (persistedState: unknown, version: number) => {
        if (version < CURRENT_STORE_VERSION) {
          console.warn(`[Store] Migrating from version ${version} to ${CURRENT_STORE_VERSION}. Clearing stale persistent state.`);
          // If we reach version 2, we would handle specific field transformations here.
          // For now, if version is 0 (or undefined), we do a safe reset of persisted fields.
          return {}; 
        }
        return persistedState as AppState;
      },

      partialize: (state) => ({
        // Only persist non-volative UI preferences and safe UI markers
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        selectedMode: state.selectedMode,
        modelPreferences: state.modelPreferences,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);
