/**
 * Routing page — decide which model each role / complexity tier uses.
 */
import { Trash2, Plus, Network, ListOrdered, AlertCircle } from "lucide-react";
import { useMemo, type ChangeEvent } from "react";
import { useEffectiveSettings, getAtPath } from "../useEffectiveSettings";
import { useAlloyStore } from "../../../../store/alloyStore";
import {
  Section,
  Select,
} from "../../../../components/sovereign/primitives";
import { useTranslation } from "react-i18next";

const ROLES: Array<{ key: string; label: string; hint: string }> = [
  { key: "chat", label: "Chat", hint: "Interactive conversations." },
  { key: "autocomplete", label: "Autocomplete", hint: "Inline code completions (low-latency)." },
  { key: "edit", label: "Edit", hint: "Refactor, rewrite, multi-file changes." },
  { key: "embed", label: "Embed", hint: "RAG index + semantic cache keys." },
  { key: "rerank", label: "Rerank", hint: "Post-retrieval reranking." },
];

const COMPLEXITY: Array<{ key: string; label: string; hint: string }> = [
  { key: "low", label: "Low", hint: "Simple edits, one-liners." },
  { key: "medium", label: "Medium", hint: "Multi-file, moderate reasoning." },
  { key: "high", label: "High", hint: "Plans, architecture, design." },
];

export function RoutingPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();
  const { t } = useTranslation();
  const fallback = getAtPath<string[]>(effective, "routing.fallback_chain", []);

  // Build model choices from enabled providers
  const modelChoices = useMemo(() => {
    const choices: string[] = [];
    const provs = (effective.providers as Record<string, { enabled: boolean; default_model: string }>) || {};
    Object.entries(provs).forEach(([pid, p]) => {
      if (p?.enabled && p?.default_model) {
        choices.push(`${pid}:${p.default_model}`);
      }
    });
    return choices;
  }, [effective.providers]);

  const ModelSelector = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <div className="relative group w-full">
       <Select 
         value={value} 
         onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
         className="w-full bg-black/40 border-white/10 text-xs font-mono"
       >
         <option value="">{placeholder || t("SELECT_MODEL_NODE")}</option>
         {modelChoices.map(m => (
           <option key={m} value={m}>{m.toUpperCase()}</option>
         ))}
       </Select>
       {!modelChoices.includes(value) && value !== "" && (
         <div className="mt-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-[9px] font-bold text-amber-400 flex items-center gap-2 uppercase tracking-widest">
           <AlertCircle size={10} /> {t("MANUAL_OVERRIDE_ACTIVE")}
         </div>
       )}
    </div>
  );

  const strField = (dotted: string, placeholder?: string) => {
    const val = getAtPath<string>(effective, dotted, "") ?? "";
    return (
      <ModelSelector 
        value={val} 
        onChange={(v) => updateSettingsPath(dotted, v)}
        placeholder={placeholder}
      />
    );
  };

  return (
    <div className="space-y-12 pb-20">
      <div className="flex items-center gap-4 p-6 bg-[var(--color-alloy-accent)]/5 border border-[var(--color-alloy-accent)]/10 rounded-2xl mb-8">
        <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-[var(--color-alloy-accent)]/20 text-[var(--color-alloy-accent)]">
           <Network size={20} />
        </div>
        <div>
           <h2 className="text-sm font-bold uppercase tracking-widest text-white">Model Routing</h2>
           <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Assign logical roles to specific AI models.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Section
          title="Role Mapping"
          description="Assign models to specific activities."
          icon={<Network size={16} />}
        >
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-4">
            {ROLES.map((r) => (
              <div key={r.key} className="p-4 border border-white/5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="block text-[11px] font-bold text-white/80 uppercase tracking-tight">{r.label}</span>
                    <span className="block text-[10px] text-white/20 mt-0.5 uppercase">{r.hint}</span>
                  </div>
                </div>
                {strField(`routing.roles.${r.key}`)}
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Complexity Mapping"
          description="Assign models based on task difficulty."
        >
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-4">
            {COMPLEXITY.map((c) => (
              <div key={c.key} className="p-4 border border-white/5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="block text-[11px] font-bold text-white/80 uppercase tracking-tight">{c.label} Tasks</span>
                    <span className="block text-[10px] text-white/20 mt-0.5 uppercase">{c.hint}</span>
                  </div>
                </div>
                {strField(`routing.complexity.${c.key}`)}
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section
        title="Fallback Models"
        description="Models to use if the primary model fails."
        icon={<ListOrdered size={16} />}
      >
        <div className="bg-black/40 border border-white/5 rounded-2xl p-8 space-y-6">
          <div className="space-y-4">
            {(fallback ?? []).map((modelRef, i) => (
              <div key={i} className="flex items-end gap-4 p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                <div className="flex-1">
                   <span className="block text-[9px] font-bold text-white/10 uppercase tracking-widest mb-2">Priority_{i + 1}</span>
                   <ModelSelector
                    value={modelRef}
                    onChange={(v) => {
                      const next = [...fallback];
                      next[i] = v;
                      updateSettingsPath("routing.fallback_chain", next);
                    }}
                  />
                </div>
                <button
                  onClick={() => {
                    const next = [...fallback];
                    next.splice(i, 1);
                    updateSettingsPath("routing.fallback_chain", next);
                  }}
                  className="h-10 w-10 flex items-center justify-center rounded-lg text-white/10 hover:text-red-400 hover:bg-red-500/10 transition-all border border-white/5"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          
          <button
            onClick={() =>
              updateSettingsPath("routing.fallback_chain", [...(fallback ?? []), ""])
            }
            className="w-full py-4 border border-dashed border-white/10 rounded-2xl flex items-center justify-center gap-3 text-white/20 hover:text-white/60 hover:border-white/20 hover:bg-white/[0.01] transition-all group"
          >
            <Plus size={16} className="group-hover:scale-125 transition-transform" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Add Fallback Model</span>
          </button>
        </div>
      </Section>
    </div>
  );
}
