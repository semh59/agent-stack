import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IntentTransformer } from './intent-transformer';

// Mock the xenova/transformers module
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(async () => {
    // Simulate model loading delay
    await new Promise(resolve => setTimeout(resolve, 50));
    // Implementation uses this.classifier(text, labels) directly, so mock must be callable
    const mockCallable = vi.fn(async (text: string, labels: string[]) => ({
      labels: labels,
      scores: labels.map(() => Math.random()),
    }));
    return mockCallable;
  }),
}));

vi.mock('../plugin/storage', () => ({
  getConfigDir: () => '/mock/config',
}));

describe('IntentTransformer - Thread-Safe Initialization', () => {
  let transformer: IntentTransformer;

  beforeEach(() => {
    transformer = IntentTransformer.getInstance();
    transformer.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    transformer.reset();
  });

  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = IntentTransformer.getInstance();
      const instance2 = IntentTransformer.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('initializes instance on first call', () => {
      const instance = IntentTransformer.getInstance();
      expect(instance).toBeInstanceOf(IntentTransformer);
    });
  });

  describe('Promise Memoization (No Duplicate Loads)', () => {
    it('loads model only once for concurrent init calls', async () => {
      const { pipeline } = await import('@xenova/transformers');

      // Reset to track calls
      vi.clearAllMocks();

      // Launch 5 concurrent init calls
      const initPromises = Array.from({ length: 5 }, () =>
        transformer.init()
      );

      // All should complete
      await Promise.all(initPromises);

      // pipeline (model loading) should be called exactly once
      expect(pipeline).toHaveBeenCalledTimes(1);
    });

    it('concurrent callers wait for same Promise', async () => {
      const initOrder: number[] = [];

      // Create 3 concurrent init calls that track order
      const calls = [0, 1, 2].map((id) =>
        transformer.init().then(() => {
          initOrder.push(id);
        })
      );

      await Promise.all(calls);

      // All should complete
      expect(initOrder).toHaveLength(3);
      expect(initOrder.sort()).toEqual([0, 1, 2]);
    });

    it('returns same Promise for concurrent calls', async () => {
      const promise1 = transformer.init();
      const promise2 = transformer.init();

      // Both should resolve independently but use same underlying model load
      await Promise.all([promise1, promise2]);

      // Verify model is initialized
      const result = await transformer.predict('test');
      expect(result).toBeDefined();
      expect(result.prediction).toBeDefined();
    });
  });

  describe('Caching', () => {
    it('returns cached classifier after first init', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      await transformer.init();
      expect(pipeline).toHaveBeenCalledTimes(1);

      await transformer.init();
      expect(pipeline).toHaveBeenCalledTimes(1); // Not called again

      await transformer.init();
      expect(pipeline).toHaveBeenCalledTimes(1); // Still not called
    });

    it('subsequent calls do not reload model', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      // First init
      await transformer.init();
      const firstCallCount = (pipeline as any).mock.calls.length;

      // Second init
      await transformer.init();
      expect((pipeline as any).mock.calls.length).toBe(firstCallCount);

      // Third init
      await transformer.init();
      expect((pipeline as any).mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('Error Handling', () => {
    it('clears cache on initialization error', async () => {
      const { pipeline } = await import('@xenova/transformers');

      // Mock pipeline to fail
      (pipeline as any).mockImplementationOnce(() =>
        Promise.reject(new Error('Model load failed'))
      );

      // First init should fail
      await expect(transformer.init()).rejects.toThrow('Model load failed');

      // Mock pipeline to succeed for retry
      (pipeline as any).mockImplementationOnce(async () => ({
        call: vi.fn(),
      }));

      // Second init should retry and load model
      await transformer.init();

      expect((pipeline as any).mock.calls.length).toBe(2); // Called again (not cached after error)
    });

    it('allows retry after error', async () => {
      const { pipeline } = await import('@xenova/transformers');

      // First call fails
      (pipeline as any).mockImplementationOnce(() =>
        Promise.reject(new Error('Load error'))
      );

      await expect(transformer.init()).rejects.toThrow('Load error');

      // Reset mock
      (pipeline as any).mockClear();
      (pipeline as any).mockImplementationOnce(async () => ({
        call: vi.fn(),
      }));

      // Second call should succeed (cache was cleared)
      await expect(transformer.init()).resolves.not.toThrow();
    });

    it('prevents multiple concurrent error calls from both retrying', async () => {
      const { pipeline } = await import('@xenova/transformers');

      // Mock to fail
      (pipeline as any).mockImplementationOnce(() =>
        Promise.reject(new Error('Load error'))
      );

      // Both concurrent calls fail, but only one real call made
      const promises = [
        transformer.init().catch(() => 'error1'),
        transformer.init().catch(() => 'error2'),
      ];

      const results = await Promise.all(promises);
      expect(results).toEqual(['error1', 'error2']);
      expect((pipeline as any).mock.calls.length).toBe(1);
    });
  });

  describe('Prediction', () => {
    it('auto-initializes on first predict call', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      const result = await transformer.predict('test intent');

      expect(result).toBeDefined();
      expect(result.prediction).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.all_scores).toBeDefined();
      expect((pipeline as any).mock.calls.length).toBe(1); // Model loaded
    });

    it('reuses model for multiple predictions', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      await transformer.predict('test 1');
      await transformer.predict('test 2');
      await transformer.predict('test 3');

      expect((pipeline as any).mock.calls.length).toBe(1); // Model only loaded once
    });

    it('concurrent predictions do not cause duplicate initialization', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      const predictions = await Promise.all([
        transformer.predict('test 1'),
        transformer.predict('test 2'),
        transformer.predict('test 3'),
      ]);

      expect(predictions).toHaveLength(3);
      expect((pipeline as any).mock.calls.length).toBe(1); // Model only loaded once
    });
  });

  describe('Reset', () => {
    it('clears cached classifier and promise', async () => {
      await transformer.init();

      transformer.reset();

      // After reset, next init should reload
      const { pipeline } = await import('@xenova/transformers');
      const _beforeResetCallCount = (pipeline as any).mock.calls.length;

      // Clear mock to count new calls
      (pipeline as any).mockClear();

      await transformer.init();

      expect((pipeline as any).mock.calls.length).toBe(1); // Reloaded after reset
    });

    it('allows reinitializing after reset', async () => {
      await transformer.init();
      transformer.reset();

      // Should reinitialize successfully
      await expect(transformer.init()).resolves.not.toThrow();

      const result = await transformer.predict('test');
      expect(result).toBeDefined();
    });
  });

  describe('Thread Safety', () => {
    it('handles 100 concurrent init calls', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      const promises = Array.from({ length: 100 }, () =>
        transformer.init()
      );

      await Promise.all(promises);

      // Model should load exactly once despite 100 concurrent calls
      expect((pipeline as any).mock.calls.length).toBe(1);
    });

    it('handles concurrent init and predict calls', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      const promises = [
        ...Array.from({ length: 5 }, () => transformer.init()),
        ...Array.from({ length: 5 }, () =>
          transformer.predict('test')
        ),
      ];

      const results = await Promise.all(promises);

      // All should complete
      expect(results).toHaveLength(10);

      // Model should load exactly once
      expect((pipeline as any).mock.calls.length).toBe(1);
    });

    it('prevents duplicate loading under high concurrency', async () => {
      const { pipeline } = await import('@xenova/transformers');

      vi.clearAllMocks();

      // Simulate high concurrency: 50 concurrent requests
      const concurrentCalls = Array.from({ length: 50 }, async (_, i) => {
        if (i % 2 === 0) {
          return transformer.init();
        } else {
          return transformer.predict('test');
        }
      });

      await Promise.all(concurrentCalls);

      // Pipeline (model loading) should be called exactly once
      expect((pipeline as any).mock.calls.length).toBe(1);
    });
  });
});
