import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SharedMemory, type PipelineState } from './shared-memory';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SharedMemory', () => {
  let memory: SharedMemory;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
    memory = new SharedMemory(tmpDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  describe('init', () => {
    it('should create .ai-company directory', async () => {
      await memory.init();
      const stats = await fs.stat(path.join(tmpDir, '.ai-company'));
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create state.json with defaults', async () => {
      await memory.init();
      const state = await memory.getState();
      expect(state.pipelineStatus).toBe('idle');
      expect(state.completedAgents).toEqual([]);
      expect(state.currentAgent).toBeNull();
    });

    it('should not overwrite existing state', async () => {
      await memory.init();
      await memory.updateState({ userTask: 'Test task' });
      await memory.init(); // Call again
      const state = await memory.getState();
      expect(state.userTask).toBe('Test task');
    });
  });

  describe('getState / updateState', () => {
    it('should return defaults when no state exists', async () => {
      const state = await memory.getState();
      expect(state.pipelineStatus).toBe('idle');
      expect(state.userTask).toBe('');
    });

    it('should partially update state', async () => {
      await memory.init();
      await memory.updateState({
        userTask: 'Build feature X',
        pipelineStatus: 'running',
      });

      const state = await memory.getState();
      expect(state.userTask).toBe('Build feature X');
      expect(state.pipelineStatus).toBe('running');
      expect(state.completedAgents).toEqual([]); // Unchanged
    });

    it('should merge arrays instead of replacing', async () => {
      await memory.init();
      await memory.updateState({ completedAgents: ['ceo'] });
      await memory.updateState({ completedAgents: ['pm'] });

      const state = await memory.getState();
      expect(state.completedAgents).toContain('ceo');
      expect(state.completedAgents).toContain('pm');
    });

    it('should deduplicate array entries', async () => {
      await memory.init();
      await memory.updateState({ filesCreated: ['file.md'] });
      await memory.updateState({ filesCreated: ['file.md'] });

      const state = await memory.getState();
      expect(state.filesCreated.filter((f) => f === 'file.md')).toHaveLength(1);
    });
  });

  describe('writeAgentOutput / readAgentOutput', () => {
    it('should write and read agent output', async () => {
      await memory.init();
      await memory.writeAgentOutput('ceo', 'ceo-brief.md', '# CEO Brief\nTask analysis...');

      const content = await memory.readAgentOutput('ceo-brief.md');
      expect(content).toBe('# CEO Brief\nTask analysis...');
    });

    it('should return null for non-existent file', async () => {
      await memory.init();
      const content = await memory.readAgentOutput('nonexistent.md');
      expect(content).toBeNull();
    });
  });

  describe('readMultipleOutputs', () => {
    it('should read multiple files, skipping missing ones', async () => {
      await memory.init();
      await memory.writeAgentOutput('ceo', 'ceo-brief.md', 'CEO content');
      await memory.writeAgentOutput('pm', 'pm-plan.md', 'PM content');

      const outputs = await memory.readMultipleOutputs([
        'ceo-brief.md',
        'pm-plan.md',
        'nonexistent.md',
      ]);

      expect(Object.keys(outputs)).toHaveLength(2);
      expect(outputs['ceo-brief.md']).toBe('CEO content');
      expect(outputs['pm-plan.md']).toBe('PM content');
    });
  });

  describe('getTimeline', () => {
    it('should return chronological timeline of outputs', async () => {
      await memory.init();
      await memory.writeAgentOutput('ceo', 'ceo-brief.md', 'CEO output');
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await memory.writeAgentOutput('pm', 'pm-plan.md', 'PM output');

      const timeline = await memory.getTimeline();
      expect(timeline.length).toBeGreaterThanOrEqual(2);
      expect(timeline[0]?.agent).toBe('ceo');
    });

    it('should exclude state.json from timeline', async () => {
      await memory.init();
      const timeline = await memory.getTimeline();
      const hasState = timeline.some((t) => t.file === 'state.json');
      expect(hasState).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset state to defaults', async () => {
      await memory.init();
      await memory.updateState({
        userTask: 'Test',
        pipelineStatus: 'running',
        completedAgents: ['ceo', 'pm'],
      });

      await memory.reset();
      const state = await memory.getState();
      expect(state.pipelineStatus).toBe('idle');
      expect(state.completedAgents).toEqual([]);
    });
  });

  describe('clean', () => {
    it('should remove all files and reset', async () => {
      await memory.init();
      await memory.writeAgentOutput('ceo', 'ceo-brief.md', 'CEO output');
      await memory.clean();

      const content = await memory.readAgentOutput('ceo-brief.md');
      expect(content).toBeNull();

      const state = await memory.getState();
      expect(state.pipelineStatus).toBe('idle');
    });
  });
});
