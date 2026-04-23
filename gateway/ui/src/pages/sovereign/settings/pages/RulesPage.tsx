/**
 * Rules & Prompts page — system prompt, mode-specific prompts, slash commands.
 */
import { BookOpen, Plus, Trash2, Layout, Command, FileText, Sparkles } from "lucide-react";
import {
  Field,
  Input,
  Row,
  Section,
  Textarea,
} from "../../../../components/sovereign/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";
import type { ChangeEvent } from "react";

interface SlashCommand {
  name: string;
  prompt: string;
  description?: string;
}

export function RulesPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();
  const modes =
    (getAtPath<Record<string, { label: string; prompt: string }>>(effective, "rules.modes", {}) as Record<
      string,
      { label: string; prompt: string }
    >) ?? {};
  const slash = (getAtPath<SlashCommand[]>(effective, "rules.slash_commands", []) ?? []) as SlashCommand[];

  return (
    <div className="space-y-12 pb-20">
      <div className="flex items-center gap-4 p-6 bg-orange-500/5 border border-orange-500/10 rounded-2xl mb-8">
        <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-orange-500/20 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.3)]">
           <BookOpen size={20} />
        </div>
        <div>
           <h2 className="text-sm font-bold uppercase tracking-widest text-white">Instructions & Rules</h2>
           <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Define how the AI should behave and respond to your commands.</p>
        </div>
      </div>

      <Section
        title="System Prompt"
        description="The base personality and rules for all AI sessions."
        icon={<Sparkles size={16} />}
      >
        <div className="relative group">
           <div className="absolute -inset-1 bg-gradient-to-r from-orange-500/10 to-transparent blur opacity-0 group-focus-within:opacity-100 transition-opacity" />
           <Textarea
              rows={10}
              value={getAtPath<string>(effective, "rules.system_prompt", "") ?? ""}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateSettingsPath("rules.system_prompt", e.target.value)}
              placeholder="You are Al.OS Kernel — a sovereign engineering intelligence..."
              className="relative bg-black/60 border-white/5 font-mono text-[13px] leading-relaxed p-6 rounded-2xl focus:border-orange-500/30 selection:bg-orange-500/30"
            />
        </div>
      </Section>

      <Section
        title="AI Modes"
        description="Custom focus modes that change the AI's persona or specialized knowledge."
        icon={<Layout size={16} />}
      >
        <div className="grid grid-cols-1 gap-6">
          {Object.entries(modes).map(([id, m]) => (
            <div key={id} className="group bg-black/40 border border-white/5 rounded-2xl p-6 transition-all hover:bg-white/[0.02]">
               <div className="flex items-center gap-3 mb-6">
                  <div className="px-2 py-1 bg-white/5 rounded text-[9px] font-bold text-white/40 uppercase tracking-widest leading-none">MODE_HEX_{id.toUpperCase()}</div>
                  <Input
                    value={m.label}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateSettingsPath(`rules.modes.${id}`, { ...m, label: e.target.value })
                    }
                    className="bg-transparent border-none p-0 focus:ring-0 text-sm font-bold uppercase tracking-tight text-white m-0 h-auto"
                  />
               </div>
               
               <Field label="Instructions" hint="Instructions specific to this mode.">
                  <Textarea
                    rows={6}
                    value={m.prompt}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                      updateSettingsPath(`rules.modes.${id}`, { ...m, prompt: e.target.value })
                    }
                    className="bg-black/20 border-white/5 font-mono text-xs p-4"
                  />
               </Field>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="External Rules"
        description="Import rules from markdown files on your drive."
        icon={<FileText size={16} />}
      >
        <div className="bg-black/40 border border-white/5 rounded-2xl p-6">
          <Row label="Rules_Source" hint="Absolute or relative path to .md ruleset (e.g. AGENTS.md).">
            <Input
              value={getAtPath<string>(effective, "rules.rules_file", "") ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => updateSettingsPath("rules.rules_file", e.target.value)}
              placeholder="./AGENTS.md"
              className="font-mono text-xs max-w-md"
            />
          </Row>
        </div>
      </Section>

      <Section
        title="Slash Commands"
        description="Create shortcuts for frequently used prompts."
        icon={<Command size={16} />}
        action={
          <button
            onClick={() =>
              updateSettingsPath("rules.slash_commands", [
                ...slash,
                { name: "new-command", prompt: "" },
              ])
            }
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[9px] font-bold uppercase tracking-widest text-white/40 hover:bg-white/10 hover:text-white transition-all"
          >
            <Plus size={12} />
            REGISTER COMMAND
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          {slash.map((cmd, i) => (
            <div key={i} className="bg-black/40 border border-white/5 rounded-xl p-6 relative group transition-all hover:border-white/10">
               <div className="flex items-start justify-between gap-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
                     <Field label="Command Name">
                        <div className="flex items-center gap-2 px-3 py-2 bg-black/60 border border-white/5 rounded-lg">
                           <span className="text-white/20 font-bold">/</span>
                           <Input
                             value={cmd.name}
                             onChange={(e: ChangeEvent<HTMLInputElement>) => {
                               const next = [...slash];
                               next[i] = { ...next[i]!, name: e.target.value };
                               updateSettingsPath("rules.slash_commands", next);
                             }}
                             className="bg-transparent border-none p-0 focus:ring-0 text-xs font-bold uppercase tracking-tight text-white h-auto"
                           />
                        </div>
                     </Field>
                     <Field label="Description">
                        <Input
                          value={cmd.description ?? ""}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => {
                            const next = [...slash];
                            next[i] = { ...next[i]!, description: e.target.value };
                            updateSettingsPath("rules.slash_commands", next);
                          }}
                          className="bg-black/20 border-white/5 text-xs h-9"
                          placeholder="Brief mission context..."
                        />
                     </Field>
                  </div>
                  <button
                    onClick={() => {
                      const next = [...slash];
                      next.splice(i, 1);
                      updateSettingsPath("rules.slash_commands", next);
                    }}
                    className="p-2 text-white/10 hover:text-red-400 transition-colors mt-6"
                  >
                    <Trash2 size={16} />
                  </button>
               </div>
               
               <div className="mt-6">
                  <Field label="Prompt Template" hint="The instructions to send when using this command.">
                    <Textarea
                      rows={4}
                      value={cmd.prompt}
                      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                        const next = [...slash];
                        next[i] = { ...next[i]!, prompt: e.target.value };
                        updateSettingsPath("rules.slash_commands", next);
                      }}
                      className="bg-black/20 border-white/5 font-mono text-xs p-4"
                      placeholder="KERNEL_DISPATCH: [INSTRUCTION_SET]"
                    />
                  </Field>
               </div>
            </div>
          ))}
          
          {slash.length === 0 && (
            <div className="py-10 border border-dashed border-white/5 rounded-2xl text-center text-[10px] font-bold uppercase tracking-widest text-white/10">
              No custom directives registered.
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
