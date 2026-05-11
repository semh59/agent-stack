"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostBridge = void 0;
// ─── Bridge Configuration ───────────────────────────────────────────────────
const BRIDGE_HOST = process.env.ALLOY_BRIDGE_HOST ?? "127.0.0.1";
const BRIDGE_PORT = parseInt(process.env.ALLOY_BRIDGE_PORT ?? "9100", 10);
const BRIDGE_SECRET = process.env.ALLOY_BRIDGE_SECRET ?? "";
// ─── Cost Bridge ────────────────────────────────────────────────────────────
class CostBridge {
    baseUrl;
    buffer = [];
    flushTimer = null;
    flushIntervalMs = 5_000; // Batch every 5s
    maxBufferSize = 50;
    maxRetries = 3;
    retryCount = 0;
    isFlushing = false;
    constructor(host, port) {
        this.baseUrl = `http://${host ?? BRIDGE_HOST}:${port ?? BRIDGE_PORT}`;
    }
    /**
     * Record a cost entry. Buffered and flushed in batches.
     */
    record(entry) {
        this.buffer.push(entry);
        if (this.buffer.length >= this.maxBufferSize) {
            void this.flush();
        }
        else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => void this.flush(), this.flushIntervalMs);
        }
    }
    /**
     * Flush buffered cost entries to the Python bridge.
     */
    async flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.buffer.length === 0 || this.isFlushing)
            return;
        this.isFlushing = true;
        const entries = this.buffer.splice(0, this.buffer.length);
        try {
            const headers = {
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
        }
        catch (error) {
            this.retryCount++;
            if (this.retryCount <= this.maxRetries) {
                // Put entries back for retry
                this.buffer.unshift(...entries);
                console.warn(`[CostBridge] Flush failed (attempt ${this.retryCount}/${this.maxRetries}):`, error instanceof Error ? error.message : String(error));
            }
            else {
                // Dead-letter: log and discard after max retries
                console.error(`[CostBridge] Dead-lettered ${entries.length} cost entries after ${this.maxRetries} retries`);
                this.retryCount = 0;
            }
        }
        finally {
            this.isFlushing = false;
        }
    }
    /**
     * Get the unified cost report from the Python bridge.
     */
    async getReport(period = "today") {
        try {
            const headers = {};
            if (BRIDGE_SECRET) {
                headers["X-Bridge-Secret"] = BRIDGE_SECRET;
            }
            const response = await fetch(`${this.baseUrl}/cost-report?period=${encodeURIComponent(period)}`, { headers, signal: AbortSignal.timeout(5_000) });
            if (!response.ok)
                return null;
            return (await response.json());
        }
        catch {
            return null;
        }
    }
    /**
     * Cleanup — flush remaining entries.
     */
    async dispose() {
        await this.flush();
    }
}
exports.CostBridge = CostBridge;
//# sourceMappingURL=cost-bridge.js.map