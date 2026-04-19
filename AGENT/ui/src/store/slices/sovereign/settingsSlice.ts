/**
 * Sovereign settings slice.
 *
 * Holds the currently fetched (redacted) settings, plus a "dirty" buffer of
 * in-flight edits. Consumers mutate the buffer via `updateSettingsDraft`,
 * then `saveSettingsDraft` PATCHes it to the gateway.
 *
 * This slice is intentionally schema-agnostic — we pass raw object trees
 * through. The Zod schema on the server is the source of truth.
 */
import type { StateCreator } from "zustand";
import {
  fetchSettings,
  patchSettings,
  resetSettings,
  testProvider,
  type ProbeResult,
  type RedactedSettings,
} from "../../../services/settings-api";

function deepSet(
  obj: Record<string, unknown>,
  dotted: string,
  value: unknown,
): Record<string, unknown> {
  const parts = dotted.split(".");
  const root: Record<string, unknown> = { ...obj };
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = cur[part];
    const nested =
      typeof next === "object" && next !== null && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    cur[part] = nested;
    cur = nested;
  }
  cur[parts[parts.length - 1]!] = value;
  return root;
}

function deepMergeOverride(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (
      v !== null &&
      v !== undefined &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof out[k] === "object" &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMergeOverride(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface SovereignSettingsSlice {
  settings: RedactedSettings | null;
  settingsDraftPatch: Record<string, unknown>;
  settingsLoading: boolean;
  settingsSaving: boolean;
  settingsError: string | null;
  providerProbes: Record<string, ProbeResult | { loading: true }>;

  // actions
  loadSettings: () => Promise<void>;
  updateSettingsPath: (dottedPath: string, value: unknown) => void;
  updateSettingsDraft: (patch: Record<string, unknown>) => void;
  clearSettingsDraft: () => void;
  saveSettingsDraft: () => Promise<void>;
  resetAllSettings: () => Promise<void>;
  probeProvider: (name: string) => Promise<void>;
}

export const createSovereignSettingsSlice: StateCreator<
  SovereignSettingsSlice,
  [],
  [],
  SovereignSettingsSlice
> = (set, get) => ({
  settings: null,
  settingsDraftPatch: {},
  settingsLoading: false,
  settingsSaving: false,
  settingsError: null,
  providerProbes: {},

  async loadSettings() {
    set({ settingsLoading: true, settingsError: null });
    try {
      const s = await fetchSettings();
      set({ settings: s, settingsLoading: false });
    } catch (err) {
      set({
        settingsLoading: false,
        settingsError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  updateSettingsPath(dottedPath, value) {
    const nextPatch = deepSet(get().settingsDraftPatch, dottedPath, value);
    set({ settingsDraftPatch: nextPatch });
  },

  updateSettingsDraft(patch) {
    const merged = deepMergeOverride(get().settingsDraftPatch, patch);
    set({ settingsDraftPatch: merged });
  },

  clearSettingsDraft() {
    set({ settingsDraftPatch: {} });
  },

  async saveSettingsDraft() {
    const { settingsDraftPatch } = get();
    if (Object.keys(settingsDraftPatch).length === 0) return;
    set({ settingsSaving: true, settingsError: null });
    try {
      const updated = await patchSettings(settingsDraftPatch);
      set({
        settings: updated,
        settingsDraftPatch: {},
        settingsSaving: false,
      });
    } catch (err) {
      set({
        settingsSaving: false,
        settingsError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  async resetAllSettings() {
    set({ settingsSaving: true });
    try {
      const s = await resetSettings();
      set({ settings: s, settingsDraftPatch: {}, settingsSaving: false });
    } catch (err) {
      set({
        settingsSaving: false,
        settingsError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  async probeProvider(name) {
    set({
      providerProbes: { ...get().providerProbes, [name]: { loading: true } },
    });
    try {
      const res = await testProvider(name);
      set({
        providerProbes: { ...get().providerProbes, [name]: res },
      });
    } catch (err) {
      set({
        providerProbes: {
          ...get().providerProbes,
          [name]: {
            ok: false,
            latency_ms: 0,
            reason: "error",
            detail: err instanceof Error ? err.message : String(err),
          },
        },
      });
    }
  },
});
