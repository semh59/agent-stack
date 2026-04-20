export enum ModelTier {
  OPUS = 'google/Sovereign-claude-opus-4-6-thinking',
  SONNET = 'google/Sovereign-claude-sonnet-4-6',
  GEMINI_PRO = 'google/Sovereign-gemini-3-pro',
  GEMINI_FLASH = 'google/Sovereign-gemini-3-flash',
}

export type TaskType = 'planning' | 'development' | 'operation' | 'qa' | 'research' | 'security';

/**
 * ModelSelector: GÃ¶rev tipine gÃ¶re 'Cost-Efficiency' ve 'Intelligence' dengesini kurar.
 * Sovereign model hiyerarÅŸisi:
 * - Opus (thinking): Planlama, mimari, gÃ¼venlik â€” kritik kararlar
 * - Sonnet: Kod yazma, geliÅŸtirme â€” hÄ±z + kalite dengesi
 * - Gemini Pro: GeniÅŸ context (1M token) â€” araÅŸtÄ±rma, bÃ¼yÃ¼k analiz
 * - Gemini Flash: Tekrarlayan gÃ¶revler â€” en ekonomik
 */
export class ModelSelector {
  /**
   * GÃ¶rev tipine gÃ¶re model Ã¶nerir.
   */
  public selectModel(taskType: TaskType, complexity: 'low' | 'medium' | 'high' = 'medium'): ModelTier {
    // 1. GÃ¼venlik ve kritik inceleme â†’ Opus (thinking)
    if (taskType === 'security') {
      return ModelTier.OPUS;
    }

    // 2. Stratejik planlama ve derin araÅŸtÄ±rma â†’ Gemini Pro (geniÅŸ context)
    if (taskType === 'planning' || (taskType === 'research' && complexity === 'high')) {
      return ModelTier.GEMINI_PRO;
    }

    // 3. Kod yazma, refactoring ve QA â†’ Sonnet (best all-rounder)
    if (taskType === 'development' || taskType === 'qa') {
      return ModelTier.SONNET;
    }

    // 4. Basit operasyonlar, dokÃ¼mantasyon, tekrarlayan â†’ Gemini Flash
    if (taskType === 'operation' || complexity === 'low') {
      return ModelTier.GEMINI_FLASH;
    }

    return ModelTier.SONNET; // Default
  }

  /**
   * Modelin yeteneklerini aÃ§Ä±klar (AÃ§Ä±klanabilirlik iÃ§in).
   */
  public getModelReasoning(tier: ModelTier): string {
    switch (tier) {
      case ModelTier.OPUS:
        return 'Deep reasoning with thinking â€” for architectural decisions and security audits.';
      case ModelTier.SONNET:
        return 'Balanced performance for coding, refactoring, and structural analysis.';
      case ModelTier.GEMINI_PRO:
        return 'Wide context window (1M tokens) for planning and research tasks.';
      case ModelTier.GEMINI_FLASH:
        return 'Fast and cost-effective for documentation and repetitive tasks.';
    }
  }
}
