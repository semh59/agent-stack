import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface Skill {
  name: string;
  description: string;
  content: string;
  path: string;
  /** Lowercase keywords extracted from name, description, and frontmatter for matching */
  keywords: string[];
}

/**
 * SkillEngine: Loads and parses expertise files from .agent/skills/ directory.
 * 
 * These skills provide specialized context for different mission tasks.
 */
export class SkillEngine {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private initialized = false;

  constructor(projectRoot: string) {
    this.skillsDir = path.resolve(projectRoot, ".agent", "skills");
  }

  /**
   * Initializes the engine by scanning the skills directory.
   * Idempotent â€” subsequent calls are no-ops.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    process.stderr.write(`[SKILLS] Initializing SkillEngine in ${this.skillsDir}\n`);
    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(this.skillsDir, entry.name, "SKILL.md");
        const skill = await this.loadSkill(skillPath);
        if (skill) {
          this.skills.set(skill.name, skill);
        }
      }
    } catch {
      // Skills directory might not exist yet
    }

    this.initialized = true;
  }

  /**
   * Returns a skill by name.
   */
  public getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Returns all loaded skills.
   */
  public getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Maps a task type or mission context to relevant skills using keyword tokenization.
   * 
   * Instead of naive full-string matching, tokenizes the objective into keywords
   * and checks overlap with each skill's keyword set.
   */
  public findRelevantSkills(taskType: string, objectives: string): Skill[] {
    const queryTokens = this.tokenize(`${taskType} ${objectives}`);
    if (queryTokens.length === 0) return [];

    const scored: Array<{ skill: Skill; score: number }> = [];

    for (const skill of this.skills.values()) {
      let score = 0;
      for (const token of queryTokens) {
        if (skill.keywords.some(kw => kw.includes(token) || token.includes(kw))) {
          score++;
        }
      }
      if (score > 0) {
        scored.push({ skill, score });
      }
    }

    // Sort by relevance score (descending), limit to top 5
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.skill);
  }

  private async loadSkill(filePath: string): Promise<Skill | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const metadata = this.parseMetadata(content);
      const name = metadata.name || path.basename(path.dirname(filePath));
      const description = metadata.description || "";

      return {
        name,
        description,
        content,
        path: filePath,
        keywords: this.extractKeywords(name, description)
      };
    } catch {
      return null;
    }
  }

  private parseMetadata(content: string): Record<string, string> {
    const meta: Record<string, string> = {};
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (match && match[1]) {
      const lines = match[1].split("\n");
      for (const line of lines) {
        const [key, ...values] = line.split(":");
        if (key && values.length > 0) {
          meta[key.trim()] = values.join(":").trim();
        }
      }
    }
    return meta;
  }

  /**
   * Extracts searchable keywords from skill name and description.
   * Splits on common delimiters and filters noise words.
   */
  private extractKeywords(name: string, description: string): string[] {
    const combined = `${name} ${description}`.toLowerCase();
    const tokens = combined.split(/[\s\-_.,;:!?()\[\]{}'"\/\\]+/).filter(t => t.length > 2);
    const noise = new Set(["the", "and", "for", "use", "when", "this", "that", "with", "from", "are", "has", "have", "not", "but", "level", "expert", "knowledge"]);
    return [...new Set(tokens.filter(t => !noise.has(t)))];
  }

  public async saveSkill(data: { name: string; description: string; content: string; tags: string[] }): Promise<void> {
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const skillDir = path.join(this.skillsDir, slug);
    const skillPath = path.join(skillDir, "SKILL.md");

    await fs.mkdir(skillDir, { recursive: true });
    const frontmatter = [
      "---",
      `name: ${data.name}`,
      `description: ${data.description}`,
      `tags: ${data.tags.join(", ")}`,
      `extractedAt: ${new Date().toISOString()}`,
      "---",
      ""
    ].join("\n");

    const fullContent = frontmatter + data.content;
    await fs.writeFile(skillPath, fullContent, "utf-8");

    // Add to local cache
    this.skills.set(data.name, {
      name: data.name,
      description: data.description,
      content: fullContent,
      path: skillPath,
      keywords: this.extractKeywords(data.name, data.description)
    });
  }

  private tokenize(input: string): string[] {
    const tokens = input.toLowerCase().split(/[\s\-_.,;:!?()\[\]{}'"\/\\]+/).filter(t => t.length > 2);
    const noise = new Set(["the", "and", "for", "use", "when", "this", "that", "with", "from", "are"]);
    return [...new Set(tokens.filter(t => !noise.has(t)))];
  }
}
