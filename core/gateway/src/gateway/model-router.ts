/**
 * Provider-Aware Model Router
 *
 * Intelligently selects the best model for each agent call based on:
 *   1. Active provider(s) â€” Google Alloy / Claude Code / both
 *   2. Agent role tier â€” Plan (thinking) vs Execute (fast)
 *   3. Complexity score â€” from MAB or heuristic
 *   4. Context size â€” token count determines tier
 *   5. Provider health â€” circuit breaker / rate limit state
 *   6. Cost constraints â€” budget tracker limits
 *
 * This replaces the hardcoded `preferredModel` in agents.ts with 
 * a dynamic routing decision at runtime.
 */

import type { AgentDefinition } from "../orchestration/agents";
import { AgentLayer } from "../orchestration/agents";
import {
  AIProvider,
  type ProviderModel,
  GOOGLE_GEMINI_MODELS,
  CLAUDE_CODE_MODELS,
} from "./provider-types";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RoutingContext {
  /** The agent making the request */
  agent: AgentDefinition;
  /** Approximate token count of the prompt */
  estimatedTokens: number;
  /** Current complexity score (0-10) */
  complexity: number;
  /** Available providers with valid tokens */
  activeProviders: AIProvider[];
  /** Provider health status */
  providerHealth: Map<AIProvider, ProviderHealth>;
  /** Remaining budget (tokens) */
  budgetRemaining?: number;
  /** Force a specific provider */
  providerOverride?: AIProvider;
  /** Force a specific model */
  modelOverride?: string;
}

export interface ProviderHealth {
  available: boolean;
  errorRate: number;
  avgLatencyMs: number;
  rateLimited: boolean;
  rateLimitResetsAt?: number;
}

export interface RoutingDecision {
  model: ProviderModel;
  provider: AIProvider;
  reasoning: string;
  tier: ProviderModel["tier"];
  /** Fallback model if primary fails */
  fallback?: ProviderModel;
  /** Whether thinking/extended mode should be used */
  useThinking: boolean;
}

// â”€â”€â”€ Role â†’ Tier Mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Agents that require deep thinking / planning capacity */
const THINKING_ROLES = new Set([
  "ceo", "pm", "architect", "api_designer",
  "code_review", "security", "tech_writer",
]);

/** Agents that need balanced reasoning + execution */
const BALANCED_ROLES = new Set([
  "ui_ux", "database", "backend", "frontend",
  "auth", "integration",
]);

/** Agents that benefit from fast execution */
const FAST_ROLES = new Set([
  "unit_test", "integration_test", "docs",
  "performance", "devops",
]);

