export interface Hypothesis {
  cause: string;
  probability: number; // 0-1
  evidence: string;
  fix: string;
}

export interface DiagnosisResult {
  hypotheses: Hypothesis[];
  strategy: 'interactive' | 'observability' | 'statistical';
  riskScore: number;
}

export class SelfHealingEngine {
  /**
   * Hata mesajını ve context'i analiz ederek hipotezler üretir.
   */
  public diagnose(errorMessage: string, stackTrace?: string): DiagnosisResult {
    const hypotheses: Hypothesis[] = [];
    
    // 1. Örüntü Tanıma (Basitleştirilmiş 'Smart Debug' mantığı)
    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      hypotheses.push({
        cause: 'External API or Database timeout',
        probability: 0.8,
        evidence: 'Error message indicates connection timeout.',
        fix: 'Check network connectivity or increase timeout settings.'
      });
    }

    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      hypotheses.push({
        cause: 'Resource missing or incorrect path',
        probability: 0.9,
        evidence: 'HTTP 404 or File Not Found error.',
        fix: 'Verify resource existence and check routing/path configuration.'
      });
    }

    if (errorMessage.includes('is not a function') || errorMessage.includes('undefined')) {
      hypotheses.push({
        cause: 'Null/Undefined reference (Runtime error)',
        probability: 0.85,
        evidence: 'Common JS runtime error pattern.',
        fix: 'Add null checks and verify object initialization.'
      });
    }

    // Default hipotez
    if (hypotheses.length === 0) {
      hypotheses.push({
        cause: 'Unknown logical or environment error',
        probability: 0.5,
        evidence: 'General crash pattern.',
        fix: 'Run with DEBUG=* and check system logs.'
      });
    }

    return {
      hypotheses: hypotheses.sort((a, b) => b.probability - a.probability),
      strategy: errorMessage.includes('intermittent') ? 'statistical' : 'interactive',
      riskScore: hypotheses.some(h => h.probability > 0.8) ? 3 : 5
    };
  }
}
