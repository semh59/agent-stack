import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SkillEngine } from "./SkillEngine";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

describe("SkillEngine", () => {
  let tempDir: string;
  let engine: SkillEngine;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-engine-test-"));
    engine = new SkillEngine(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createSkill(name: string, description: string, content: string) {
    const skillDir = path.join(tempDir, ".agent", "skills", name);
    await fs.mkdir(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    const fullContent = `---\nname: ${name}\ndescription: ${description}\n--- \n${content}`;
    await fs.writeFile(skillPath, fullContent, "utf-8");
    return skillPath;
  }

  describe("initialize", () => {
    it("loads skills from disk", async () => {
      await createSkill("test-skill", "A helpful skill", "Skill content here.");
      await engine.initialize();

      const skill = engine.getSkill("test-skill");
      expect(skill).toBeDefined();
      expect(skill?.description).toBe("A helpful skill");
      expect(skill?.content).toContain("Skill content here.");
    });

    it("is idempotent", async () => {
      await createSkill("skill-1", "Desc 1", "Content 1");
      await engine.initialize();
      const count1 = engine.getAllSkills().length;

      // Add another skill but don't re-init
      await createSkill("skill-2", "Desc 2", "Content 2");
      await engine.initialize(); // Second call
      const count2 = engine.getAllSkills().length;

      expect(count1).toBe(1);
      expect(count2).toBe(1); // Should not have re-scanned directory
    });

    it("ignores non-directory entries", async () => {
      const skillsDir = path.join(tempDir, ".agent", "skills");
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(path.join(skillsDir, "dummy.txt"), "not a skill folder");

      await engine.initialize();
      expect(engine.getAllSkills()).toHaveLength(0);
    });

    it("handles missing directory gracefully", async () => {
      // tempDir doesn't have .agent/skills yet
      await expect(engine.initialize()).resolves.toBeUndefined();
      expect(engine.getAllSkills()).toHaveLength(0);
    });
  });

  describe("findRelevantSkills", () => {
    beforeEach(async () => {
      await createSkill("auth-patterns", "Security and authentication best practices", "Auth content");
      await createSkill("api-design", "REST and GraphQL principles", "API content");
      await createSkill("db-optimization", "SQL and indexing experts", "DB content");
      await engine.initialize();
    });

    it("matches keyword overlap", () => {
      const results = engine.findRelevantSkills("implementation", "Implement a new authentication endpoint with high security");
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("auth-patterns");
    });

    it("ranks by relevance and limits to 5", async () => {
      // Add more to hit limit
      for (let i = 0; i < 5; i++) {
        await createSkill(`extra-${i}`, `extra ${i}`, "extra");
      }
      // Need a new engine to re-scan
      const newEngine = new SkillEngine(tempDir);
      await newEngine.initialize();

      const results = newEngine.findRelevantSkills("task", "extra authentication security REST SQL and api indexing");
      // Should find at most 5 results even if more match
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("returns empty for non-matching input", () => {
      const results = engine.findRelevantSkills("fix", "something totally unrelated like gardening");
      expect(results).toHaveLength(0);
    });
  });

  describe("Keyword Extraction (internal)", () => {
    it("extracts meaningful keywords and filters noise", async () => {
      await createSkill("clean-code", "Pragmatic coding standards for TypeScript and Node.js", "Content");
      await engine.initialize();
      const skill = engine.getSkill("clean-code");
      
      expect(skill?.keywords).toContain("clean");
      expect(skill?.keywords).toContain("code");
      expect(skill?.keywords).toContain("typescript");
      expect(skill?.keywords).not.toContain("the"); // filtered as noise
      expect(skill?.keywords).not.toContain("for"); // filtered as noise
    });
  });
});
