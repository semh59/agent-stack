export enum ModelTier {
  OPUS = 'google/antigravity-claude-opus-4-6-thinking',
  SONNET = 'google/antigravity-claude-sonnet-4-6',
  GEMINI_PRO = 'google/antigravity-gemini-3-pro',
  GEMINI_FLASH = 'google/antigravity-gemini-3-flash',
}

export type TaskType = 'planning' | 'development' | 'operation' | 'qa' | 'research' | 'security';

/**
 * ModelSelector: Görev tipine göre 'Cost-Efficiency' ve 'Intelligence' dengesini kurar.
 * Antigravity model hiyerarşisi:
 * - Opus (thinking): Planlama, mimari, güvenlik — kritik kararlar
 * - Sonnet: Kod yazma, geliştirme — hız + kalite dengesi
 * - Gemini Pro: Geniş context (1M token) — araştırma, büyük analiz
 * - Gemini Flash: Tekrarlayan görevler — en ekonomik
 */
export class ModelSelector {
  /**
   * Görev tipine göre model önerir.
   */
  public selectModel(taskType: TaskType, complexity: 'low' | 'medium' | 'high' = 'medium'): ModelTier {
    // 1. Güvenlik ve kritik inceleme → Opus (thinking)
    if (taskType === 'security') {
      return ModelTier.OPUS;
    }

    // 2. Stratejik planlama ve derin araştırma → Gemini Pro (geniş context)
    if (taskType === 'planning' || (taskType === 'research' && complexity === 'high')) {
      return ModelTier.GEMINI_PRO;
    }

    // 3. Kod yazma, refactoring ve QA → Sonnet (best all-rounder)
    if (taskType === 'development' || taskType === 'qa') {
      return ModelTier.SONNET;
    }

    // 4. Basit operasyonlar, dokümantasyon, tekrarlayan → Gemini Flash
    if (taskType === 'operation' || complexity === 'low') {
      return ModelTier.GEMINI_FLASH;
    }

    return ModelTier.SONNET; // Default
  }

  /**
   * Modelin yeteneklerini açıklar (Açıklanabilirlik için).
   */
  public getModelReasoning(tier: ModelTier): string {
    switch (tier) {
      case ModelTier.OPUS:
        return 'Deep reasoning with thinking — for architectural decisions and security audits.';
      case ModelTier.SONNET:
        return 'Balanced performance for coding, refactoring, and structural analysis.';
      case ModelTier.GEMINI_PRO:
        return 'Wide context window (1M tokens) for planning and research tasks.';
      case ModelTier.GEMINI_FLASH:
        return 'Fast and cost-effective for documentation and repetitive tasks.';
    }
  }
}
