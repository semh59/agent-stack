import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { SharedMemory } from './shared-memory';

/**
 * A proposed skill generated from pipeline learnings.
 */
export interface ProposedSkill {
  name: string;
  description: string;
  content: string;
  source: 'pattern_detection' | 'lessons_learned' | 'error_pattern';
  confidence: number; // 0-1
}

/**
 * SkillGenerator: Analyzes pipeline outputs and proposes new SKILL.md files
 * based on detected patterns, lessons learned, and recurring problems.
 *
 * Skills are proposed â€” never auto-installed. User approval is required.
 */
export class SkillGenerator {
  private outputDir: string;

  constructor(projectRoot: string) {
    this.outputDir = path.resolve(projectRoot, '.ai-company', 'proposed-skills');
  }

  /**
   * Analyze pipeline outputs and generate skill proposals.
   * Reads from .ai-company/ shared memory after a pipeline run.
   */
  public async generateProposals(memory: SharedMemory): Promise<ProposedSkill[]> {
    const proposals: ProposedSkill[] = [];

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
  public async writeProposals(proposals: ProposedSkill[]): Promise<string[]> {
    await fs.mkdir(this.outputDir, { recursive: true });
    const paths: string[] = [];

    for (const proposal of proposals) {
      const filename = `${proposal.name}.md`;
      const filepath = path.join(this.outputDir, filename);
      await fs.writeFile(filepath, proposal.content, 'utf-8');
      paths.push(filepath);
      console.log(`[SkillGenerator] Proposed skill: ${proposal.name} (confidence: ${proposal.confidence})`);
    }

    // Write index
    const indexContent = this.buildProposalIndex(proposals);
    const indexPath = path.join(this.outputDir, 'INDEX.md');
    await fs.writeFile(indexPath, indexContent, 'utf-8');
    paths.push(indexPath);

    return paths;
  }

  /**
   * Get existing proposals from disk.
   */
  public async getExistingProposals(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.outputDir);
      return files.filter((f) => f.endsWith('.md') && f !== 'INDEX.md');
    } catch {
      return [];
    }
  }

  // â”€â”€ Pattern Extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private extractFromLessons(content: string): ProposedSkill[] {
    const proposals: ProposedSkill[] = [];

    // Detect repeated error patterns
    const errorPatterns = content.match(/(?:error|bug|issue|problem|fix)(?:ed|ing)?:?\s+(.+)/gi);
    if (errorPatterns && errorPatterns.length >= 2) {
      proposals.push({
        name: 'project-error-patterns',
        description: 'Common error patterns and their fixes discovered during development',
        content: this.formatSkillMd(
          'project-error-patterns',
          'Known error patterns and fixes for this project. Use when debugging recurring issues.',
          '## Known Error Patterns\n\n' +
            errorPatterns.map((p, i) => `### Pattern ${i + 1}\n${p.trim()}\n`).join('\n')
        ),
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
        content: this.formatSkillMd(
          'project-decisions',
          'Key architectural decisions and their rationale. Reference when making similar decisions.',
          '## Key Decisions\n\n' +
            decisions.map((d, i) => `### Decision ${i + 1}\n${d.trim()}\n`).join('\n')
        ),
        source: 'lessons_learned',
        confidence: 0.7,
      });
    }

    return proposals;
  }

  private extractSecurityPatterns(content: string): ProposedSkill[] {
    const proposals: ProposedSkill[] = [];

    const vulnerabilities = content.match(/(?:vulnerability|vuln|CVE|OWASP|injection|XSS|CSRF)(.+)/gi);
    if (vulnerabilities && vulnerabilities.length >= 2) {
      proposals.push({
        name: 'project-security-checklist',
        description: 'Project-specific security checklist from audit findings',
        content: this.formatSkillMd(
          'project-security-checklist',
          'Security patterns and vulnerabilities specific to this project. Run before deployment.',
          '## Security Findings\n\n' +
            vulnerabilities.map((v, i) => `- **Finding ${i + 1}:** ${v.trim()}`).join('\n')
        ),
        source: 'pattern_detection',
        confidence: 0.8,
      });
    }

    return proposals;
  }

  private extractCodePatterns(content: string): ProposedSkill[] {
    const proposals: ProposedSkill[] = [];

    const patterns = content.match(/(?:pattern|convention|standard|best practice|anti-pattern)(?:s)?:?\s+(.+)/gi);
    if (patterns && patterns.length >= 2) {
      proposals.push({
        name: 'project-code-conventions',
        description: 'Project-specific coding conventions from code review',
        content: this.formatSkillMd(
          'project-code-conventions',
          'Coding conventions and standards established during code review. Follow these patterns.',
          '## Coding Conventions\n\n' +
            patterns.map((p, i) => `### Convention ${i + 1}\n${p.trim()}\n`).join('\n')
        ),
        source: 'pattern_detection',
        confidence: 0.65,
      });
    }

    return proposals;
  }

  private extractPerformancePatterns(content: string): ProposedSkill[] {
    const proposals: ProposedSkill[] = [];

    const optimizations = content.match(/(?:optimize|bottleneck|slow|cache|index|N\+1|lazy|eager)(?:d|ing)?:?\s+(.+)/gi);
    if (optimizations && optimizations.length >= 2) {
      proposals.push({
        name: 'project-performance-tips',
        description: 'Performance optimization tips from profiling results',
        content: this.formatSkillMd(
          'project-performance-tips',
          'Performance optimizations and bottleneck fixes specific to this project.',
          '## Performance Tips\n\n' +
            optimizations.map((o, i) => `### Optimization ${i + 1}\n${o.trim()}\n`).join('\n')
        ),
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
  private formatSkillMd(name: string, description: string, body: string): string {
    return `---
name: ${name}
description: ${description}
author: skill-generator (auto-proposed)
version: "1.0"
---

# ${name}

> **âš ï¸ Auto-proposed skill â€” requires user approval before installation.**
> Generated by SkillGenerator after pipeline analysis.

${body}
`;
  }

  /**
   * Build an index of all proposals.
   */
  private buildProposalIndex(proposals: ProposedSkill[]): string {
    const rows = proposals
      .map(
        (p) =>
          `| ${p.name} | ${p.description} | ${p.source} | ${(p.confidence * 100).toFixed(0)}% |`
      )
      .join('\n');

    return `# Proposed Skills â€” Review Required

> These skills were auto-generated from pipeline analysis.
> **To install:** Move the desired .md file to \`.agent/skills/<name>/SKILL.md\`
> **To discard:** Delete the file.

| Name | Description | Source | Confidence |
|------|-------------|--------|------------|
${rows}
`;
  }
}
