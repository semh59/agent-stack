import * as fs from 'fs';
import * as path from 'path';
import { GlobalEventBus } from '../../../core/gateway/src/gateway/event-bus';

export interface CostTrackerStats {
  used: number;
  budget: number;
  remaining: number;
  percent: number;
  burnRatePerMin: number;
  estimatedExhaustion: string | null;
}

interface DataPoint {
  timeMs: number;
  tokens: number;
}

/**
 * UnifiedCostTracker: Monitors LLM resource consumption for Alloy AI.
 * Advanced fusion:
 *  - EventBus integration for live stats
 *  - EWMA (Exponential Weighted Moving Average) burn rate
 *  - Linear regression for budget exhaustion prediction
 */
export class UnifiedCostTracker {
  private totalTokens: number = 0;
  private budget: number = 1000000; // Default 1M tokens
  private storageFilePath: string | null = null;
  
  // Advanced metrics
  private readonly dataPoints: DataPoint[] = [];
  private readonly maxDataPoints = 50;
  private ewmaBurnRate = 0;
  private readonly ewmaAlpha = 0.3;

  constructor(limit?: number, storagePath?: string) {
    if (limit) this.budget = limit;
    if (storagePath) {
      this.storageFilePath = path.join(storagePath, 'token-stats.json');
      this.loadFromDisk();
    }
  }

  private loadFromDisk() {
    if (!this.storageFilePath) return;
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const data = fs.readFileSync(this.storageFilePath, 'utf8');
        const parsed = JSON.parse(data);
        if (typeof parsed.totalTokens === 'number') {
          this.totalTokens = parsed.totalTokens;
        }
      }
    } catch (err) {
      console.error('[UnifiedCostTracker] Load err:', err);
    }
  }

  private saveToDisk() {
    if (!this.storageFilePath) return;
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storageFilePath, JSON.stringify({ totalTokens: this.totalTokens }), 'utf8');
    } catch (err) {
      console.error('[UnifiedCostTracker] Save err:', err);
    }
  }

  /**
   * Record token usage and update advanced metrics
   */
  public track(tokens: number) {
    this.totalTokens += tokens;
    this.saveToDisk();

    const now = Date.now();
    this.dataPoints.push({ timeMs: now, tokens: this.totalTokens });
    if (this.dataPoints.length > this.maxDataPoints) {
      this.dataPoints.shift();
    }

    this.updateBurnRate();

    const percent = Math.min(100, Math.round((this.totalTokens / this.budget) * 100));
    
    // Fire warning events at thresholds
    if (percent === 50 || percent === 75 || percent >= 90) {
      const exhaustDate = this.predictBudgetExhaustion();
      GlobalEventBus.emit({
        type: "budget:warning",
        used: this.totalTokens,
        limit: this.budget,
        percent,
        exhaustDate: exhaustDate ? exhaustDate.toISOString() : null
      });
    }
  }

  private updateBurnRate(): void {
    if (this.dataPoints.length < 2) return;
    const latest = this.dataPoints[this.dataPoints.length - 1];
    const previous = this.dataPoints[this.dataPoints.length - 2];
    
    const timeDeltaMin = (latest.timeMs - previous.timeMs) / 60000;
    if (timeDeltaMin <= 0) return;

    const tokenDelta = latest.tokens - previous.tokens;
    const currentRate = tokenDelta / timeDeltaMin;

    if (this.ewmaBurnRate === 0) {
      this.ewmaBurnRate = currentRate;
    } else {
      this.ewmaBurnRate = (this.ewmaAlpha * currentRate) + ((1 - this.ewmaAlpha) * this.ewmaBurnRate);
    }
  }

  /**
   * Linear regression (y = mx + b)
   * x = timeMs, y = cumulative tokens
   */
  private predictBudgetExhaustion(): Date | null {
    if (this.dataPoints.length < 5) return null;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = this.dataPoints.length;
    // Normalize X (time) to start at 0 to avoid huge numbers
    const xOffset = this.dataPoints[0].timeMs;

    for (const point of this.dataPoints) {
      const x = point.timeMs - xOffset;
      const y = point.tokens;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denominator = (n * sumX2) - (sumX * sumX);
    if (denominator === 0) return null;

    const slope = ((n * sumXY) - (sumX * sumY)) / denominator;
    const intercept = ((sumY * sumX2) - (sumX * sumXY)) / denominator;

    if (slope <= 0) return null; // Not growing

    const exhaustionX = (this.budget - intercept) / slope;
    const exhaustionMs = exhaustionX + xOffset;

    // If it's more than a year out or in the past, return null
    if (exhaustionMs <= Date.now() || exhaustionMs > Date.now() + 31536000000) return null;
    
    return new Date(exhaustionMs);
  }

  /**
   * Get current consumption metrics.
   */
  public getStats(): CostTrackerStats {
    const exhaustDate = this.predictBudgetExhaustion();
    return {
      used: this.totalTokens,
      budget: this.budget,
      remaining: Math.max(0, this.budget - this.totalTokens),
      percent: Math.min(100, Math.round((this.totalTokens / this.budget) * 100)),
      burnRatePerMin: Math.round(this.ewmaBurnRate),
      estimatedExhaustion: exhaustDate ? exhaustDate.toISOString() : null
    };
  }

  public reset() {
    this.totalTokens = 0;
    this.dataPoints.length = 0;
    this.ewmaBurnRate = 0;
    this.saveToDisk();
  }
}
