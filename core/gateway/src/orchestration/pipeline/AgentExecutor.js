"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentExecutor = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
class AgentExecutor {
    options;
    constructor(options) {
        this.options = options;
    }
    async gatherContext(agent, userTask) {
        return this.options.memory.getRelevantContext(agent, userTask);
    }
    async buildPrompt(agent, context, userTask, extraSkills) {
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
    async loadWorkflow(agent) {
        const workflowMap = {
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
        if (!file)
            return null;
        return fs
            .readFile(path.join(this.options.projectRoot, ".agent", "workflows", file), "utf-8")
            .catch(() => null);
    }
}
exports.AgentExecutor = AgentExecutor;
//# sourceMappingURL=AgentExecutor.js.map