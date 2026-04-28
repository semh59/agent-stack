/**
 * Providers page — configuring the bridge connection to various LLM backends.
 */
import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, Activity, Zap } from "lucide-react";

import {
  Field,
  Input,
  SecretInput,
  Switch,
} from "../../../../components/sovereign/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, isSecretSet, useEffectiveSettings } from "../useEffectiveSettings";
import type { ChangeEvent } from "react";

interface ProviderDef {
  id: string;
  label: string;
  blurb: string;
  kind: "cloud" | "local" | "enterprise";
  helpUrl?: string;
  fields: Array<{ id: string; label: string; type: "secret" | "text" | "number"; hint?: string }>;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT-4o, o1-preview, and more. Global standard for reasoning.",
    kind: "cloud",
    helpUrl: "https://platform.openai.com/api-keys",
    fields: [{ id: "api_key", label: "API Key", type: "secret", hint: "sk-..." }],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    blurb: "Claude 3.5 Sonnet — the gold standard for coding missions.",
    kind: "cloud",
    helpUrl: "https://console.anthropic.com/settings/keys",
    fields: [{ id: "api_key", label: "API Key", type: "secret", hint: "sk-ant-..." }],
  },
  {
    id: "google",
    label: "Google AI",
    blurb: "Gemini 1.5 Pro — massive 2M token context window.",
    kind: "cloud",
    helpUrl: "https://aistudio.google.com/app/apikey",
    fields: [{ id: "api_key", label: "API Key", type: "secret" }],
  },
  {
    id: "groq",
    label: "Groq",
    blurb: "LPU™ Inference Engine — lightning fast Llama 3 generation.",
    kind: "cloud",
    helpUrl: "https://console.groq.com/keys",
    fields: [{ id: "api_key", label: "API Key", type: "secret" }],
  },
  {
    id: "ollama",
    label: "Ollama",
    blurb: "Alloy intelligence running locally on your hardware.",
    kind: "local",
    helpUrl: "https://ollama.com",
    fields: [
      { id: "endpoint", label: "Endpoint", type: "text", hint: "http://localhost:11434" },
      { id: "default_model", label: "Model", type: "text", hint: "qwen2.5:7b" },
    ],
  },
];

export function ProvidersPage() {
  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center gap-4 p-6 bg-molten/5 border border-molten/10 rounded-2xl mb-8">
        <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-molten/20 text-molten shadow-alloy-molten-glow">
           <Zap size={20} />
        </div>
        <div>
           <h2 className="text-sm font-bold uppercase tracking-widest text-white">Connect AI Models</h2>
           <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Configure your API keys to enable coding assistance.</p>
        </div>
      </div>

      <div className="space-y-6">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} def={p} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ def }: { def: ProviderDef }) {
  const [expanded, setExpanded] = useState(false);
  const effective = useEffectiveSettings();
  const { providerProbes, probeProvider, updateSettingsPath } = useAlloyStore();
  const base = `providers.${def.id}`;
  const enabled = getAtPath<boolean>(effective, `${base}.enabled`, false);
  const probe = providerProbes[def.id];

  return (
    <div className="group relative bg-black/40 border border-white/5 rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.02] shadow-alloy-elevated overflow-hidden">
      {enabled && (
        <div className="absolute top-0 right-0 h-32 w-32 bg-[var(--color-alloy-accent)]/5 blur-3xl pointer-events-none" />
      )}

      <div className="flex items-start justify-between">
        <div className="flex items-start gap-6">
          <div
            className={clsx(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 text-lg font-black uppercase tracking-tighter transition-all duration-500",
              enabled
                ? "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)] shadow-alloy-glow text-black"
                : "border-white/5 bg-white/[0.02] text-white/10"
            )}
          >
            {def.label.slice(0, 2)}
          </div>
          
          <div className="pt-1">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-bold tracking-tight text-white uppercase">{def.label}</h3>
              <div className="h-4 w-[1px] bg-white/10" />
              <KindBadge kind={def.kind} />
              <ProbeBadge probe={probe} />
            </div>
            <p className="mt-2 text-xs text-white/30 leading-relaxed max-w-md font-medium tracking-tight">
              {def.blurb}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           <div className="flex flex-col items-end gap-1">
             <span className="text-[9px] font-bold text-white/10 tracking-[0.2em] uppercase">Status</span>
             <Switch
                ariaLabel={`Enable ${def.label}`}
                checked={enabled}
                onChange={(next: boolean) => updateSettingsPath(`${base}.enabled`, next)}
              />
           </div>
           
           <button
              onClick={() => setExpanded((v) => !v)}
              className={clsx(
                "h-10 w-10 flex items-center justify-center rounded-xl transition-all",
                expanded ? "bg-white/10 text-white" : "text-white/20 hover:bg-white/5"
              )}
            >
              <ChevronDown
                size={20}
                className={clsx("transition-transform duration-300", expanded && "rotate-180")}
              />
           </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-8 pt-8 border-t border-white/5 space-y-6 animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="grid grid-cols-1 gap-6">
            <ProviderFields def={def} />
          </div>
          
          <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <div className="flex items-center gap-4">
              <button
                onClick={() => probeProvider(def.id)}
                disabled={probe && "loading" in probe}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/60 hover:bg-white/10 hover:text-white transition-all disabled:opacity-20"
              >
                <Activity size={12} className={clsx(probe && "loading" in probe && "animate-spin")} />
                {probe && "loading" in probe ? "Testing..." : "Test Connection"}
              </button>
              
              {def.helpUrl && (
                <a
                  href={def.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-alloy-accent)] opacity-40 hover:opacity-100 transition-opacity"
                >
                  Get API Key ↗
                </a>
              )}
            </div>
            
            {probe && "ok" in probe && (
              <div className="text-[10px] font-mono text-white/20">
                Latency: {probe.latency_ms}ms // Models: {probe.models_seen || 0}
              </div>
            )}
          </div>
          
          {probe && "ok" in probe && !probe.ok && (
             <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-[11px] text-red-200/80 font-mono italic">
               Error: {probe.reason}
             </div>
          )}
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: ProviderDef["kind"] }) {
  if (kind === "local") return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-widest">Local</span>;
  if (kind === "enterprise") return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-widest">Enterprise</span>;
  return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-white/5 text-white/40 border border-white/5 uppercase tracking-widest">Cloud</span>;
}

