import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PipelineTools } from './pipeline-tools';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('PipelineTools: Skill Management', () => {
  let tools: any;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-tools-test-'));
    const mockAntigravityClient = {} as any;
    const mockPluginClient = { tui: { withProgress: (opts: any, cb: any) => cb({}, {}) } } as any;
    const pt = new PipelineTools(tmpDir, mockAntigravityClient, mockPluginClient);
    tools = pt.getTools();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('pipeline_install_skill', () => {
    it('should fail if source skill does not exist', async () => {
      const result = await tools.pipeline_install_skill.execute({ skillName: 'nonexistent-skill' }, {} as any);
      expect(result).toContain('not found in awesome-skills repository');
    });

    it('should copy skill to .agent/skills/ if source exists', async () => {
      // Mock the remote repository
      const sourceDir = path.join(tmpDir, 'incele', '.agent', 'skills', 'test-skill');
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '# Test Skill Content', 'utf-8');

      // Execute tool
      const result = await tools.pipeline_install_skill.execute({ skillName: 'test-skill' }, {} as any);
      expect(result).toContain('Successfully installed');

      // Verify copied successfully
      const targetPath = path.join(tmpDir, '.agent', 'skills', 'test-skill', 'SKILL.md');
      const content = await fs.readFile(targetPath, 'utf-8');
      expect(content).toContain('# Test Skill Content');
    });

    it('should skip if skill is already installed', async () => {
      // Mock remote repo
      const sourceDir = path.join(tmpDir, 'incele', '.agent', 'skills', 'test-skill');
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '# Test Skill Content', 'utf-8');

      // Mock existing installation
      const targetDir = path.join(tmpDir, '.agent', 'skills', 'test-skill');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, 'SKILL.md'), '# Existing', 'utf-8');

      const result = await tools.pipeline_install_skill.execute({ skillName: 'test-skill' }, {} as any);
      expect(result).toContain('already installed');
    });
  });

  describe('pipeline_approve_skill', () => {
    it('should fail if proposed skill does not exist', async () => {
      const result = await tools.pipeline_approve_skill.execute({ skillName: 'nonexistent-proposal' }, {} as any);
      expect(result).toContain('not found in .ai-company/proposed-skills/');
    });

    it('should move proposed skill to .agent/skills/ and remove from INDEX.md', async () => {
      // Mock proposed skill and INDEX
      const proposedDir = path.join(tmpDir, '.ai-company', 'proposed-skills');
      await fs.mkdir(proposedDir, { recursive: true });
      await fs.writeFile(path.join(proposedDir, 'awesome-skill.md'), '# Awesome Proposed Skill', 'utf-8');
      await fs.writeFile(
        path.join(proposedDir, 'INDEX.md'),
        '# Proposals\n| awesome-skill | description | pattern | 90% |\n| other-skill | ... | ... | 50% |',
        'utf-8'
      );

      // Execute tool
      const result = await tools.pipeline_approve_skill.execute({ skillName: 'awesome-skill' }, {} as any);
      expect(result).toContain('Successfully approved and installed');

      // Check moved successfully
      const targetPath = path.join(tmpDir, '.agent', 'skills', 'awesome-skill', 'SKILL.md');
      const content = await fs.readFile(targetPath, 'utf-8');
      expect(content).toContain('# Awesome Proposed Skill');

      // Check original deleted
      await expect(fs.access(path.join(proposedDir, 'awesome-skill.md'))).rejects.toThrow();

      // Check INDEX updated
      const indexContent = await fs.readFile(path.join(proposedDir, 'INDEX.md'), 'utf-8');
      expect(indexContent).not.toContain('awesome-skill');
      expect(indexContent).toContain('other-skill');
    });
  });
});