// â”€â”€â”€ Model Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class ModelRouter {
  private routingHistory: RoutingDecision[] = [];
  private readonly maxHistorySize = 100;

  /**
   * Select the optimal model for a given routing context.
   */
  route(ctx: RoutingContext): RoutingDecision {
    // Manual override â€” respect user/system explicit choice
    if (ctx.modelOverride) {
      return this.resolveOverride(ctx.modelOverride, ctx);
    }

    // Determine the ideal tier based on agent role + complexity
    const targetTier = this.determineTier(ctx);

    // Select the best available provider for this tier
    const provider = this.selectProvider(ctx, targetTier);

    // Pick the model from the chosen provider
    const model = this.selectModel(provider, targetTier);
    const fallback = this.selectFallback(provider, targetTier, ctx);
    const useThinking = this.shouldUseThinking(ctx);

    const decision: RoutingDecision = {
      model,
      provider,
      reasoning: this.buildReasoning(ctx, model, targetTier),
      tier: targetTier,
      fallback,
      useThinking,
    };

    // Track history for analytics
    this.routingHistory.push(decision);
    if (this.routingHistory.length > this.maxHistorySize) {
      this.routingHistory.shift();
    }

    return decision;
  }

  /**
   * Route for a batch of agents (e.g., when the user assigns work to a group).
   */
  routeBatch(agents: AgentDefinition[], ctx: Omit<RoutingContext, "agent">): Map<string, RoutingDecision> {
    const decisions = new Map<string, RoutingDecision>();
    for (const agent of agents) {
      decisions.set(agent.role, this.route({ ...ctx, agent }));
    }
    return decisions;
  }

  // â”€â”€ Tier Determination â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private determineTier(ctx: RoutingContext): ProviderModel["tier"] {
    const { agent, complexity } = ctx;

    // Role-based tier assignment
    if (THINKING_ROLES.has(agent.role)) {
      // Thinking agents: powerful unless complexity is very low
      return complexity >= 7 ? "ultimate" : "powerful";
    }

    if (BALANCED_ROLES.has(agent.role)) {
      // Balanced agents: scale with complexity
      if (complexity >= 8) return "powerful";
      if (complexity >= 5) return "balanced";
      return "fast";
    }

    if (FAST_ROLES.has(agent.role)) {
      // Fast agents: always fast unless very complex
      return complexity >= 9 ? "balanced" : "fast";
    }

    // Complexity-based fallback
    if (complexity >= 9) return "ultimate";
    if (complexity >= 7) return "powerful";
    if (complexity >= 4) return "balanced";
    return "fast";
  }

  // â”€â”€ Provider Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private selectProvider(ctx: RoutingContext, tier: ProviderModel["tier"]): AIProvider {
    if (ctx.providerOverride && ctx.activeProviders.includes(ctx.providerOverride)) {
      return ctx.providerOverride;
    }

    if (ctx.activeProviders.length === 1) {
      return ctx.activeProviders[0]!;
    }

    // Multi-provider strategy: choose based on tier and health
    const scores = new Map<AIProvider, number>();

    for (const provider of ctx.activeProviders) {
      let score = 0;
      const health = ctx.providerHealth.get(provider);

      // Health penalty
      if (health) {
        if (!health.available || health.rateLimited) {
          score -= 1000;
        }
        score -= health.errorRate * 100; // Penalize error-prone providers
        score -= health.avgLatencyMs / 100; // Slight latency penalty
      }

      // Provider strengths by tier
      if (provider === AIProvider.GOOGLE_GEMINI) {
        // Google AG: free models, great for fast/balanced
        if (tier === "fast") score += 50;
        if (tier === "balanced") score += 30;
        if (tier === "ultimate") score += 40; // Opus 4.6 via AG is free
        score += 20; // Cost advantage (free)
      }

      if (provider === AIProvider.CLAUDE_CODE) {
        // Claude direct: better latency for Claude models
        if (tier === "powerful") score += 30;
        if (tier === "ultimate") score += 20;
      }

      // Budget awareness
      if (ctx.budgetRemaining !== undefined && ctx.budgetRemaining < 1000) {
        if (provider === AIProvider.GOOGLE_GEMINI) score += 100; // Free is preferred when low budget
      }

      scores.set(provider, score);
    }

    // Return highest score
    let bestProvider = ctx.activeProviders[0]!;
    let bestScore = -Infinity;
    for (const [provider, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestProvider = provider;
      }
    }

    return bestProvider;
  }

  // â”€â”€ Model Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private selectModel(provider: AIProvider, tier: ProviderModel["tier"]): ProviderModel {
    const models = provider === AIProvider.GOOGLE_GEMINI
      ? GOOGLE_GEMINI_MODELS
      : CLAUDE_CODE_MODELS;

    // Find exact tier match
    const match = models.find(m => m.tier === tier);
    if (match) return match;

    // Tier fallback chain: ultimate â†’ powerful â†’ balanced â†’ fast
    const tierOrder: ProviderModel["tier"][] = ["ultimate", "powerful", "balanced", "fast"];
    const tierIndex = tierOrder.indexOf(tier);

    // Try lower tiers
    for (let i = tierIndex + 1; i < tierOrder.length; i++) {
      const fallback = models.find(m => m.tier === tierOrder[i]!);
      if (fallback) return fallback;
    }

    // Try higher tiers
    for (let i = tierIndex - 1; i >= 0; i--) {
      const fallback = models.find(m => m.tier === tierOrder[i]!);
      if (fallback) return fallback;
    }

    // Absolute fallback â€” first model in the list
    return models[0]!;
  }

  private selectFallback(
    primaryProvider: AIProvider,
    tier: ProviderModel["tier"],
    ctx: RoutingContext,
  ): ProviderModel | undefined {
    // Try the other provider as fallback
    const otherProvider = ctx.activeProviders.find(p => p !== primaryProvider);
    if (!otherProvider) return undefined;

    return this.selectModel(otherProvider, tier);
  }

  // â”€â”€ Thinking Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private shouldUseThinking(ctx: RoutingContext): boolean {
    // Use thinking mode for:
    // 1. Thinking-tier agents
    // 2. High complexity tasks
    // 3. Architecture/review roles
    return (
      THINKING_ROLES.has(ctx.agent.role) ||
      ctx.complexity >= 8 ||
      ctx.agent.layer === AgentLayer.MANAGEMENT
    );
  }

  // â”€â”€ Override Resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private resolveOverride(modelId: string, ctx: RoutingContext): RoutingDecision {
    const allModels = [...GOOGLE_GEMINI_MODELS, ...CLAUDE_CODE_MODELS];
    const model = allModels.find(m => m.id === modelId);

    if (model) {
      return {
        model,
        provider: model.provider,
        reasoning: `Manual override: ${modelId}`,
        tier: model.tier,
        useThinking: model.supportsThinking && THINKING_ROLES.has(ctx.agent.role),
      };
    }

    // Unknown model â€” treat as custom, wrap in a synthetic ProviderModel
    const syntheticModel: ProviderModel = {
      id: modelId,
      name: modelId,
      provider: ctx.activeProviders[0] ?? AIProvider.GOOGLE_GEMINI,
      maxTokens: 32_768,
      supportsStreaming: true,
      supportsThinking: false,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      tier: "balanced",
    };

    return {
      model: syntheticModel,
      provider: syntheticModel.provider,
      reasoning: `Manual override (unknown model): ${modelId}`,
      tier: "balanced",
      useThinking: false,
    };
  }

  // â”€â”€ Reasoning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private buildReasoning(
    ctx: RoutingContext,
    model: ProviderModel,
    tier: ProviderModel["tier"],
  ): string {
    const parts = [
      `Agent: ${ctx.agent.role} (${ctx.agent.layer})`,
      `Complexity: ${ctx.complexity}/10`,
      `Tokens: ~${ctx.estimatedTokens}`,
      `Tier: ${tier}`,
      `Selected: ${model.name} (${model.provider})`,
    ];

    if (ctx.budgetRemaining !== undefined) {
      parts.push(`Budget: ${ctx.budgetRemaining} tokens remaining`);
    }

    return parts.join(" | ");
  }

  // â”€â”€ Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getRoutingHistory(): RoutingDecision[] {
    return [...this.routingHistory];
  }

  getProviderDistribution(): Map<AIProvider, number> {
    const dist = new Map<AIProvider, number>();
    for (const decision of this.routingHistory) {
      dist.set(decision.provider, (dist.get(decision.provider) ?? 0) + 1);
    }
    return dist;
  }

  getTierDistribution(): Map<ProviderModel["tier"], number> {
    const dist = new Map<ProviderModel["tier"], number>();
    for (const decision of this.routingHistory) {
      dist.set(decision.tier, (dist.get(decision.tier) ?? 0) + 1);
    }
    return dist;
  }
}