function ProbeBadge({ probe }: { probe: ReturnType<typeof useAlloyStore.getState>["providerProbes"][string] | undefined }) {
  if (!probe) return null;
  if ("loading" in probe) return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-white/5 text-[var(--color-alloy-accent)] animate-pulse uppercase tracking-widest">Probing...</span>;
  return probe.ok ? (
    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-widest">{probe.latency_ms}ms // OK</span>
  ) : (
    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-widest">Failed</span>
  );
}

function ProviderFields({ def }: { def: ProviderDef }) {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();
  const base = `providers.${def.id}`;

  const humanize = (s: string) => s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  const strField = (field: string, hint?: string, placeholder?: string) => {
    const dotted = `${base}.${field}`;
    const v = getAtPath<string>(effective, dotted, "");
    return (
      <Field label={humanize(field)} hint={hint}>
        <Input
          value={v ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateSettingsPath(dotted, e.target.value)}
          placeholder={placeholder}
        />
      </Field>
    );
  };

  const numField = (field: string, hint?: string) => {
    const dotted = `${base}.${field}`;
    const v = getAtPath<number>(effective, dotted, 0);
    return (
      <Field label={humanize(field)} hint={hint}>
        <Input
          type="number"
          value={Number.isFinite(v) ? String(v) : ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateSettingsPath(dotted, e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </Field>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {def.fields.map((f) => {
        const dotted = `${base}.${f.id}`;

        if (f.type === "secret") {
          const secretState = isSecretSet(effective, dotted);
          return (
            <Field key={f.id} label={f.label} hint={f.hint}>
              <SecretInput
                isSet={secretState.set}
                updatedAt={secretState.updated_at}
                onChange={(next: string) => updateSettingsPath(dotted, next)}
                onClear={() => updateSettingsPath(dotted, "")}
              />
            </Field>
          );
        }

        if (f.type === "number") return numField(f.id, f.hint);
        
        return strField(f.id, f.hint);
      })}

      {def.id === "openai" && (
        <>
          {strField("organization_id", "Optional Org ID for billing.")}
          {strField("project_id", "Optional Project ID.")}
        </>
      )}

      {def.id === "anthropic" && (
        <Field label="Custom Header" hint="Optional JSON for extra headers.">
           <Input
             value={getAtPath<string>(effective, `${base}.custom_header`, "")}
             onChange={(e: ChangeEvent<HTMLInputElement>) => updateSettingsPath(`${base}.custom_header`, e.target.value)}
             placeholder='{"X-Extra": "value"}'
           />
        </Field>
      )}
    </div>
  );
}
