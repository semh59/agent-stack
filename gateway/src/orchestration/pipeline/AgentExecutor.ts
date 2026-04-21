import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentDefinition } from "../agents";
import type { SharedMemory } from "../shared-memory";
import type { SkillMapper } from "../skill-mapper";
import type { TokenUsage } from "./pipeline-types";

export interface AgentExecutorOptions {
  projectRoot: string;
  memory: SharedMemory;
  skillMapper: SkillMapper | null;
}

export class AgentExecutor {
  constructor(private readonly options: AgentExecutorOptions) {}

  public async gatherContext(
    agent: AgentDefinition,
    userTask: string
  ): Promise<Record<string, string>> {
    const context: Record<string, string> = { _userTask: userTask };
    if (agent.inputFiles.length > 0) {
      Object.assign(
        context,
        await this.options.memory.readMultipleOutputs(agent.inputFiles)
      );
    }
    return context;
  }

  public async buildPrompt(
    agent: AgentDefinition,
    context: Record<string, string>,
    userTask: string,
    extraSkills?: string[]
  ): Promise<string> {
    let system = agent.systemPrompt;
    if (this.options.skillMapper) {
      system = await this.options.skillMapper
        .buildEnrichedPrompt(agent, extraSkills)
        .catch(() => system);
    }
    const logs = await this.options.memory.readLogTail(30);
    const workflow = await this.loadWorkflow(agent);

    return [
      `# ${agent.emoji} ROLE: ${agent.name} (${agent.role})`,
      "## REAL-WORLD TERMINAL LOGS\n```text\n" + (logs || "(Empty)") + "\n```",
      "## CORE INSTRUCTIONS\n" + system,
      agent.outputValidation
        ? `## REQUIRED SECTIONS\n${agent.outputValidation
            .map((s) => `- [ ] ${s}`)
            .join("\n")}`
        : "",
      workflow ? `## STANDARD WORKFLOW\n${workflow}` : "",
      "## USER OBJECTIVE\n" + userTask,
      "## SOURCE DOCUMENTS\n" +
        Object.keys(context)
          .filter((k) => !k.startsWith("_"))
          .map((k) => `### ${k}\n\`\`\`\n${context[k]}\n\`\`\``)
          .join("\n\n"),
    ].join("\n\n");
  }

  private async loadWorkflow(agent: AgentDefinition): Promise<string | null> {
    const workflowMap: Record<string, string> = {
      ceo: "1_gereksinim_analizi.md",
      pm: "1_gereksinim_analizi.md",
      architect: "2_mimari_tasarim.md",
      ui_ux: "10_ui_ux_refinement.md",
      database: "3_veritabani_sema.md",
      api_designer: "4_api_spec.md",
      backend: "7_backend_gelistirme.md",
      frontend: "8_frontend_gelistirme.md",
      auth: "5_guvenlik_uyum.md",
      integration: "9_entegrasyon_testi.md",
      unit_test: "6_birim_test.md",
      integration_test: "9_entegrasyon_testi.md",
      security: "5_guvenlik_uyum.md",
      performance: "11_performans_opt.md",
      code_review: "14_proje_teslim.md",
      docs: "12_dokumantasyon.md",
      tech_writer: "12_dokumantasyon.md",
      devops: "13_devops_deployment.md",
    };
    const file = workflowMap[agent.role];
    if (!file) return null;
    return fs
      .readFile(
        path.join(this.options.projectRoot, ".agent", "workflows", file),
        "utf-8"
      )
      .catch(() => null);
  }
}
