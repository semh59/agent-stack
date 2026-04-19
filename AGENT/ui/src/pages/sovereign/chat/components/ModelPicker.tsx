/**
 * ModelPicker — inline picker that sits in the composer toolbar.
 *
 * Reads the enabled provider list from the settings slice and exposes a flat
 * selection of `provider:model` slugs. Defaults to the routing "code" role so
 * the user can override it for one-off turns without touching settings.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Sparkles } from "lucide-react";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { getAtPath, useEffectiveSettings } from "../../settings/useEffectiveSettings";

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
  const { settings } = useSovereignStore();
  const [open, setOpen] = useState(false);

  const candidates = useMemo(
    () => collectCandidates(effective),
    [effective],
  );

  const defaultRole =
    getAtPath<string>(effective, "routing.roles.code", "") ?? "";
  const effective_slug = value ?? defaultRole ?? candidates[0]?.slug ?? "";
  const active = candidates.find((c) => c.slug === effective_slug);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
          "border-[var(--color-loji-border)] bg-[var(--color-loji-bg)] text-[var(--color-loji-text)] hover:border-[var(--color-loji-accent)]/40",
        )}
        disabled={!settings}
      >
        <Sparkles size={12} className="text-[var(--color-loji-accent)]" />
        <span className="max-w-[180px] truncate">
          {active?.label ?? effective_slug ?? "Auto (routing)"}
        </span>
        <ChevronDown size={12} className="text-[var(--color-loji-text-sec)]" />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full z-30 mb-2 max-h-[320px] w-[260px] overflow-y-auto rounded-xl border border-[var(--color-loji-border)] bg-[var(--color-loji-surface)] p-2 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)]">
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
              className={clsx(
                "mb-1 w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
                !value
                  ? "bg-[var(--color-loji-accent)]/10 text-white"
                  : "text-[var(--color-loji-text-sec)] hover:bg-[var(--color-loji-border)] hover:text-white",
              )}
            >
              <span className="block font-medium">Auto (routing)</span>
              <span className="block text-[10px] text-[var(--color-loji-text-sec)]">
                Let Sovereign pick based on role + complexity
              </span>
            </button>
            <div className="my-1 border-t border-[var(--color-loji-border)]" />
            {candidates.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-[var(--color-loji-text-sec)]">
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
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition-colors",
                    c.slug === value
                      ? "bg-[var(--color-loji-accent)]/10 text-white"
                      : "text-[var(--color-loji-text-sec)] hover:bg-[var(--color-loji-border)] hover:text-white",
                  )}
                >
                  <span className="truncate">{c.label}</span>
                  <span className="ml-2 shrink-0 text-[10px] uppercase tracking-widest text-[var(--color-loji-text-sec)]">
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
