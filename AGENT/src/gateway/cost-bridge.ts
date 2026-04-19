/**
 * Cost Bridge — TypeScript BudgetTracker → Python CostTracker
 *
 * Synchronizes cost tracking between the TS orchestration engine
 * and the Python optimization pipeline.
 *
 * Flow:
 *   1. AGENT makes an LLM call → BudgetTracker records TS-side cost
 *   2. CostBridge posts the cost to Python bridge → cost_tracker.py
 *   3. Python side tracks total optimization savings
 *   4. Dashboard pulls unified cost report from Python (single source of truth)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CostEntry {
  /** Which agent incurred this cost */
  agentRole: string;
  /** Which model was used */
  modelId: string;
  /** Which provider was used */
  provider: string;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Estimated cost in USD */
  costUsd: number;
  /** Whether the request was cache-optimized */
  optimized: boolean;
  /** Token savings from optimization */
  tokensSaved: number;
  /** Timestamp */
  timestamp: number;
}

export interface CostReport {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokensSaved: number;
  savingsPercent: number;
  entries: CostEntry[];
  byProvider: Record<string, { costUsd: number; tokens: number }>;
  byAgent: Record<string, { costUsd: number; tokens: number }>;
  period: string;
}

// ─── Bridge Configuration ───────────────────────────────────────────────────

const BRIDGE_HOST = process.env.AI_STACK_BRIDGE_HOST ?? "127.0.0.1";
const BRIDGE_PORT = parseInt(process.env.AI_STACK_BRIDGE_PORT ?? "9100", 10);
const BRIDGE_SECRET = process.env.AI_STACK_BRIDGE_SECRET ?? "";

// ─── Cost Bridge ────────────────────────────────────────────────────────────

export class CostBridge {
  private readonly baseUrl: string;
  private readonly buffer: CostEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs = 5_000; // Batch every 5s
  private readonly maxBufferSize = 50;
  private readonly maxRetries = 3;
  private retryCount = 0;
  private isFlushing = false;

  constructor(host?: string, port?: number) {
    this.baseUrl = `http://${host ?? BRIDGE_HOST}:${port ?? BRIDGE_PORT}`;
  }

  /**
   * Record a cost entry. Buffered and flushed in batches.
   */
  record(entry: CostEntry): void {
    this.buffer.push(entry);

    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.flushIntervalMs);
    }
  }

  /**
   * Flush buffered cost entries to the Python bridge.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0 || this.isFlushing) return;
    this.isFlushing = true;

    const entries = this.buffer.splice(0, this.buffer.length);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (BRIDGE_SECRET) {
        headers["X-Bridge-Secret"] = BRIDGE_SECRET;
      }

      await fetch(`${this.baseUrl}/cost-report`, {
        method: "POST",
        headers,
        body: JSON.stringify({ entries }),
        signal: AbortSignal.timeout(5_000),
      });
      // Important Phase 2.1 Fix: Reset retry count on success to prevent cumulative exhaustion
      this.retryCount = 0;
    } catch (error) {
      this.retryCount++;
      if (this.retryCount <= this.maxRetries) {
        // Put entries back for retry
        this.buffer.unshift(...entries);
        console.warn(
          `[CostBridge] Flush failed (attempt ${this.retryCount}/${this.maxRetries}):`,
          error instanceof Error ? error.message : String(error),
        );
      } else {
        // Dead-letter: log and discard after max retries
        console.error(
          `[CostBridge] Dead-lettered ${entries.length} cost entries after ${this.maxRetries} retries`,
        );
        this.retryCount = 0;
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Get the unified cost report from the Python bridge.
   */
  async getReport(period: string = "today"): Promise<CostReport | null> {
    try {
      const headers: Record<string, string> = {};
      if (BRIDGE_SECRET) {
        headers["X-Bridge-Secret"] = BRIDGE_SECRET;
      }

      const response = await fetch(
        `${this.baseUrl}/cost-report?period=${encodeURIComponent(period)}`,
        { headers, signal: AbortSignal.timeout(5_000) },
      );

      if (!response.ok) return null;
      return (await response.json()) as CostReport;
    } catch {
      return null;
    }
  }

  /**
   * Cleanup — flush remaining entries.
   */
  async dispose(): Promise<void> {
    await this.flush();
  }
}
