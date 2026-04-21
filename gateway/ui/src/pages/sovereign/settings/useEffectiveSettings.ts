/**
 * `useEffectiveSettings` — the value the UI should render.
 *
 * The server returns the redacted, persisted settings. As the user edits,
 * we accumulate a "draft patch" (deep merged on top). This hook returns
 * the overlay so that every form field can show what would be saved.
 */
import { useMemo } from "react";
import { useAlloyStore } from "../../../store/alloyStore";

function deepMerge(
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
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function useEffectiveSettings(): Record<string, unknown> {
  const settings = useAlloyStore((s) => s.settings);
  const draft = useAlloyStore((s) => s.settingsDraftPatch);
  return useMemo(() => {
    if (!settings) return draft;
    return deepMerge(settings as Record<string, unknown>, draft);
  }, [settings, draft]);
}

/** Read a value at a dotted path, with a fallback. */
export function getAtPath<T = unknown>(
  obj: Record<string, unknown>,
  dotted: string,
  fallback?: T,
): T {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return fallback as T;
    cur = (cur as Record<string, unknown>)[p];
  }
  return (cur === undefined ? fallback : cur) as T;
}

/** Check whether a dotted path looks like a redacted secret placeholder. */
export function isSecretSet(obj: Record<string, unknown>, dotted: string): {
  set: boolean;
  updated_at?: number;
} {
  const v = getAtPath<unknown>(obj, dotted);
  if (v && typeof v === "object" && !Array.isArray(v) && "set" in (v as Record<string, unknown>)) {
    const record = v as { set?: boolean; updated_at?: number };
    return { set: Boolean(record.set), updated_at: record.updated_at };
  }
  return { set: false };
}
