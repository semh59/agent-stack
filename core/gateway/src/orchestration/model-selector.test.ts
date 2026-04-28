import { describe, it, expect } from 'vitest';
import { ModelSelector, ModelTier, type TaskType, type BudgetContext } from './model-selector';

describe('ModelSelector', () => {
  const selector = new ModelSelector();

  // ── selectModel — basic task type routing ────────────────────────────────

  it('routes security tasks to OPUS', () => {
    expect(selector.selectModel('security')).toBe(ModelTier.OPUS);
  });

  it('routes planning tasks to GEMINI_PRO', () => {
    expect(selector.selectModel('planning')).toBe(ModelTier.GEMINI_PRO);
  });

  it('routes high-complexity research to GEMINI_PRO', () => {
    expect(selector.selectModel('research', 'high')).toBe(ModelTier.GEMINI_PRO);
  });

  it('routes development tasks to SONNET', () => {
    expect(selector.selectModel('development')).toBe(ModelTier.SONNET);
  });

  it('routes qa tasks to SONNET', () => {
    expect(selector.selectModel('qa')).toBe(ModelTier.SONNET);
  });

  it('routes operation tasks to GEMINI_FLASH', () => {
    expect(selector.selectModel('operation')).toBe(ModelTier.GEMINI_FLASH);
  });

  it('routes low-complexity tasks to GEMINI_FLASH', () => {
    expect(selector.selectModel('research', 'low')).toBe(ModelTier.GEMINI_FLASH);
  });

  it('defaults to SONNET for unknown combinations', () => {
    expect(selector.selectModel('research', 'medium')).toBe(ModelTier.SONNET);
  });

  // ── applyBudgetConstraint — low budget ───────────────────────────────────

  it('downgrades OPUS → SONNET when budget < $0.10', () => {
    const budget: BudgetContext = { remainingBudgetUsd: 0.05 };
    expect(selector.selectModel('security', 'high', budget)).toBe(ModelTier.SONNET);
  });

  it('downgrades GEMINI_PRO → GEMINI_FLASH when budget < $0.10', () => {
    const budget: BudgetContext = { remainingBudgetUsd: 0.09 };
    expect(selector.selectModel('planning', 'medium', budget)).toBe(ModelTier.GEMINI_FLASH);
  });

  it('does NOT downgrade when budget is exactly $0.10', () => {
    const budget: BudgetContext = { remainingBudgetUsd: 0.10 };
    expect(selector.selectModel('security', 'high', budget)).toBe(ModelTier.OPUS);
  });

  it('does NOT downgrade when budget is above threshold', () => {
    const budget: BudgetContext = { remainingBudgetUsd: 1.00 };
    expect(selector.selectModel('security', 'high', budget)).toBe(ModelTier.OPUS);
  });

  // ── applyBudgetConstraint — high quota ───────────────────────────────────

  it('downgrades OPUS → SONNET when quota > 85%', () => {
    const budget: BudgetContext = { quotaUsageRatio: 0.90 };
    expect(selector.selectModel('security', 'high', budget)).toBe(ModelTier.SONNET);
  });

  it('downgrades GEMINI_PRO → GEMINI_FLASH when quota > 85%', () => {
    const budget: BudgetContext = { quotaUsageRatio: 0.86 };
    expect(selector.selectModel('planning', 'medium', budget)).toBe(ModelTier.GEMINI_FLASH);
  });

  it('does NOT downgrade when quota is exactly 0.85', () => {
    const budget: BudgetContext = { quotaUsageRatio: 0.85 };
    expect(selector.selectModel('security', 'high', budget)).toBe(ModelTier.OPUS);
  });

  it('does NOT downgrade SONNET or GEMINI_FLASH (already cheap)', () => {
    const budget: BudgetContext = { remainingBudgetUsd: 0.01, quotaUsageRatio: 0.99 };
    expect(selector.selectModel('development', 'high', budget)).toBe(ModelTier.SONNET);
    expect(selector.selectModel('operation', 'low', budget)).toBe(ModelTier.GEMINI_FLASH);
  });

  // ── applyBudgetConstraint — combined budget + quota ──────────────────────

  it('downgrades when both budget AND quota are constrained', () => {
    const budget: BudgetContext = { remainingBudgetUsd: 0.05, quotaUsageRatio: 0.95 };
    expect(selector.selectModel('security', 'high', budget)).toBe(ModelTier.SONNET);
  });

  it('uses empty BudgetContext as default (no downgrade)', () => {
    expect(selector.selectModel('security', 'high', {})).toBe(ModelTier.OPUS);
  });

  it('omitting budget parameter behaves identically to empty object', () => {
    expect(selector.selectModel('security')).toBe(selector.selectModel('security', 'medium', {}));
  });

  // ── getModelReasoning ────────────────────────────────────────────────────

  it('returns non-empty reasoning string for every tier', () => {
    for (const tier of Object.values(ModelTier)) {
      const reasoning = selector.getModelReasoning(tier);
      expect(reasoning.length).toBeGreaterThan(10);
    }
  });

  it('reasoning mentions "thinking" for OPUS tier', () => {
    expect(selector.getModelReasoning(ModelTier.OPUS)).toMatch(/thinking/i);
  });

  it('reasoning mentions "context" for GEMINI_PRO tier', () => {
    expect(selector.getModelReasoning(ModelTier.GEMINI_PRO)).toMatch(/context/i);
  });
});
