/**
 * Pipeline page — tuning the optimization stack on top of the bridge.
 */
import { Layers as LayersIcon, Plus, Trash2 } from "lucide-react";
import {
  Field,
  Input,
  Row,
  Section,
  Select,
  Switch,
} from "../../../../components/sovereign/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";
import type { ChangeEvent } from "react";

const LAYERS = [
  { key: "cli_cleaner", label: "CLI cleaner", hint: "Strip shell escape codes, ANSI, progress bars." },
  { key: "llmlingua", label: "LLMLingua", hint: "Aggressive prompt compression." },
  { key: "caveman", label: "Caveman", hint: "Shorter, simpler phrasing for routine tasks." },
  { key: "dedup", label: "Deduplication", hint: "Remove repeated segments across messages." },
  { key: "summarizer", label: "Summarizer", hint: "Summarize long context windows." },
  { key: "noise_filter", label: "Noise filter", hint: "Drop off-topic tokens." },
  { key: "rag", label: "RAG", hint: "Pull context from indexed sources." },
  { key: "semantic_cache", label: "Semantic cache", hint: "Fuzzy-match prior answers." },
];

export function PipelinePage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();
  const sources = getAtPath<Array<Record<string, unknown>>>(effective, "pipeline.rag.sources", []);

  const num = (dotted: string, step?: number) => (
    <Input
      type="number"
      step={step}
      value={String(getAtPath<number>(effective, dotted, 0) ?? 0)}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        updateSettingsPath(dotted, e.target.value === "" ? undefined : Number(e.target.value))
      }
      className="max-w-[120px] text-right font-mono"
    />
  );

  const str = (dotted: string, placeholder?: string) => (
    <Input
      value={getAtPath<string>(effective, dotted, "") ?? ""}
      onChange={(e: ChangeEvent<HTMLInputElement>) => updateSettingsPath(dotted, e.target.value)}
      placeholder={placeholder}
      className="bg-black/20 border-white/5"
    />
  );

  const dedupMode = getAtPath<string>(effective, "pipeline.compression.dedup_mode", "exact");

  return (
    <div className="space-y-12 pb-20">
      {/* Header Info */}
      <div className="flex items-center gap-4 p-6 bg-molten/5 border border-molten/10 rounded-2xl mb-8">
        <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-molten/20 text-molten">
           <LayersIcon size={20} />
        </div>
        <div>
           <h2 className="text-sm font-bold uppercase tracking-widest text-white">Pipeline_Orchestrator</h2>
           <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Configure the sequence of optimization kernels applied to every dispatch.</p>
        </div>
      </div>

      <Section
        title="Active Kernels"
        description="Toggle core processing layers. Order is fixed for deterministic stability."
        icon={<LayersIcon size={16} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LAYERS.map((l) => (
            <div key={l.key} className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl hover:bg-white/[0.02] group transition-all">
               <div className="max-w-[200px]">
                  <span className="block text-[11px] font-bold text-white/80 uppercase tracking-tight">{l.label}</span>
                  <span className="block text-[10px] text-white/20 mt-0.5 group-hover:text-white/40 transition-colors uppercase truncate">{l.hint}</span>
               </div>
               <Switch
                  ariaLabel={l.label}
                  checked={getAtPath<boolean>(effective, `pipeline.layers.${l.key}`, true) ?? true}
                  onChange={(next: boolean) => updateSettingsPath(`pipeline.layers.${l.key}`, next)}
                />
            </div>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Section title="Cache_Tuning">
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-6">
            <Row label="TTL_EXACT" hint="Global expiration for exact-match hits.">
              {num("pipeline.cache.exact_ttl_s")}
            </Row>
            <Row label="TTL_SEMANTIC" hint="Duration for fuzzy semantic matches.">
              {num("pipeline.cache.semantic_ttl_s")}
            </Row>
            <Row label="SIMILARITY_MIN" hint="Minimum score [0-1] for vector match.">
              {num("pipeline.cache.semantic_threshold", 0.01)}
            </Row>
            <Row label="LRU_CAPACITY" hint="Max entries before tail eviction.">
              {num("pipeline.cache.max_entries")}
            </Row>
          </div>
        </Section>

        <Section title="Bandit_ε_Greedy">
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-6">
             <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl mb-4">
                <span className="text-[10px] font-bold text-blue-400/80 uppercase tracking-widest">Reinforcement_Logic</span>
                <p className="text-[10px] text-blue-400/40 mt-1">Multi-Armed Bandit optimizes layer combinations based on token savings.</p>
             </div>
            <Row label="EXPLORATION_EPS" hint="Probability [0-1] of random search.">
              {num("pipeline.mab.epsilon", 0.01)}
            </Row>
            <Row label="REWARD_FLOOR" hint="Minimum savings % to trigger positive feedback.">
              {num("pipeline.mab.reward_threshold", 0.01)}
            </Row>
          </div>
        </Section>
      </div>

      <Section title="Compression_Kernels">
        <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-8">
          <Row label="LLM_LINGUA_RATIO" hint="Aggressive target for prompt token reduction.">
            {num("pipeline.compression.llmlingua_target_ratio", 0.05)}
          </Row>
          <Row label="CAVEMAN_RPC" hint="External processor for simplified semantic mapping.">
            {str("pipeline.compression.caveman_endpoint", "ENTER_ENDPOINT_URL")}
          </Row>
          <Row label="DEDUP_STRATEGY">
            <Select
              value={dedupMode ?? "exact"}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => updateSettingsPath("pipeline.compression.dedup_mode", e.target.value)}
              className="max-w-[160px] bg-black/40 border-white/10"
            >
              <option value="off">BYPASS</option>
              <option value="exact">HASH_EXACT</option>
              <option value="semantic">VEC_SEMANTIC</option>
            </Select>
          </Row>
        </div>
      </Section>

      <Section title="Knowledge_Sources (RAG)" description="Federated indexing for agentic retrieval.">
        <div className="space-y-4">
          {(sources ?? []).map((s, i) => (
            <div key={i} className="bg-black/40 border border-white/5 rounded-2xl p-6 relative group transition-all hover:border-white/10">
              <div className="flex items-center justify-between mb-6">
                 <div className="flex items-center gap-3">
                   <div className="px-2 py-1 bg-white/5 rounded text-[9px] font-bold text-white/40 uppercase tracking-widest">Node_{i.toString().padStart(2, '0')}</div>
                   <span className="text-xs font-bold text-white uppercase tracking-tight">{(s.name as string) || "Unnamed_Source"}</span>
                 </div>
                 <button
                  onClick={() => {
                    const next = [...sources];
                    next.splice(i, 1);
                    updateSettingsPath("pipeline.rag.sources", next);
                  }}
                  className="p-2 text-white/10 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Field label="System_Alias">
                  <Input
                    value={(s.name as string) ?? ""}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const next = [...sources];
                      next[i] = { ...next[i], name: e.target.value };
                      updateSettingsPath("pipeline.rag.sources", next);
                    }}
                    placeholder="MOUNT_IDENTITY"
                  />
                </Field>
                <Field label="Protocol">
                  <Select
                    value={(s.kind as string) ?? "local_dir"}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                      const next = [...sources];
                      next[i] = { ...next[i], kind: e.target.value };
                      updateSettingsPath("pipeline.rag.sources", next);
                    }}
                    className="bg-black/40 border-white/10"
                  >
                    <option value="local_dir">POSIX_FS</option>
                    <option value="url">HTTP_WEB</option>
                    <option value="s3">AWS_S3</option>
                  </Select>
                </Field>
                <Field label="Target_URI">
                  <Input
                    value={(s.path as string) ?? ""}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const next = [...sources];
                      next[i] = { ...next[i], path: e.target.value };
                      updateSettingsPath("pipeline.rag.sources", next);
                    }}
                    placeholder="/path/to/data"
                  />
                </Field>
              </div>

              <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <Switch
                    checked={Boolean(s.enabled ?? true)}
                    onChange={(next: boolean) => {
                      const updated = [...sources];
                      updated[i] = { ...updated[i], enabled: next };
                      updateSettingsPath("pipeline.rag.sources", updated);
                    }}
                  />
                  <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Active_Node</span>
                </div>
              </div>
            </div>
          ))}
          
          <button
            onClick={() =>
              updateSettingsPath("pipeline.rag.sources", [
                ...(sources ?? []),
                { name: "", kind: "local_dir", path: "", enabled: true },
              ])
            }
            className="w-full py-4 border border-dashed border-white/10 rounded-2xl flex items-center justify-center gap-3 text-white/20 hover:text-white/60 hover:border-white/20 hover:bg-white/[0.01] transition-all group"
          >
            <Plus size={16} className="group-hover:scale-125 transition-transform" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Mount_New_Source</span>
          </button>
        </div>
      </Section>

      <Section title="Budget_Kernel" description="Resource limits per mission and epoch.">
        <div className="bg-black/40 border border-white/5 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-3 gap-8">
           <div className="space-y-4">
             <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Token_Cap</span>
             <Row label="PER_24H" hint="Global token budget.">
               {num("pipeline.budgets.max_tokens_per_day")}
             </Row>
           </div>
           
           <div className="space-y-4">
             <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Credit_Cap</span>
             <Row label="USD_PER_24H" hint="Financial spending limit.">
               {num("pipeline.budgets.max_usd_per_day", 0.01)}
             </Row>
           </div>

           <div className="space-y-4">
             <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Mission_Scope</span>
             <Row label="PER_SESSION" hint="Limit tokens for single quest.">
               {num("pipeline.budgets.max_tokens_per_mission")}
             </Row>
           </div>
        </div>
      </Section>
    </div>
  );
}
