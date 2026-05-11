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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillGenerator = void 0;
const fs = __importStar(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * SkillGenerator: Analyzes pipeline outputs and proposes new SKILL.md files
 * based on detected patterns, lessons learned, and recurring problems.
 *
 * Skills are proposed → never auto-installed. User approval is required.
 */
class SkillGenerator {
    outputDir;
    constructor(projectRoot) {
        this.outputDir = node_path_1.default.resolve(projectRoot, '.ai-company', 'proposed-skills');
    }
    /**
     * Analyze pipeline outputs and generate skill proposals.
     * Reads from .ai-company/ shared memory after a pipeline run.
     */
    async generateProposals(memory) {
        const proposals = [];
        // 1. Analyze lessons-learned.md for recurring patterns
        const lessons = await memory.readAgentOutput('lessons-learned.md');
        if (lessons) {
            const lessonProposals = this.extractFromLessons(lessons);
            proposals.push(...lessonProposals);
        }
        // 2. Analyze security-audit.md for security patterns
        const securityAudit = await memory.readAgentOutput('security-audit.md');
        if (securityAudit) {
            const securityProposals = this.extractSecurityPatterns(securityAudit);
            proposals.push(...securityProposals);
        }
        // 3. Analyze code-review.md for code quality patterns
        const codeReview = await memory.readAgentOutput('code-review.md');
        if (codeReview) {
            const reviewProposals = this.extractCodePatterns(codeReview);
            proposals.push(...reviewProposals);
        }
        // 4. Analyze performance-report.md for optimization patterns
        const perfReport = await memory.readAgentOutput('performance-report.md');
        if (perfReport) {
            const perfProposals = this.extractPerformancePatterns(perfReport);
            proposals.push(...perfProposals);
        }
        // Filter low-confidence proposals
        const filtered = proposals.filter((p) => p.confidence >= 0.5);
        // Write proposals to disk
        if (filtered.length > 0) {
            await this.writeProposals(filtered);
        }
        return filtered;
    }
    /**
     * Write proposed skills to .ai-company/proposed-skills/
     */
    async writeProposals(proposals) {
        await fs.mkdir(this.outputDir, { recursive: true });
        const paths = [];
        for (const proposal of proposals) {
            const filename = `${proposal.name}.md`;
            const filepath = node_path_1.default.join(this.outputDir, filename);
            await fs.writeFile(filepath, proposal.content, 'utf-8');
            paths.push(filepath);
            console.log(`[SkillGenerator] Proposed skill: ${proposal.name} (confidence: ${proposal.confidence})`);
        }
        // Write index
        const indexContent = this.buildProposalIndex(proposals);
        const indexPath = node_path_1.default.join(this.outputDir, 'INDEX.md');
        await fs.writeFile(indexPath, indexContent, 'utf-8');
        paths.push(indexPath);
        return paths;
    }
    /**
     * Get existing proposals from disk.
     */
    async getExistingProposals() {
        try {
            const files = await fs.readdir(this.outputDir);
            return files.filter((f) => f.endsWith('.md') && f !== 'INDEX.md');
        }
        catch {
            return [];
        }
    }
    // â”€â”€ Pattern Extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    extractFromLessons(content) {
        const proposals = [];
        // Detect repeated error patterns
        const errorPatterns = content.match(/(?:error|bug|issue|problem|fix)(?:ed|ing)?:?\s+(.+)/gi);
        if (errorPatterns && errorPatterns.length >= 2) {
            proposals.push({
                name: 'project-error-patterns',
                description: 'Common error patterns and their fixes discovered during development',
                content: this.formatSkillMd('project-error-patterns', 'Known error patterns and fixes for this project. Use when debugging recurring issues.', '## Known Error Patterns\n\n' +
                    errorPatterns.map((p, i) => `### Pattern ${i + 1}\n${p.trim()}\n`).join('\n')),
                source: 'lessons_learned',
                confidence: 0.6,
            });
        }
        // Detect architectural decisions
        const decisions = content.match(/(?:decision|chose|selected|migrated|switched)(?:ed|ing)?:?\s+(.+)/gi);
        if (decisions && decisions.length >= 1) {
            proposals.push({
                name: 'project-decisions',
                description: 'Architectural and technical decisions made during development',
                content: this.formatSkillMd('project-decisions', 'Key architectural decisions and their rationale. Reference when making similar decisions.', '## Key Decisions\n\n' +
                    decisions.map((d, i) => `### Decision ${i + 1}\n${d.trim()}\n`).join('\n')),
                source: 'lessons_learned',
                confidence: 0.7,
            });
        }
        return proposals;
    }
    extractSecurityPatterns(content) {
        const proposals = [];
        const vulnerabilities = content.match(/(?:vulnerability|vuln|CVE|OWASP|injection|XSS|CSRF)(.+)/gi);
        if (vulnerabilities && vulnerabilities.length >= 2) {
            proposals.push({
                name: 'project-security-checklist',
                description: 'Project-specific security checklist from audit findings',
                content: this.formatSkillMd('project-security-checklist', 'Security patterns and vulnerabilities specific to this project. Run before deployment.', '## Security Findings\n\n' +
                    vulnerabilities.map((v, i) => `- **Finding ${i + 1}:** ${v.trim()}`).join('\n')),
                source: 'pattern_detection',
                confidence: 0.8,
            });
        }
        return proposals;
    }
    extractCodePatterns(content) {
        const proposals = [];
        const patterns = content.match(/(?:pattern|convention|standard|best practice|anti-pattern)(?:s)?:?\s+(.+)/gi);
        if (patterns && patterns.length >= 2) {
            proposals.push({
                name: 'project-code-conventions',
                description: 'Project-specific coding conventions from code review',
                content: this.formatSkillMd('project-code-conventions', 'Coding conventions and standards established during code review. Follow these patterns.', '## Coding Conventions\n\n' +
                    patterns.map((p, i) => `### Convention ${i + 1}\n${p.trim()}\n`).join('\n')),
                source: 'pattern_detection',
                confidence: 0.65,
            });
        }
        return proposals;
    }
    extractPerformancePatterns(content) {
        const proposals = [];
        const optimizations = content.match(/(?:optimize|bottleneck|slow|cache|index|N\+1|lazy|eager)(?:d|ing)?:?\s+(.+)/gi);
        if (optimizations && optimizations.length >= 2) {
            proposals.push({
                name: 'project-performance-tips',
                description: 'Performance optimization tips from profiling results',
                content: this.formatSkillMd('project-performance-tips', 'Performance optimizations and bottleneck fixes specific to this project.', '## Performance Tips\n\n' +
                    optimizations.map((o, i) => `### Optimization ${i + 1}\n${o.trim()}\n`).join('\n')),
                source: 'pattern_detection',
                confidence: 0.6,
            });
        }
        return proposals;
    }
    // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    /**
     * Format a proposal as a proper SKILL.md file.
     */
    formatSkillMd(name, description, body) {
        return `---
name: ${name}
description: ${description}
author: skill-generator (auto-proposed)
version: "1.0"
---

# ${name}

> **⚠️ Auto-proposed skill → requires user approval before installation.**
> Generated by SkillGenerator after pipeline analysis.

${body}
`;
    }
    /**
     * Build an index of all proposals.
     */
    buildProposalIndex(proposals) {
        const rows = proposals
            .map((p) => `| ${p.name} | ${p.description} | ${p.source} | ${(p.confidence * 100).toFixed(0)}% |`)
            .join('\n');
        return `# Proposed Skills → Review Required

> These skills were auto-generated from pipeline analysis.
> **To install:** Move the desired .md file to \`.agent/skills/<name>/SKILL.md\`
> **To discard:** Delete the file.

| Name | Description | Source | Confidence |
|------|-------------|--------|------------|
${rows}
`;
    }
}
exports.SkillGenerator = SkillGenerator;
//# sourceMappingURL=skill-generator.js.map