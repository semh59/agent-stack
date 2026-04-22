import { pipeline } from '@xenova/transformers';
import { join } from 'node:path';
import { getConfigDir } from '../plugin/storage';

export interface TransformerResult {
  prediction: string;
  confidence: number;
  all_scores: Record<string, number>;
}

export class IntentTransformer {
  private static instance: IntentTransformer;
  private classifierPromise: Promise<unknown> | null = null;
  private classifier: unknown = null;
  private modelName = 'Xenova/nli-deberta-v3-small'; // Standard for zero-shot
  private labels = ['backend', 'frontend', 'qa', 'devops', 'security', 'lead_architect'];

  private constructor() {}

  public static getInstance(): IntentTransformer {
    if (!IntentTransformer.instance) {
      IntentTransformer.instance = new IntentTransformer();
    }
    return IntentTransformer.instance;
  }

  /**
   * Modeli yÃ¼kler (EÄŸer yÃ¼klenmemiÅŸse). Ä°lk yÃ¼kleme vakit alabilir (indirilir).
   *
   * Thread-safe initialization using Promise memoization:
   * - First call starts model loading and saves the Promise
   * - Concurrent calls receive the same Promise (no duplicate loading)
   * - Subsequent calls return immediately with cached classifier
   */
  public async init(): Promise<void> {
    // Fast path: Already initialized
    if (this.classifier) {
      return;
    }

    // If initialization is already in progress, wait for it
    // This prevents duplicate model loads from concurrent calls
    if (this.classifierPromise) {
      await this.classifierPromise;
      return;
    }

    // Start initialization and memoize the Promise
    this.classifierPromise = this._loadModel();

    try {
      this.classifier = await this.classifierPromise;
    } finally {
      // Keep the Promise cached so concurrent calls still see it,
      // but classifier is now set for fast path
    }
  }

  /**
   * Internal method to load the model (called only once per initialization).
   */
  private async _loadModel(): Promise<unknown> {
    const cacheDir = join(getConfigDir(), 'models');

    // Transformers.js local cache ve WASM ayarlarÄ±
    const options = {
      cache_dir: cacheDir,
    };

    try {
      const classifier = await pipeline('zero-shot-classification', this.modelName, options);
      console.log('[IntentTransformer] Model loaded successfully');
      return classifier;
    } catch (err) {
      console.error('[IntentTransformer] Model initialization failed:', err);
      // Clear the Promise cache so next call will retry
      this.classifierPromise = null;
      throw err;
    }
  }

  /**
   * Prompt'u analiz eder.
   */
  public async predict(text: string): Promise<TransformerResult> {
    if (!this.classifier) {
      await this.init();
    }

    const output = (await (this.classifier as (t: string, l: string[]) => Promise<any>)(text, this.labels)) as { labels: string[]; scores: number[] };

    const scores: Record<string, number> = {};
    output.labels.forEach((label: string, index: number) => {
      scores[label] = output.scores[index];
    });

    return {
      prediction: output.labels[0],
      confidence: output.scores[0],
      all_scores: scores
    };
  }

  /**
   * Reset the transformer (for testing or recovery).
   */
  public reset(): void {
    this.classifier = null;
    this.classifierPromise = null;
  }
}
