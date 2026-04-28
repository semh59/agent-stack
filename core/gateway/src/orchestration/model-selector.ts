export enum ModelTier {
  OPUS        = ‘google/Alloy-claude-opus-4-6-thinking’,
  SONNET      = ‘google/Alloy-claude-sonnet-4-6’,
  GEMINI_PRO  = ‘google/Alloy-gemini-3-pro’,
  GEMINI_FLASH = ‘google/Alloy-gemini-3-flash’,
}

export type TaskType = ‘planning’ | ‘development’ | ‘operation’ | ‘qa’ | ‘research’ | ‘security’;

export interface BudgetContext {
  /** Remaining budget in USD. undefined = unlimited */
  remainingBudgetUsd?: number;
  /** Token quota usage ratio 0–1. 0.9 = 90% consumed */
  quotaUsageRatio?: number;
}

/**
 * Apply budget/quota constraints: downgrade expensive models when
 * budget is low (<$0.10) or quota is nearly exhausted (>85%).
 */
function applyBudgetConstraint(preferred: ModelTier, ctx: BudgetContext): ModelTier {
  const lowBudget = ctx.remainingBudgetUsd !== undefined && ctx.remainingBudgetUsd < 0.10;
  const highQuota = ctx.quotaUsageRatio  !== undefined && ctx.quotaUsageRatio  > 0.85;

  if (!lowBudget && !highQuota) return preferred;

  if (preferred === ModelTier.OPUS)       return ModelTier.SONNET;
  if (preferred === ModelTier.GEMINI_PRO) return ModelTier.GEMINI_FLASH;
  return preferred;
}

/**
 * ModelSelector: balances Cost-Efficiency and Intelligence per task type.
 * - Opus (thinking): security audits, critical architectural decisions
 * - Sonnet: coding, refactoring, QA — best all-round
 * - Gemini Pro: wide context (1M tokens) — planning & research
 * - Gemini Flash: fast, cheap — ops, docs, repetitive tasks
 */
export class ModelSelector {
  public selectModel(
    taskType: TaskType,
    complexity: ‘low’ | ‘medium’ | ‘high’ = ‘medium’,
    budget: BudgetContext = {},
  ): ModelTier {
    let preferred: ModelTier;

    if (taskType === ‘security’) {
      preferred = ModelTier.OPUS;
    } else if (taskType === ‘planning’ || (taskType === ‘research’ && complexity === ‘high’)) {
      preferred = ModelTier.GEMINI_PRO;
    } else if (taskType === ‘development’ || taskType === ‘qa’) {
      preferred = ModelTier.SONNET;
    } else if (taskType === ‘operation’ || complexity === ‘low’) {
      preferred = ModelTier.GEMINI_FLASH;
    } else {
      preferred = ModelTier.SONNET;
    }

    return applyBudgetConstraint(preferred, budget);
  }

  public getModelReasoning(tier: ModelTier): string {
    switch (tier) {
      case ModelTier.OPUS:
        return ‘Deep reasoning with thinking — for architectural decisions and security audits.’;
      case ModelTier.SONNET:
        return ‘Balanced performance for coding, refactoring, and structural analysis.’;
      case ModelTier.GEMINI_PRO:
        return ‘Wide context window (1M tokens) for planning and research tasks.’;
      case ModelTier.GEMINI_FLASH:
        return ‘Fast and cost-effective for documentation and repetitive tasks.’;
    }
  }
}
