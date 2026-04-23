/**
 * Appearance page — theme, language, accent, density.
 */
import { Palette, Sun, Moon, Laptop, Monitor, Languages, Maximize2 } from "lucide-react";
import clsx from "clsx";
import { Row, Section, Switch } from "../../../../components/sovereign/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";

const THEMES = [
  { id: "dark", label: "DARK_OBSIDIAN", icon: <Moon size={14} /> },
  { id: "light", label: "LIGHT_STARK", icon: <Sun size={14} /> },
  { id: "system", label: "AUTO_MATCH", icon: <Laptop size={14} /> },
];

const ACCENTS = [
  { id: "violet", color: "#a855f7", label: "NEON_VIOLET" },
  { id: "blue", color: "#60a5fa", label: "FORGE_CYAN" },
  { id: "emerald", color: "#10b981", label: "MINT_STRIKE" },
  { id: "amber", color: "#f59e0b", label: "FUSION_ORANGE" },
];

const LANGUAGES = [
  { id: "tr", label: "TR_TURKISH" },
  { id: "en", label: "EN_ENGLISH" },
];

export function AppearancePage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();

  const theme = getAtPath<string>(effective, "appearance.theme", "dark");
  const accent = getAtPath<string>(effective, "appearance.accent", "violet");
  const lang = getAtPath<string>(effective, "appearance.language", "tr");
  const compact = getAtPath<boolean>(effective, "appearance.compact", false);

  return (
    <div className="space-y-12 pb-20">
      <div className="flex items-center gap-4 p-6 bg-[var(--color-alloy-accent)]/5 border border-[var(--color-alloy-accent)]/10 rounded-2xl mb-8">
        <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-[var(--color-alloy-accent)]/20 text-[var(--color-alloy-accent)]">
           <Palette size={20} />
        </div>
        <div>
           <h2 className="text-sm font-bold uppercase tracking-widest text-white">Visual_Override_Matrix</h2>
           <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Recalibrate the interface aesthetics and ergonomic density.</p>
        </div>
      </div>

      <Section title="Color_Protocol" icon={<Monitor size={16} />}>
        <div className="bg-black/40 border border-white/5 rounded-2xl p-8 space-y-10">
          <Row label="SCHEMA_MODE" hint="Primary luminance sweep.">
            <div className="flex flex-wrap gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => updateSettingsPath("appearance.theme", t.id)}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl border px-5 py-3 text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg active:scale-95",
                    theme === t.id
                      ? "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)] text-black"
                      : "border-white/5 bg-white/[0.02] text-white/40 hover:border-white/20 hover:text-white"
                  )}
                >
                  <span className={clsx(theme === t.id ? "text-black" : "text-[var(--color-alloy-accent)]")}>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </Row>

          <Row label="ACCENT_PULSE" hint="Global highlight frequency.">
            <div className="flex flex-wrap gap-4">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-label={a.id}
                  onClick={() => updateSettingsPath("appearance.accent", a.id)}
                  className={clsx(
                    "group relative h-12 w-12 rounded-xl border-2 transition-all shadow-inner active:scale-95",
                    accent === a.id ? "border-white scale-110 shadow-alloy-glow" : "border-white/5"
                  )}
                  style={{ backgroundColor: a.color }}
                >
                   {accent === a.id && (
                     <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-1.5 w-1.5 bg-black rounded-full" />
                     </div>
                   )}
                   <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-[8px] font-bold uppercase tracking-widest text-white/40">
                      {a.label}
                   </div>
                </button>
              ))}
            </div>
          </Row>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Section title="Interface_Density" icon={<Maximize2 size={16} />}>
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6">
             <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                <div>
                   <span className="block text-[10px] font-bold text-white/80 uppercase">Compact_Grid</span>
                   <p className="text-[10px] text-white/20 mt-1 uppercase">Reduce padding for high-density command viewing.</p>
                </div>
                <Switch
                  checked={Boolean(compact)}
                  onChange={(v: boolean) => updateSettingsPath("appearance.compact", v)}
                />
             </div>
          </div>
        </Section>

        <Section title="Localization_Kernel" icon={<Languages size={16} />}>
           <div className="bg-black/40 border border-white/5 rounded-2xl p-6">
             <div className="flex gap-3">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => updateSettingsPath("appearance.language", l.id)}
                    className={clsx(
                      "flex-1 px-4 py-3 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all",
                      lang === l.id
                        ? "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)]/10 text-white shadow-alloy-glow"
                        : "border-white/5 bg-white/[0.02] text-white/20 hover:text-white"
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
           </div>
        </Section>
      </div>

      <div className="p-4 bg-[var(--color-alloy-accent)]/5 border border-[var(--color-alloy-accent)]/10 rounded-xl flex items-center justify-center">
         <span className="text-[9px] font-bold text-[var(--color-alloy-accent)]/40 uppercase tracking-[0.3em]">Visual_State_Synchronized</span>
      </div>
    </div>
  );
}
