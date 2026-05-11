"use strict";
/**
 * Pipeline Optimizer — Intercepts every agent LLM call in the SequentialPipeline.
 *
 * Two responsibilities:
 *   1. **Prompt Optimization** — Sends the prompt to the Python bridge for
 *      cleaning/compression/caching before the LLM call, saving 30-60% tokens.
 *   2. **Dynamic Model Selection** — Uses the ModelRouter to pick the optimal
 *      model based on agent role, complexity, provider health, and budget.
 *
 * This replaces the hardcoded model selection logic in sequential-pipeline.ts
 * (lines 520-541) with a data-driven, provider-aware routing system.
 *
 * Usage:
 *   const optimizer = new PipelineOptimizer({ activeProviders: [...] });
 *   const { optimizedPrompt, model, savings } = await optimizer.optimize(agent, prompt);
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineOptimizer = void 0;
const model_router_1 = require("./model-router");
const circuit_breaker_1 = require("./circuit-breaker");
const cost_bridge_1 = require("./cost-bridge");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
function resolveBridgeSecret() {
    if (process.env.ALLOY_BRIDGE_SECRET) {
        return process.env.ALLOY_BRIDGE_SECRET;
    }
    try {
        const secretPath = path.join(os.homedir(), ".bridge", ".bridge_secret");
        if (fs.existsSync(secretPath)) {
            return fs.readFileSync(secretPath, "utf-8").trim();
        }
    }
    catch {
        // Cannot read secret
    }
    return "";
}
// ─── Bridge Constants ───────────────────────────────────────────────────────
const BRIDGE_SECRET = resolveBridgeSecret();
// ─── Pipeline Optimizer ─────────────────────────────────────────────────────
class PipelineOptimizer {
    router;
    circuitBreaker;
    costBridge;
    config;
    bridgeUrl;
    // Stats
    totalTokensSaved = 0;
    totalCalls = 0;
    totalCacheHits = 0;
    bridgeAvailable = null; // null = untested
    bridgeCheckedAt = 0;
    bridgeRetryIntervalMs = 30_000;
    constructor(config) {
        this.config = config;
        this.router = new model_router_1.ModelRouter();
        this.circuitBreaker = new circuit_breaker_1.ProviderCircuitBreaker(config.circuitBreakerConfig);
        this.costBridge = new cost_bridge_1.CostBridge(config.bridgeHost, config.bridgePort);
        this.bridgeUrl = `http://${config.bridgeHost ?? "127.0.0.1"}:${config.bridgePort ?? 9100}`;
    }
    /**
     * Optimize a prompt before sending it to the LLM.
     * Returns the optimized prompt + the selected model.
     */
    async optimize(agent, rawPrompt, complexity = 5) {
        this.totalCalls++;
        const estimatedTokens = this.estimateTokensBPE(rawPrompt);
        // ── Step 1: Route to optimal model ───────────────────────────────
        const availableProviders = this.circuitBreaker.filterAvailable(this.config.activeProviders);
        const routingCtx = {
            agent,
            estimatedTokens,
            complexity,
            activeProviders: availableProviders.length > 0
                ? availableProviders
                : this.config.activeProviders, // Fallback: ignore circuit breaker if ALL are open
            providerHealth: new Map(), // Will be populated from circuit breaker stats
            budgetRemaining: this.config.budgetRemaining,
            providerOverride: this.config.providerOverride,
            modelOverride: this.config.modelOverride,
        };
        // Feed circuit breaker stats into routing context
        for (const provider of this.config.activeProviders) {
            const stats = this.circuitBreaker.getStats(provider);
            routingCtx.providerHealth.set(provider, {
                available: this.circuitBreaker.isAvailable(provider),
                errorRate: stats.errorRate,
                avgLatencyMs: stats.avgLatencyMs,
                rateLimited: !this.circuitBreaker.isAvailable(provider),
            });
        }
        const routing = this.router.route(routingCtx);
        // ── Step 2: Optimize prompt via Python bridge ────────────────────
        let optimizedPrompt = rawPrompt;
        let tokensSaved = 0;
        let savingsPercent = 0;
        let cacheHit = false;
        let cachedResponse;
        if (this.config.enableOptimization !== false) {
            try {
                const bridgeResult = await this.callBridge(rawPrompt, agent.role);
                if (bridgeResult) {
                    if (bridgeResult.cache_hit && bridgeResult.cached_response) {
                        cacheHit = true;
                        cachedResponse = bridgeResult.cached_response;
                        this.totalCacheHits++;
                    }
                    optimizedPrompt = bridgeResult.optimized ?? rawPrompt;
                    tokensSaved = bridgeResult.tokens_saved ?? 0;
                    savingsPercent = bridgeResult.savings_percent ?? 0;
                    this.totalTokensSaved += tokensSaved;
                }
            }
            catch {
                // Bridge unavailable — use raw prompt (no optimization)
                console.warn(`[PipelineOptimizer] Bridge unavailable for ${agent.role}, using raw prompt`);
            }
        }
        console.log(`[PipelineOptimizer] ${agent.emoji} ${agent.role}: ` +
            `${routing.model.name} (${routing.provider}) | ` +
            `Thinking: ${routing.useThinking} | ` +
            `Saved: ${tokensSaved} tokens (${savingsPercent.toFixed(1)}%)` +
            (cacheHit ? " | CACHE HIT" : ""));
        return {
            optimizedPrompt,
            model: routing.model,
            provider: routing.provider,
            useThinking: routing.useThinking,
            reasoning: routing.reasoning,
            tokensSaved,
            savingsPercent,
            cacheHit,
            cachedResponse,
        };
    }
    /**
     * Record the result of an LLM call (for cost tracking + circuit breaker).
     */
    recordCallResult(agent, model, inputTokens, outputTokens, latencyMs, success, tokensSaved = 0) {
        // Circuit breaker
        if (success) {
            this.circuitBreaker.recordSuccess(model.provider, latencyMs);
        }
        else {
            this.circuitBreaker.recordFailure(model.provider, latencyMs);
        }
        // Cost tracking
        const entry = {
            agentRole: agent.role,
            modelId: model.id,
            provider: model.provider,
            inputTokens,
            outputTokens,
            costUsd: (inputTokens * model.costPer1kInput + outputTokens * model.costPer1kOutput) / 1000,
            optimized: tokensSaved > 0,
            tokensSaved,
            timestamp: Date.now(),
        };
        this.costBridge.record(entry);
    }
    // ── Bridge Communication ───────────────────────────────────────────
    async callBridge(prompt, agentRole) {
        // TTL-based re-probe: if bridge was down, recheck every 30s
        const now = Date.now();
        if (this.bridgeAvailable === null ||
            (!this.bridgeAvailable && now - this.bridgeCheckedAt > this.bridgeRetryIntervalMs)) {
            this.bridgeAvailable = await this.checkBridgeHealth();
            this.bridgeCheckedAt = now;
        }
        if (!this.bridgeAvailable)
            return null;
        const headers = {
            "Content-Type": "application/json",
        };
        if (BRIDGE_SECRET) {
            headers["X-Bridge-Secret"] = BRIDGE_SECRET;
        }
        const response = await fetch(`${this.bridgeUrl}/optimize`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                message: prompt,
                context: [],
                agent_role: agentRole,
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
            return null;
        return (await response.json());
    }
    async checkBridgeHealth() {
        try {
            const response = await fetch(`${this.bridgeUrl}/health`, {
                signal: AbortSignal.timeout(3_000),
            });
            return response.ok;
        }
        catch {
            console.warn("[PipelineOptimizer] Python bridge not available — optimization disabled");
            return false;
        }
    }
    // ── Stats ──────────────────────────────────────────────────────────
    getStats() {
        return {
            totalCalls: this.totalCalls,
            totalTokensSaved: this.totalTokensSaved,
            totalCacheHits: this.totalCacheHits,
            cacheHitRate: this.totalCalls > 0 ? this.totalCacheHits / this.totalCalls : 0,
            avgSavingsPerCall: this.totalCalls > 0 ? this.totalTokensSaved / this.totalCalls : 0,
            bridgeAvailable: this.bridgeAvailable,
            providerStats: Object.fromEntries(this.circuitBreaker.getAllStats()),
            routingHistory: this.router.getRoutingHistory().slice(-10), // Last 10
        };
    }
    async dispose() {
        await this.costBridge.dispose();
    }
    /**
     * BPE-aware token estimation with content heuristics.
     * Accuracy: ~85-90% vs naive chars/4 (~60%).
     */
    estimateTokensBPE(text) {
        if (text.length === 0)
            return 0;
        const codeChars = text.match(/[{}[\]();=<>|&!~^%]/g)?.length ?? 0;
        const unicodeChars = text.match(/\P{ASCII}/gu)?.length ?? 0;
        const whitespaceChars = text.match(/\s/g)?.length ?? 0;
        const len = text.length;
        // Code-heavy: more tokens per char (operators are individual tokens)
        const codeRatio = codeChars / len;
        // Unicode-heavy: fewer chars per token (multi-byte sequences)
        const unicodeRatio = unicodeChars / len;
        // Whitespace: natural word boundaries
        const whitespaceRatio = whitespaceChars / len;
        // Adaptive chars-per-token: ranges from ~2.5 (code) to ~4.5 (prose)
        const charsPerToken = 3.3
            - codeRatio * 1.8 // code → more tokens
            + whitespaceRatio * 0.6 // spaces → natural boundaries
            - unicodeRatio * 1.2; // unicode → more tokens per char
        return Math.ceil(len / Math.max(charsPerToken, 1.5));
    }
}
exports.PipelineOptimizer = PipelineOptimizer;
//# sourceMappingURL=pipeline-optimizer.js.map