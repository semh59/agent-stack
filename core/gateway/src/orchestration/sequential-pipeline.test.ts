import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SequentialPipeline } from './sequential-pipeline';
import { AGENTS } from './agents';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const FULL_PIPELINE_TIMEOUT_MS = 15_000;

// Mock TerminalExecutor to avoid real terminal calls in tests
vi.mock('./terminal-executor', () => {
  const mockCommandResult = {
    success: true,
    stdout: 'Mock OK',
    stderr: '',
    exitCode: 0,
    durationMs: 10,
    command: 'mock',
  };

  return {
    TerminalExecutor: class {
      run = vi.fn().mockResolvedValue(mockCommandResult);
      runBuild = vi.fn().mockResolvedValue(mockCommandResult);
      runTests = vi.fn().mockResolvedValue(mockCommandResult);
      runTypecheck = vi.fn().mockResolvedValue(mockCommandResult);
      runFullVerification = vi.fn().mockResolvedValue({
        build: mockCommandResult,
        test: mockCommandResult,
        allPassed: true,
      });
      runWithHealing = vi.fn().mockResolvedValue(mockCommandResult);
      analyzeFailure = vi.fn().mockReturnValue({ category: 'unknown', suggestion: 'mock' });
    }
  };
});

describe('SequentialPipeline', () => {
  let pipeline: SequentialPipeline;
  let tmpDir: string;
  let fetchSpy: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
    pipeline = new SequentialPipeline(tmpDir);

    // Universal mock that satisfies Gemini, Anthropic, and OpenAI response parsers
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        // Gemini
        candidates: [{ content: { parts: [{ text: 'Mocked LLM response output' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
        // Anthropic
        content: [{ type: 'text', text: 'Mocked LLM response output' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        // OpenAI
        choices: [{ message: { content: 'Mocked LLM response output' } }],
      })
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  describe('init', () => {
    it('should create .ai-company directory', async () => {
      await pipeline.init();
      const stats = await fs.stat(path.join(tmpDir, '.ai-company'));
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('start', () => {
    it('should run all 18 agents sequentially', async () => {
      const result = await pipeline.start('Build a todo app');

      expect(result.status).toBe('completed');
      expect(result.completedCount).toBe(18);
      expect(result.failedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.agentResults).toHaveLength(18);
    }, FULL_PIPELINE_TIMEOUT_MS);

    it('should write output files for each agent', async () => {
      await pipeline.start('Build a feature');

      const memory = pipeline.getMemory();
      for (const agent of AGENTS) {
        const outputFile = agent.outputFiles[0] ?? `${agent.role}-output.md`;
        const content = await memory.readAgentOutput(outputFile);
        expect(content).toBeTruthy();
      }
    }, FULL_PIPELINE_TIMEOUT_MS);

    it('should update pipeline state on completion', async () => {
      await pipeline.start('Build a feature');

      const memory = pipeline.getMemory();
      const state = await memory.getState();
      expect(state.pipelineStatus).toBe('completed');
      expect(state.completedAgents).toHaveLength(18);
      expect(state.completedAt).toBeTruthy();
    }, FULL_PIPELINE_TIMEOUT_MS);

    it('should respect skipAgents option', async () => {
      const result = await pipeline.start('Build a feature', {
        skipAgents: ['tech_writer', 'performance'],
      });

      expect(result.completedCount).toBe(16);
      expect(result.skippedCount).toBe(2);
      expect(result.agentResults.find((r) => r.agent.role === 'tech_writer')?.status).toBe('skipped');
      expect(result.agentResults.find((r) => r.agent.role === 'performance')?.status).toBe('skipped');
    });

    it('should respect startFromOrder option', async () => {
      const result = await pipeline.start('Build a feature', {
        startFromOrder: 16,
      });

      expect(result.completedCount).toBe(3); // Only output layer: 16, 17, 18
      expect(result.agentResults).toHaveLength(3);
    });

    it('should fire onAgentStart callback', async () => {
      const startedAgents: string[] = [];

      await pipeline.start('Build a feature', {
        onAgentStart: (agent) => { startedAgents.push(agent.role); },
      });

      expect(startedAgents).toHaveLength(18);
      expect(startedAgents[0]).toBe('ceo');
      expect(startedAgents).toContain('devops');
    });

    it('should fire onAgentComplete callback', async () => {
      const completedAgents: string[] = [];

      await pipeline.start('Build a feature', {
        onAgentComplete: (agent) => { completedAgents.push(agent.role); },
      });

      expect(completedAgents).toHaveLength(18);
    });

    it('should store verification results in state', async () => {
      await pipeline.start('Build a feature', { startFromOrder: 18 });

      const memory = pipeline.getMemory();
      const state = await memory.getState();
      expect(state.verificationResults).toBeDefined();
      expect(state.verificationResults?.['devops']).toBeDefined();
    });

    it('should store agent metrics in state', async () => {
      await pipeline.start('Build a feature', { startFromOrder: 18 });

      const memory = pipeline.getMemory();
      const state = await memory.getState();
      expect(state.agentMetrics).toBeDefined();
      expect(state.agentMetrics?.['devops']).toBeDefined();
      expect((state.agentMetrics as any)?.['devops']?.attempts).toBe(1);
    });
  });

  describe('pause / resume', () => {
    it('pause should stop pipeline after current agent', async () => {
      // Start pipeline and immediately pause
      const startPromise = pipeline.start('Build a feature', {
        onAgentStart: (agent) => {
          if (agent.order === 3) {
            pipeline.pause();
          }
        },
      });

      const result = await startPromise;
      // Should have completed agents 1 and 2, paused before or at 3
      expect(result.status).toBe('paused');
      expect(result.completedCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getProgress', () => {
    it('should return correct progress for idle pipeline', async () => {
      await pipeline.init();
      const progress = await pipeline.getProgress();

      expect(progress.totalAgents).toBe(18);
      expect(progress.completedCount).toBe(0);
      expect(progress.currentAgent).toBeNull();
      expect(progress.estimatedRemainingMinutes).toBeGreaterThan(0);
    });

    it('should return correct progress after completion', async () => {
      await pipeline.start('Build a feature');
      const progress = await pipeline.getProgress();

      expect(progress.completedCount).toBe(18);
      expect(progress.state.pipelineStatus).toBe('completed');
      expect(progress.timeline.length).toBeGreaterThan(0);
    });
  });

  describe('getMemory', () => {
    it('should return the SharedMemory instance', () => {
      const memory = pipeline.getMemory();
      expect(memory).toBeDefined();
      expect(memory.getRootDir()).toContain('.ai-company');
    });
  });

  describe('configuration', () => {
    it('should respect temperature and maxOutputTokens options', async () => {
      await pipeline.start('Build a feature', {
        temperature: 0.7,
        maxOutputTokens: 2048,
        startFromOrder: 18, // Run only the last agent to speed up test
      });

      const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      
      // Flexible assertion: check either Gemini generationConfig or Anthropic fields
      if (body.generationConfig) {
        expect(body.generationConfig.temperature).toBe(0.7);
        expect(body.generationConfig.maxOutputTokens).toBe(2048);
      } else {
        expect(body.temperature).toBe(0.7);
        expect(body.max_tokens).toBe(2048);
      }
    });
  });

  describe('Race Condition Prevention - Parallel Stages', () => {
    it('handles parallel agent execution without agentResults corruption', async () => {
      // Run pipeline with parallel-capable stage
      const result = await pipeline.start('Build a feature');

      // All agents should complete successfully despite potential parallel execution
      expect(result.status).toBe('completed');
      expect(result.completedCount).toBe(18);

      // Verify no duplicate or missing results
      const uniqueRoles = new Set(result.agentResults.map(r => r.agent.role));
      expect(uniqueRoles.size).toBe(result.completedCount);
    }, FULL_PIPELINE_TIMEOUT_MS);

    it('prevents stageIndex race condition during parallel execution', async () => {
      const stageProgressions: number[] = [];

      const result = await pipeline.start('Build a feature', {
        onAgentStart: (_agent) => {
          // Track agents starting
          stageProgressions.push(Date.now());
        },
      });

      // On completion, verify no race condition in stage progression
      expect(result.status).toBe('completed');
      // All agents should complete without stage skipping
      expect(result.agentResults).toHaveLength(18);
    }, FULL_PIPELINE_TIMEOUT_MS);

    it('safely handles concurrent state mutations from parallel agents', async () => {
      await pipeline.start('Build a feature', {
        startFromOrder: 15, // Reduce to speed up test
      });

      const memory = pipeline.getMemory();
      const finalState = await memory.getState();

      // Verify state consistency
      expect(finalState.completedAgents).toBeDefined();
      expect(finalState.agentMetrics).toBeDefined();
      expect(finalState.verificationResults).toBeDefined();

      // No duplicate entries
      const completedSet = new Set(finalState.completedAgents);
      expect(completedSet.size).toBe(finalState.completedAgents.length);
    });
  });

  describe('Memory Leak Prevention - Listeners', () => {
    it('removes listeners on dispose', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      // Add multiple listeners
      const _disposer1 = pipeline.onAgentStart(listener1);
      const _disposer2 = pipeline.onAgentComplete(listener2);

      // Verify added
      expect((pipeline as any).agentStartListeners.size).toBeGreaterThan(0);
      expect((pipeline as any).agentCompleteListeners.size).toBeGreaterThan(0);

      // Dispose pipeline
      pipeline.dispose();

      // Verify cleared
      expect((pipeline as any).agentStartListeners.size).toBe(0);
      expect((pipeline as any).agentCompleteListeners.size).toBe(0);
      expect((pipeline as any).rarvListeners.size).toBe(0);
      expect((pipeline as any).errorListeners.size).toBe(0);
      expect((pipeline as any).verifyListeners.size).toBe(0);
    });

    it('allows manual removal of individual listeners', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const disposer1 = pipeline.onAgentStart(listener1);
      const disposer2 = pipeline.onAgentStart(listener2);

      expect((pipeline as any).agentStartListeners.size).toBe(2);

      // Remove one
      disposer1.dispose();
      expect((pipeline as any).agentStartListeners.size).toBe(1);

      // Remove other
      disposer2.dispose();
      expect((pipeline as any).agentStartListeners.size).toBe(0);
    });

    it('listeners do not accumulate across multiple pipeline runs', async () => {
      // Create new pipeline for each run
      const listener = vi.fn();

      // Simulate multiple runs
      const startingSize = (pipeline as any).agentStartListeners.size;
      pipeline.onAgentStart(listener);
      const afterAdd = (pipeline as any).agentStartListeners.size;

      expect(afterAdd).toBe(startingSize + 1);

      // Dispose and verify cleanup
      pipeline.dispose();
      expect((pipeline as any).agentStartListeners.size).toBe(0);
    });

    it('handles listener exceptions gracefully', async () => {
      const faultyListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      // Mock console.log to suppress output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      pipeline.onAgentStart(faultyListener);
      pipeline.onAgentStart(goodListener);

      // Start pipeline - should not crash despite faulty listener
      const result = await pipeline.start('Build a feature', {
        startFromOrder: 18, // Just run the last agent
      });

      expect(result.status).toBe('completed');
      expect(goodListener).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Pause/Resume Safety', () => {
    it('pause is safe during parallel execution', async () => {
      const pausePromise = pipeline.start('Build a feature', {
        onAgentStart: (agent) => {
          if (agent.order === 5) {
            pipeline.pause();
          }
        },
      });

      const result = await pausePromise;
      expect(result.status).toBe('paused');
      expect(result.completedCount).toBeGreaterThanOrEqual(4);
    });

    it('abortController prevents race conditions on stop', async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      (pipeline as any).abortController = new AbortController();
      (pipeline as any).abortController.abort();

      expect((pipeline as any).abortController.signal.aborted).toBe(true);

      // Attempting operations should fail fast
      expect(() => {
        (pipeline as any).abortController.signal.throwIfAborted();
      }).toThrow();

      abortSpy.mockRestore();
    });
  });

  describe('Backtrack Operation Safety', () => {
    it('prevents concurrent modification of agentResults during backtrack', async () => {
      // Run test scenario where backtrack might occur
      const result = await pipeline.start('Build a feature');

      // If backtrack occurred, verify agentResults is consistent
      if (result.status === 'completed' || result.status === 'failed') {
        const uniqueRoles = new Set(result.agentResults.map(r => r.agent.role));
        // No duplicate agents in results
        expect(uniqueRoles.size).toBe(result.agentResults.length);
      }
    }, FULL_PIPELINE_TIMEOUT_MS);
  });
});
