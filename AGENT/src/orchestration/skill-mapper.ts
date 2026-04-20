import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentDefinition } from './agents';

/**
 * Static mapping: agent role â†’ relevant skill names from .agent/skills/.
 * Max 3 skills per agent to stay within token budget (~15K extra tokens).
 */
const SKILL_MAP: Record<string, string[]> = {
  // MANAGEMENT
  ceo:              ['architecture', 'senior-architect', 'concise-planning'],
  pm:               ['product-manager-toolkit', 'plan-writing', 'concise-planning'],
  architect:        ['senior-architect', 'architecture-patterns', 'architecture-decision-records'],

  // DESIGN
  ui_ux:            ['frontend-design', 'ui-ux-pro-max', 'tailwind-design-system'],
  database:         ['database-design', 'postgres-best-practices', 'sql-optimization-patterns'],
  api_designer:     ['api-design-principles', 'api-patterns', 'api-documenter'],

  // DEVELOPMENT
  backend:          ['fastapi-pro', 'nodejs-backend-patterns', 'cc-skill-backend-patterns'],
  frontend:         ['react-best-practices', 'nextjs-best-practices', 'cc-skill-frontend-patterns'],
  auth:             ['auth-implementation-patterns', 'cc-skill-security-review', 'api-security-best-practices'],
  integration:      ['api-testing-observability-api-mock', 'error-handling-patterns', 'e2e-testing-patterns'],

  // QUALITY
  unit_test:        ['tdd-workflow', 'testing-patterns', 'javascript-testing-patterns'],
  integration_test: ['playwright-skill', 'python-testing-patterns', 'e2e-testing-patterns'],
  security:         ['vulnerability-scanner', 'cc-skill-security-review', 'api-security-best-practices'],
  performance:      ['application-performance-performance-optimization', 'web-performance-optimization', 'performance-profiling'],
  code_review:      ['code-review-checklist', 'clean-code', 'cc-skill-coding-standards'],

  // OUTPUT
  docs:             ['readme', 'code-documentation-doc-generate', 'documentation-templates'],
  tech_writer:      ['changelog-automation', 'api-documenter', 'documentation-templates'],
  devops:           ['deployment-procedures', 'docker-expert', 'github-actions-templates'],
};

/**
 * Max number of skills injected per agent prompt.
 */
const MAX_SKILLS_PER_AGENT = 3;

/**
 * Max characters to read from a single SKILL.md (token budget guard).
 */
const MAX_SKILL_CHARS = 8000;

// Removed global skillCache to avoid state leaks between instances

/**
 * SkillMapper: Maps agent roles to relevant SKILL.md files and injects
 * them into agent prompts via lazy-loading.
 */
export class SkillMapper {
  private skillsDir: string;
  private skillCache = new Map<string, string>();

