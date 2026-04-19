import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillMapper, getSkillMap } from './skill-mapper';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SkillMapper', () => {
  let mapper: SkillMapper;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
    mapper = new SkillMapper(tmpDir);
  });

  afterEach(async () => {
    mapper.clearCache();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('getSkillMap', () => {
    it('should return skill map with all 18 agent roles', () => {
      const map = getSkillMap();
      const roles = Object.keys(map);
      expect(roles).toHaveLength(18);
      expect(roles).toContain('ceo');
      expect(roles).toContain('devops');
    });

    it('should map max 3 skills per agent', () => {
      const map = getSkillMap();
      for (const [, skills] of Object.entries(map)) {
        expect(skills.length).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('getSkillsForAgent', () => {
    it('should return mapped skills for known agent', () => {
      const skills = mapper.getSkillsForAgent('security');
      expect(skills.length).toBeGreaterThan(0);
      expect(skills).toContain('cc-skill-security-review');
    });

    it('should return empty array for unknown agent', () => {
      expect(mapper.getSkillsForAgent('nonexistent')).toEqual([]);
    });
  });

  describe('loadSkillContent', () => {
    it('should load SKILL.md from disk', async () => {
      // Create a mock skill
      const skillDir = path.join(tmpDir, 'test-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: test-skill\n---\n# Test Skill\nContent here.',
        'utf-8'
      );

      const content = await mapper.loadSkillContent('test-skill');
      expect(content).toContain('# Test Skill');
    });

    it('should return null for non-existent skill', async () => {
      const content = await mapper.loadSkillContent('nonexistent-skill');
      expect(content).toBeNull();
    });

    it('should cache loaded skill content', async () => {
      const skillDir = path.join(tmpDir, 'cached-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Cached', 'utf-8');

      await mapper.loadSkillContent('cached-skill');
      // Delete the file
      await fs.rm(skillDir, { recursive: true });
      // Should still return cached content
      const cached = await mapper.loadSkillContent('cached-skill');
      expect(cached).toBe('# Cached');
    });

    it('should truncate overly long skills', async () => {
      const skillDir = path.join(tmpDir, 'long-skill');
      await fs.mkdir(skillDir, { recursive: true });
      const longContent = 'A'.repeat(10000);
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), longContent, 'utf-8');

      const content = await mapper.loadSkillContent('long-skill');
      expect(content!.length).toBeLessThan(10000);
      expect(content).toContain('Truncated for token budget');
    });
  });

  describe('loadSkillsForAgent', () => {
    it('should load available skills for an agent', async () => {
      // Create a mock skill matching a mapped name
      const skillDir = path.join(tmpDir, 'cc-skill-security-review');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Security Review', 'utf-8');

      const skills = await mapper.loadSkillsForAgent('security');
      expect(skills.length).toBeGreaterThanOrEqual(1);
      expect(skills[0]?.name).toBe('cc-skill-security-review');
    });

    it('should return empty if no skills found on disk', async () => {
      const skills = await mapper.loadSkillsForAgent('ceo');
      expect(skills).toHaveLength(0);
    });
  });

  describe('buildEnrichedPrompt', () => {
    it('should return base prompt when no skills exist on disk', async () => {
      const agent = {
        order: 1, role: 'ceo', name: 'CEO', emoji: '👔',
        layer: 'management' as const, preferredModel: 'test' as any,
        inputFiles: [], outputFiles: ['ceo-brief.md'],
        estimatedMinutes: 5, systemPrompt: 'You are the CEO.',
      };

      const prompt = await mapper.buildEnrichedPrompt(agent);
      expect(prompt).toContain('You are the CEO.');
    });

    it('should inject skill content when available', async () => {
      const skillDir = path.join(tmpDir, 'architecture');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Architecture Guide\nBest practices.', 'utf-8');

      const agent = {
        order: 1, role: 'ceo', name: 'CEO', emoji: '👔',
        layer: 'management' as const, preferredModel: 'test' as any,
        inputFiles: [], outputFiles: ['ceo-brief.md'],
        estimatedMinutes: 5, systemPrompt: 'You are the CEO.',
      };

      const prompt = await mapper.buildEnrichedPrompt(agent);
      expect(prompt).toContain('You are the CEO.');
      expect(prompt).toContain('# Architecture Guide');
    });
  });

  describe('auditSkillMapping', () => {
    it('should report found and missing skills', async () => {
      const skillDir = path.join(tmpDir, 'architecture');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Arch', 'utf-8');

      const audit = await mapper.auditSkillMapping();
      expect(audit.length).toBe(18);

      const ceoAudit = audit.find((a) => a.role === 'ceo');
      expect(ceoAudit?.found).toContain('architecture');
      expect(ceoAudit?.missing.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('should clear in-memory cache', async () => {
      const skillDir = path.join(tmpDir, 'clear-test');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Clearable', 'utf-8');

      await mapper.loadSkillContent('clear-test');
      mapper.clearCache();

      // Delete from disk
      await fs.rm(skillDir, { recursive: true });
      const content = await mapper.loadSkillContent('clear-test');
      expect(content).toBeNull(); // Cache was cleared, file is gone
    });
  });
});
