/**
 * Rules & Prompts page — system prompt, mode-specific prompts, slash commands.
 */
import { BookOpen, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  Row,
  Section,
  Textarea,
} from "../../../../components/sovereign/primitives";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";

interface SlashCommand {
  name: string;
  prompt: string;
  description?: string;
}

export function RulesPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useSovereignStore();
  const modes =
    (getAtPath<Record<string, { label: string; prompt: string }>>(effective, "rules.modes", {}) as Record<
      string,
      { label: string; prompt: string }
    >) ?? {};
  const slash = (getAtPath<SlashCommand[]>(effective, "rules.slash_commands", []) ?? []) as SlashCommand[];

  return (
    <div className="space-y-10">
      <Section
        title="System prompt"
        description="Always prepended before any conversation. Shared across every mode."
        icon={<BookOpen size={16} />}
      >
        <Textarea
          rows={8}
          value={getAtPath<string>(effective, "rules.system_prompt", "") ?? ""}
          onChange={(e) => updateSettingsPath("rules.system_prompt", e.target.value)}
          placeholder="You are a senior engineer…"
        />
      </Section>

      <Section
        title="Modes"
        description="Each mode swaps in its own prompt. Code, architect, debug, ask, autonomous ship by default."
      >
        <div className="space-y-4">
          {Object.entries(modes).map(([id, m]) => (
            <Card key={id}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr]">
                <Field label={`Mode: ${id}`} hint="Label is what users see; ID is the routable identifier.">
                  <Input
                    value={m.label}
                    onChange={(e) =>
                      updateSettingsPath(`rules.modes.${id}`, { ...m, label: e.target.value })
                    }
                  />
                </Field>
                <Field label="Prompt">
                  <Textarea
                    rows={6}
                    value={m.prompt}
                    onChange={(e) =>
                      updateSettingsPath(`rules.modes.${id}`, { ...m, prompt: e.target.value })
                    }
                  />
                </Field>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Rules file"
        description="Path to an additional rules file layered on top of the system prompt (e.g. AGENTS.md)."
      >
        <Row label="Path">
          <Input
            value={getAtPath<string>(effective, "rules.rules_file", "") ?? ""}
            onChange={(e) => updateSettingsPath("rules.rules_file", e.target.value)}
            placeholder="./AGENTS.md"
          />
        </Row>
      </Section>

      <Section
        title="Slash commands"
        description="Custom shortcuts users can invoke in chat with /name."
        action={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() =>
              updateSettingsPath("rules.slash_commands", [
                ...slash,
                { name: "new-command", prompt: "" },
              ])
            }
          >
            Add command
          </Button>
        }
      >
        <div className="space-y-3">
          {slash.map((cmd, i) => (
            <Card key={i} density="compact">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
                <Field label="Name">
                  <Input
                    value={cmd.name}
                    onChange={(e) => {
                      const next = [...slash];
                      next[i] = { ...next[i]!, name: e.target.value };
                      updateSettingsPath("rules.slash_commands", next);
                    }}
                  />
                </Field>
                <Field label="Description">
                  <Input
                    value={cmd.description ?? ""}
                    onChange={(e) => {
                      const next = [...slash];
                      next[i] = { ...next[i]!, description: e.target.value };
                      updateSettingsPath("rules.slash_commands", next);
                    }}
                  />
                </Field>
                <Field label="Prompt">
                  <Textarea
                    rows={3}
                    value={cmd.prompt}
                    onChange={(e) => {
                      const next = [...slash];
                      next[i] = { ...next[i]!, prompt: e.target.value };
                      updateSettingsPath("rules.slash_commands", next);
                    }}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    const next = [...slash];
                    next.splice(i, 1);
                    updateSettingsPath("rules.slash_commands", next);
                  }}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
          {slash.length === 0 ? (
            <Card className="text-center text-sm text-[var(--color-loji-text-sec)]">
              No slash commands yet. Add one to create shortcuts like /review or /test.
            </Card>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