  /**
   * @param skillsDir Absolute path to the skills directory (e.g., .agent/skills/)
   */
  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    console.log(`[SkillMapper] Initialized with skillsDir: ${this.skillsDir}`);
  }

  /**
   * Get the list of installed skills from the filesystem.
   */
  public async getInstalledSkills(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      return entries
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch {
      return [];
    }
  }

  /**
   * Get the list of skill names mapped to an agent role.
   * If the static map doesn't have it, it returns an empty array.
   */
  public getSkillsForAgent(role: string): string[] {
    return SKILL_MAP[role] ?? [];
  }

  /**
   * Load a single SKILL.md content by skill name.
   * Returns null if the skill doesn't exist.
   * Results are cached in memory for repeated access.
   */
  public async loadSkillContent(skillName: string): Promise<string | null> {
    // Check cache first
    if (this.skillCache.has(skillName)) {
      return this.skillCache.get(skillName)!;
    }

    const skillPath = path.join(this.skillsDir, skillName, 'SKILL.md');

    try {
      let content = await fs.readFile(skillPath, 'utf-8');

      // Truncate to max chars to stay within token budget
      if (content.length > MAX_SKILL_CHARS) {
        content = content.substring(0, MAX_SKILL_CHARS) + '\n\n<!-- Truncated for token budget -->';
      }

      // Cache the result
      this.skillCache.set(skillName, content);
      return content;
    } catch {
      // Skill file doesn't exist â€” not an error, just missing
      return null;
    }
  }

  /**
   * Load multiple skills for an agent (lazy, max 3).
   * Returns only the skills that actually exist.
   */
  public async loadSkillsForAgent(role: string): Promise<{ name: string; content: string }[]> {
    const skillNames = this.getSkillsForAgent(role).slice(0, MAX_SKILLS_PER_AGENT);
    const loaded: { name: string; content: string }[] = [];

    for (const name of skillNames) {
      const content = await this.loadSkillContent(name);
      if (content) {
        loaded.push({ name, content });
      }
    }

    return loaded;
  }

  /**
   * Build an enriched system prompt for an agent by injecting relevant skills.
   *
   * @param agent The agent definition
   * @param userSkillOverrides Optional user-specified additional skills to inject
   * @returns The enriched prompt string
   */
  public async buildEnrichedPrompt(
    agent: AgentDefinition,
    userSkillOverrides?: string[]
  ): Promise<string> {
    // Start with the agent's base system prompt
    const sections: string[] = [agent.systemPrompt];

    // Determine which skills to load: Preferred map + any user overrides
    const skillNames = new Set([
      ...this.getSkillsForAgent(agent.role),
      ...(userSkillOverrides ?? []),
    ]);

    // Make sure we only inject UP TO MAX_SKILLS_PER_AGENT to avoid blowing up context
    const skillsToTry = Array.from(skillNames).slice(0, MAX_SKILLS_PER_AGENT);

    // 1. Inject Sovereign Rules (Mutlak Yasalar)
    try {
      const rulesPath = path.join(path.dirname(this.skillsDir), 'personals_rules.md');
      const rulesContent = await fs.readFile(rulesPath, 'utf-8');
      sections.push('## SOVEREIGN AUTONOMY PROTOCOL (MUTLAK YASALAR)');
      sections.push(rulesContent);
      sections.push('---');
    } catch (err: any) {
      console.warn(`[SkillMapper] Failed to inject personals_rules.md: ${err.message}`);
    }

    // Load and inject skill contents
    const loadedSkills: string[] = [];
    for (const name of skillsToTry) {
      const content = await this.loadSkillContent(name);
      if (content) {
        loadedSkills.push(name);
        sections.push('');
        sections.push(`## Reference Skill: ${name}`);
        sections.push(content);
      }
    }

    if (loadedSkills.length > 0) {
      console.log(
        `[SkillMapper] ${agent.role}: Injected ${loadedSkills.length} skills â†’ ${loadedSkills.join(', ')}`
      );
    }

    return sections.join('\n');
  }

  /**
   * Check which mapped skills actually exist on disk.
   * Useful for auditing the skill mapping.
   */
  public async auditSkillMapping(): Promise<{
    role: string;
    mapped: string[];
    found: string[];
    missing: string[];
  }[]> {
    const results: {
      role: string;
      mapped: string[];
      found: string[];
      missing: string[];
    }[] = [];

    for (const [role, skills] of Object.entries(SKILL_MAP)) {
      const found: string[] = [];
      const missing: string[] = [];

      for (const skill of skills) {
        const content = await this.loadSkillContent(skill);
        if (content) {
          found.push(skill);
        } else {
          missing.push(skill);
        }
      }

      results.push({ role, mapped: skills, found, missing });
    }

    return results;
  }

  /**
   * Clear the in-memory skill content cache.
   */
  public clearCache(): void {
    this.skillCache.clear();
  }
}

/**
 * Get the default skill map (exported for testing).
 */
export function getSkillMap(): Record<string, string[]> {
  return { ...SKILL_MAP };
}
