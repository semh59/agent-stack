import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillGenerator, type ProposedSkill } from './skill-generator';
import { SharedMemory } from './shared-memory';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SkillGenerator', () => {
  let generator: SkillGenerator;
  let memory: SharedMemory;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skillgen-test-'));
    generator = new SkillGenerator(tmpDir);
    memory = new SharedMemory(tmpDir);
    await memory.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('generateProposals', () => {
    it('should return empty when no agent outputs exist', async () => {
      const proposals = await generator.generateProposals(memory);
      expect(proposals).toEqual([]);
    });

    it('should extract error patterns from lessons-learned', async () => {
      await memory.writeAgentOutput('docs', 'lessons-learned.md', `
# Lessons Learned

## Issues
- Error: timeout connecting to database
- Bug fixed: null reference in auth module
- Error: CORS policy blocking frontend
      `);

      const proposals = await generator.generateProposals(memory);
      const errorSkill = proposals.find((p) => p.name === 'project-error-patterns');
      expect(errorSkill).toBeDefined();
      expect(errorSkill?.source).toBe('lessons_learned');
    });

    it('should extract decisions from lessons-learned', async () => {
      await memory.writeAgentOutput('docs', 'lessons-learned.md', `
# Lessons

- Decision: chose PostgreSQL over MongoDB for relational consistency
- Selected React over Vue for ecosystem maturity
      `);

      const proposals = await generator.generateProposals(memory);
      const decisionSkill = proposals.find((p) => p.name === 'project-decisions');
      expect(decisionSkill).toBeDefined();
      expect(decisionSkill?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should extract security patterns from audit', async () => {
      await memory.writeAgentOutput('security', 'security-audit.md', `
# Security Audit

- Found vulnerability: XSS in user profile page
- OWASP A03: Injection risk in search endpoint
- Vulnerability: CSRF token missing on form submission
      `);

      const proposals = await generator.generateProposals(memory);
      const secSkill = proposals.find((p) => p.name === 'project-security-checklist');
      expect(secSkill).toBeDefined();
      expect(secSkill?.confidence).toBe(0.8);
    });

    it('should filter out low-confidence proposals', async () => {
      // No matching patterns â†’ no proposals
      await memory.writeAgentOutput('docs', 'lessons-learned.md', 'Nothing special happened.');

      const proposals = await generator.generateProposals(memory);
      expect(proposals.every((p) => p.confidence >= 0.5)).toBe(true);
    });
  });

  describe('writeProposals', () => {
    it('should write proposals to proposed-skills directory', async () => {
      const proposals: ProposedSkill[] = [
        {
          name: 'test-skill',
          description: 'A test skill',
          content: '---\nname: test-skill\n---\n# Test',
          source: 'pattern_detection',
          confidence: 0.8,
        },
      ];

      const paths = await generator.writeProposals(proposals);
      expect(paths.length).toBe(2); // skill file + INDEX.md

      const skillPath = path.join(tmpDir, '.ai-company', 'proposed-skills', 'test-skill.md');
      const content = await fs.readFile(skillPath, 'utf-8');
      expect(content).toContain('# Test');
    });

    it('should create INDEX.md with proposal summary', async () => {
      const proposals: ProposedSkill[] = [
        {
          name: 'skill-a',
          description: 'First skill',
          content: '# A',
          source: 'lessons_learned',
          confidence: 0.7,
        },
        {
          name: 'skill-b',
          description: 'Second skill',
          content: '# B',
          source: 'error_pattern',
          confidence: 0.9,
        },
      ];

      await generator.writeProposals(proposals);

      const indexPath = path.join(tmpDir, '.ai-company', 'proposed-skills', 'INDEX.md');
      const index = await fs.readFile(indexPath, 'utf-8');
      expect(index).toContain('skill-a');
      expect(index).toContain('skill-b');
      expect(index).toContain('90%');
    });
  });

  describe('getExistingProposals', () => {
    it('should list existing proposal files', async () => {
      const dir = path.join(tmpDir, '.ai-company', 'proposed-skills');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'existing-skill.md'), '# Existing', 'utf-8');

      const existing = await generator.getExistingProposals();
      expect(existing).toContain('existing-skill.md');
    });

    it('should return empty when no proposals exist', async () => {
      const existing = await generator.getExistingProposals();
      expect(existing).toEqual([]);
    });
  });
});
