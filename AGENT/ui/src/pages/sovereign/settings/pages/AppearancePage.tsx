/**
 * Appearance page — theme, language, accent, density.
 *
 * These are the only settings whose changes are felt instantly in the UI
 * (no gateway round-trip required). We still persist them server-side so
 * the VS Code extension can pick them up too.
 */
import { Palette, Sun, Moon, Laptop } from "lucide-react";
import clsx from "clsx";
import { Card, Row, Section, Switch } from "../../../../components/sovereign/primitives";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";

const THEMES = [
  { id: "dark", label: "Dark", icon: <Moon size={14} /> },
  { id: "light", label: "Light", icon: <Sun size={14} /> },
  { id: "system", label: "System", icon: <Laptop size={14} /> },
];

const ACCENTS = [
  { id: "violet", color: "#a855f7" },
  { id: "blue", color: "#60a5fa" },
  { id: "emerald", color: "#10b981" },
  { id: "amber", color: "#f59e0b" },
];

const LANGUAGES = [
  { id: "tr", label: "Türkçe" },
  { id: "en", label: "English" },
];

export function AppearancePage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useSovereignStore();

  const theme = getAtPath<string>(effective, "appearance.theme", "dark");
  const accent = getAtPath<string>(effective, "appearance.accent", "violet");
  const lang = getAtPath<string>(effective, "appearance.language", "tr");
  const compact = getAtPath<boolean>(effective, "appearance.compact", false);

  return (
    <div className="space-y-10">
      <Section title="Theme" icon={<Palette size={16} />}>
        <Card>
          <Row label="Color scheme">
            <div className="flex gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => updateSettingsPath("appearance.theme", t.id)}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                    theme === t.id
                      ? "border-[var(--color-loji-accent)]/40 bg-[var(--color-loji-accent)]/10 text-white"
                      : "border-[var(--color-loji-border)] text-[var(--color-loji-text-sec)] hover:border-[var(--color-loji-border-bright)] hover:text-white",
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Accent color">
            <div className="flex gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-label={a.id}
                  onClick={() => updateSettingsPath("appearance.accent", a.id)}
                  className={clsx(
                    "h-9 w-9 rounded-full border-2 transition-transform",
                    accent === a.id ? "scale-110 border-white" : "border-transparent",
                  )}
                  style={{ backgroundColor: a.color }}
                />
              ))}
            </div>
          </Row>
          <Row label="Density" hint="Compact shrinks padding across the whole console.">
            <Switch
              checked={Boolean(compact)}
              onChange={(v) => updateSettingsPath("appearance.compact", v)}
            />
          </Row>
          <Row label="Language">
            <div className="flex gap-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => updateSettingsPath("appearance.language", l.id)}
                  className={clsx(
                    "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                    lang === l.id
                      ? "border-[var(--color-loji-accent)]/40 bg-[var(--color-loji-accent)]/10 text-white"
                      : "border-[var(--color-loji-border)] text-[var(--color-loji-text-sec)] hover:text-white",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Row>
        </Card>
      </Section>
    </div>
  );
}
