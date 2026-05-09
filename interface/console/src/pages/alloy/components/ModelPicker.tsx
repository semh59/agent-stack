/**
 * ModelPicker — inline picker that sits in the composer toolbar.
 *
 * Reads the enabled provider list from the settings slice and exposes a flat
 * selection of `provider:model` slugs. Defaults to the routing "code" role so
 * the user can override it for one-off turns without touching settings.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Sparkles } from "lucide-react";
import { useAlloyStore } from "../../../store/alloyStore";
import { getAtPath, useEffectiveSettings } from "../settings/useEffectiveSettings";

export interface ModelPickerProps {
  value: string | undefined;
  onChange: (slug: string | undefined) => void;
}

interface Candidate {
  slug: string;
  label: string;
  provider: string;
}

function collectCandidates(effective: Record<string, unknown>): Candidate[] {
  const out: Candidate[] = [];
  const providers =
    getAtPath<Record<string, unknown>>(effective, "providers", {}) ?? {};
  for (const [name, raw] of Object.entries(providers)) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as {
      enabled?: boolean;
      models?: string[];
      default_model?: string;
    };
    if (p.enabled === false) continue;
    const models = Array.isArray(p.models) ? p.models : [];
    for (const m of models) {
      out.push({ slug: `${name}:${m}`, label: m, provider: name });
    }
    if (p.default_model && !models.includes(p.default_model)) {
      out.push({
        slug: `${name}:${p.default_model}`,
        label: p.default_model,
        provider: name,
      });
    }
  }
  return out;
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const effective = useEffectiveSettings();
  const { settings, models, loadModels } = useAlloyStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const candidates = useMemo(() => {
    // 1. Get models from Settings (static/config)
    const settingsCandidates = collectCandidates(effective);
    
    // 2. Get models from Store (dynamic discovery)
    const storeCandidates = models.map(m => ({
      slug: m.id,
      label: m.name,
      provider: m.provider
    }));

    // 3. Merge and deduplicate by slug
    const seen = new Set<string>();
    const merged: Candidate[] = [];

    // Prioritize store candidates (dynamic ones might have better names)
    for (const c of [...storeCandidates, ...settingsCandidates]) {
      if (!seen.has(c.slug)) {
        seen.add(c.slug);
        merged.push(c);
      }
    }

    return merged;
  }, [effective, models]);

  const defaultRole =
    getAtPath<string>(effective, "routing.roles.code", "") ?? "";
  const effective_slug = value ?? defaultRole ?? candidates[0]?.slug ?? "";
  const active = candidates.find((c) => c.slug === effective_slug);

  useEffect(() => {
    if (value === undefined && active) {
      onChange(active.slug);
    }
  }, [value, active, onChange]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200",
          "border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] text-[var(--color-alloy-text)] hover:border-[var(--color-alloy-accent)] hover:shadow-[var(--shadow-alloy-glow)]",
        )}
        disabled={!settings}
      >
        <Sparkles size={12} className="text-[var(--color-alloy-accent)] animate-pulse" />
        <span className="max-w-[180px] truncate">
          {active?.label ?? effective_slug ?? "Auto (routing)"}
        </span>
        <ChevronDown size={12} className="text-[var(--color-alloy-text-sec)]" />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full z-30 mb-2 max-h-[320px] w-[260px] overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2 backdrop-blur-md shadow-[var(--shadow-alloy-lg)] shadow-black/20">
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
              className={clsx(
                "mb-1 w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
                !value
                  ? "bg-[var(--color-alloy-accent)] text-white shadow-sm"
                  : "text-[var(--color-alloy-text)] hover:bg-[var(--color-alloy-surface-hover)]",
              )}
            >
              <span className="block font-semibold">Auto (routing)</span>
              <span className="block text-[10px] opacity-70">
                Let Alloy pick based on role + complexity
              </span>
            </button>
            <div className="my-1 border-t border-[var(--color-alloy-border)]" />
            {candidates.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-[var(--color-alloy-text-sec)]">
                No providers enabled yet.
                <br />
                Head to Settings → Providers.
              </div>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => {
                    onChange(c.slug);
                    setOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition-all duration-200",
                    c.slug === value
                      ? "bg-[var(--color-alloy-accent)] text-white shadow-sm"
                      : "text-[var(--color-alloy-text)] hover:bg-[var(--color-alloy-surface-hover)]",
                  )}
                >
                  <span className="truncate font-medium">{c.label}</span>
                  <span className={clsx(
                    "ml-2 shrink-0 text-[9px] uppercase tracking-widest font-black",
                    c.slug === value ? "text-white/60" : "text-[var(--color-alloy-text-dim)]"
                  )}>
                    {c.provider}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
