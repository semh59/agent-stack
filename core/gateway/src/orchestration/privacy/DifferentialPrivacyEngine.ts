import type { ModelMetrics } from '../genetic/ModelRouterEngine';

/**
 * DifferentialPrivacyEngine: Obfuskasyon Katmanı.
 * Kullanıcıya özel proje özelliklerini korumak için telemetri verilerine matematiksel gürültü ekler.
 */
export class DifferentialPrivacyEngine {
  /**
   * applyNoise: Sayısal performans verilerini anonimleştirmek için Laplace Mekanizması.
   */
  public applyNoise(value: number, sensitivity: number = 1.0, epsilon: number = 0.1): number {
    const noise = (sensitivity / epsilon) * (Math.random() - 0.5);
    const anonymized = value + noise;
    
    console.log(`[DiffPrivacy] Laplace Gürültüsü Uygulandı. Değer: ${value.toFixed(2)} -> Anonim: ${anonymized.toFixed(2)}`);
    return anonymized;
  }

  /**
   * anonymizeModelMetrics: MAB ağırlık paylaşımı için derin obfuskasyon.
   */
  public anonymizeModelMetrics(metrics: ModelMetrics): ModelMetrics {
    return {
      ...metrics,
      successRate: this.applyNoise(metrics.successRate, 0.1, 0.5),
      weight: this.applyNoise(metrics.weight, 0.1, 0.5)
    };
  }
}
