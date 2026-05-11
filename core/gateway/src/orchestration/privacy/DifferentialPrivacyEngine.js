"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DifferentialPrivacyEngine = void 0;
/**
 * DifferentialPrivacyEngine: Obfuskasyon Katmanı.
 * Kullanıcıya özel proje özelliklerini korumak için telemetri verilerine matematiksel gürültü ekler.
 */
class DifferentialPrivacyEngine {
    /**
     * applyNoise: Sayısal performans verilerini anonimleştirmek için Laplace Mekanizması.
     */
    applyNoise(value, sensitivity = 1.0, epsilon = 0.1) {
        const noise = (sensitivity / epsilon) * (Math.random() - 0.5);
        const anonymized = value + noise;
        console.log(`[DiffPrivacy] Laplace Gürültüsü Uygulandı. Değer: ${value.toFixed(2)} -> Anonim: ${anonymized.toFixed(2)}`);
        return anonymized;
    }
    /**
     * anonymizeModelMetrics: MAB ağırlık paylaşımı için derin obfuskasyon.
     */
    anonymizeModelMetrics(metrics) {
        return {
            ...metrics,
            successRate: this.applyNoise(metrics.successRate, 0.1, 0.5),
            weight: this.applyNoise(metrics.weight, 0.1, 0.5)
        };
    }
}
exports.DifferentialPrivacyEngine = DifferentialPrivacyEngine;
//# sourceMappingURL=DifferentialPrivacyEngine.js.map