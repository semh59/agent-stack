/**
 * Pipeline page — tuning the optimization stack on top of the bridge.
 *
 * Layers can each be toggled on/off. The cache, MAB, RAG, compression,
 * and budget sub-sections have their own knobs. Every change is applied
 * via PATCH so you don't have to re-send the whole settings tree.
 */
import { Layers as LayersIcon, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  Row,
  Section,
  Select,
  Switch,
} from "../../../../components/sovereign/primitives";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";

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
  const { updateSettingsPath } = useSovereignStore();
  const sources = getAtPath<Array<Record<string, unknown>>>(effective, "pipeline.rag.sources", []);

  const num = (dotted: string, step?: number) => (
    <Input
      type="number"
      step={step}
      value={String(getAtPath<number>(effective, dotted, 0) ?? 0)}
      onChange={(e) =>
        updateSettingsPath(dotted, e.target.value === "" ? undefined : Number(e.target.value))
      }
    />
  );

  const str = (dotted: string, placeholder?: string) => (
    <Input
      value={getAtPath<string>(effective, dotted, "") ?? ""}
      onChange={(e) => updateSettingsPath(dotted, e.target.value)}
      placeholder={placeholder}
    />
  );

  const dedupMode = getAtPath<string>(effective, "pipeline.compression.dedup_mode", "exact");

  return (
    <div className="space-y-10">
      <Section
        title="Optimization layers"
        description="Toggle the bridge pipeline layers. Each layer runs in order from top to bottom."
        icon={<LayersIcon size={16} />}
      >
        <Card>
          {LAYERS.map((l) => (
            <Row key={l.key} label={l.label} hint={l.hint}>
              <Switch
                ariaLabel={l.label}
                checked={getAtPath<boolean>(effective, `pipeline.layers.${l.key}`, true) ?? true}
                onChange={(next) => updateSettingsPath(`pipeline.layers.${l.key}`, next)}
              />
            </Row>
          ))}
        </Card>
      </Section>

      <Section title="Cache">
        <Card>
          <Row label="Exact match TTL (seconds)" hint="0 disables the exact-match cache.">
            {num("pipeline.cache.exact_ttl_s")}
          </Row>
          <Row label="Semantic TTL (seconds)">
            {num("pipeline.cache.semantic_ttl_s")}
          </Row>
          <Row label="Semantic similarity threshold" hint="0.87 is a good starting point.">
            {num("pipeline.cache.semantic_threshold", 0.01)}
          </Row>
          <Row label="Max entries" hint="LRU eviction once this is exceeded.">
            {num("pipeline.cache.max_entries")}
          </Row>
        </Card>
      </Section>

      <Section
        title="Multi-Armed Bandit"
        description="The MAB picks the best layer combination over time. ε controls exploration."
      >
        <Card>
          <Row label="Epsilon" hint="Share of requests spent exploring. 0.1 = 10%.">
            {num("pipeline.mab.epsilon", 0.01)}
          </Row>
          <Row label="Reward threshold" hint="Savings% above this gives positive reward.">
            {num("pipeline.mab.reward_threshold", 0.01)}
          </Row>
        </Card>
      </Section>

      <Section title="Compression">
        <Card>
          <Row label="LLMLingua target ratio">{num("pipeline.compression.llmlingua_target_ratio", 0.05)}</Row>
          <Row label="Caveman endpoint" hint="Optional external service URL.">
            {str("pipeline.compression.caveman_endpoint", "https://caveman.example.com")}
          </Row>
          <Row label="Dedup mode">
            <Select
              value={dedupMode ?? "exact"}
              onChange={(e) => updateSettingsPath("pipeline.compression.dedup_mode", e.target.value)}
            >
              <option value="off">Off</option>
              <option value="exact">Exact</option>
              <option value="semantic">Semantic</option>
            </Select>
          </Row>
        </Card>
      </Section>

      <Section title="RAG sources" description="Directories, URLs, or S3 buckets indexed for retrieval.">
        <div className="space-y-3">
          {(sources ?? []).map((s, i) => (
            <Card key={i} density="compact" className="relative">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Name">
                  <Input
                    value={(s.name as string) ?? ""}
                    onChange={(e) => {
                      const next = [...sources];
                      next[i] = { ...next[i], name: e.target.value };
                      updateSettingsPath("pipeline.rag.sources", next);
                    }}
                  />
                </Field>
                <Field label="Kind">
                  <Select
                    value={(s.kind as string) ?? "local_dir"}
                    onChange={(e) => {
                      const next = [...sources];
                      next[i] = { ...next[i], kind: e.target.value };
                      updateSettingsPath("pipeline.rag.sources", next);
                    }}
                  >
                    <option value="local_dir">Local directory</option>
                    <option value="url">URL</option>
                    <option value="s3">S3</option>
                  </Select>
                </Field>
                <Field label="Path">
                  <Input
                    value={(s.path as string) ?? ""}
                    onChange={(e) => {
                      const next = [...sources];
                      next[i] = { ...next[i], path: e.target.value };
                      updateSettingsPath("pipeline.rag.sources", next);
                    }}
                  />
                </Field>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-[var(--color-loji-text-sec)]">
                  <Switch
                    checked={Boolean(s.enabled ?? true)}
                    onChange={(next) => {
                      const updated = [...sources];
                      updated[i] = { ...updated[i], enabled: next };
                      updateSettingsPath("pipeline.rag.sources", updated);
                    }}
                  />
                  Enabled
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    const next = [...sources];
                    next.splice(i, 1);
                    updateSettingsPath("pipeline.rag.sources", next);
                  }}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() =>
              updateSettingsPath("pipeline.rag.sources", [
                ...(sources ?? []),
                { name: "", kind: "local_dir", path: "", enabled: true },
              ])
            }
          >
            Add source
          </Button>
        </div>
        <Card className="mt-4">
          <Row label="Chunk size (tokens)">{num("pipeline.rag.chunk_size")}</Row>
          <Row label="Top-K">{num("pipeline.rag.top_k")}</Row>
        </Card>
      </Section>

      <Section title="Budgets" description="Hard caps on tokens + spend. 0 means no cap.">
        <Card>
          <Row label="Max tokens / day">{num("pipeline.budgets.max_tokens_per_day")}</Row>
          <Row label="Max USD / day">{num("pipeline.budgets.max_usd_per_day", 0.01)}</Row>
          <Row label="Max tokens / mission">{num("pipeline.budgets.max_tokens_per_mission")}</Row>
        </Card>
      </Section>
    </div>
  );
}
