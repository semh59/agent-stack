/**
 * Routing page — decide which model each role / complexity tier uses.
 *
 * Two surfaces:
 *   1. Role map         — chat / autocomplete / edit / embed / rerank
 *   2. Complexity map   — low / medium / high (used by the MAB router)
 *   3. Fallback chain   — ordered list, first available wins
 *
 * Model IDs are strings of the form `provider:model` or `provider/model`.
 * We don't force a dropdown because the user may configure a provider we
 * don't know about — the input is free-form with autocomplete hints.
 */
import { Trash2, Plus, Network, ListOrdered } from "lucide-react";
import { useEffectiveSettings, getAtPath } from "../useEffectiveSettings";
import { useAlloyStore } from "../../../../store/alloyStore";
import {
  Button,
  Field,
  Input,
  Row,
  Section,
} from "../../../../components/alloy/primitives";

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
  const fallback = getAtPath<string[]>(effective, "routing.fallback_chain", []);

  const strField = (dotted: string, placeholder?: string) => (
    <Input
      value={getAtPath<string>(effective, dotted, "") ?? ""}
      onChange={(e) => updateSettingsPath(dotted, e.target.value)}
      placeholder={placeholder ?? "provider:model"}
    />
  );

  return (
    <div className="space-y-10">
      <Section
        title="Role routing"
        description="Pick the right model for each job. Typed as provider:model — e.g. ollama:qwen2.5:7b."
        icon={<Network size={16} />}
      >
        <div>
          {ROLES.map((r) => (
            <Row key={r.key} label={r.label} hint={r.hint}>
              {strField(`routing.roles.${r.key}`)}
            </Row>
          ))}
        </div>
      </Section>

      <Section
        title="Complexity tiers"
        description="The router scales up to more expensive models as the task complexity grows."
      >
        <div>
          {COMPLEXITY.map((c) => (
            <Row key={c.key} label={c.label} hint={c.hint}>
              {strField(`routing.complexity.${c.key}`)}
            </Row>
          ))}
        </div>
      </Section>

      <Section
        title="Fallback chain"
        description="If the first model errors or times out, we walk the chain top-down."
        icon={<ListOrdered size={16} />}
      >
        <div className="space-y-2">
          {(fallback ?? []).map((modelRef, i) => (
            <div key={i} className="flex gap-2">
              <Field label={`Position ${i + 1}`} className="flex-1">
                <Input
                  value={modelRef}
                  onChange={(e) => {
                    const next = [...fallback];
                    next[i] = e.target.value;
                    updateSettingsPath("routing.fallback_chain", next);
                  }}
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                className="self-end"
                onClick={() => {
                  const next = [...fallback];
                  next.splice(i, 1);
                  updateSettingsPath("routing.fallback_chain", next);
                }}
                icon={<Trash2 size={14} />}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() =>
              updateSettingsPath("routing.fallback_chain", [...(fallback ?? []), ""])
            }
          >
            Add fallback
          </Button>
        </div>
      </Section>
    </div>
  );
}
