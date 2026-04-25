import type { SharedMemory } from '../shared-memory';
import { ModelDiscoveryService } from './ModelDiscoveryService';

export interface ModelMetrics {
  id: string;
  name: string;
  successRate: number;
  avgLatency: number;
  tokenCost: number;
  weight: number; // MAB "Arm" değeri
}

/**
 * ModelRouterEngine: Olasılıksal Karar Merkezi.
 * Multi-Armed Bandit (MAB) kullanarak en uygun modeli dinamik olarak seçer.
 * Artık kalıcı bellek (Persistence) ve dinamik keşif (Discovery) destekli.
 */
export class ModelRouterEngine {
  private models: ModelMetrics[] = [];
  private discovery: ModelDiscoveryService;
  private isInitialized: boolean = false;

  constructor(private memory: SharedMemory) {
    this.discovery = new ModelDiscoveryService(memory);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Önce diskteki kalıcı metrikleri yükle
    const savedData = await this.memory.loadModelMetrics();
    const savedMetrics = savedData as unknown as ModelMetrics[] | null;
    
    // 2. Güncel model listesini (Market/API) senkronize et
    const latestModels = await this.discovery.syncLatestModels();

    if (savedMetrics && savedMetrics.length > 0) {
      // Kalıcı verilerle güncel listeyi harmanla
      this.models = latestModels.map(m => {
        const saved = (savedMetrics as ModelMetrics[]).find(s => s.id === m.id);
        return saved ? { ...m, ...saved } : m;
      });
      console.log('[ModelRouter] Kalıcı metrikler ve güncel modeller harmanlandı.');
    } else {
      this.models = latestModels;
      console.log('[ModelRouter] Yeni model kaydı oluşturuldu.');
    }

    this.isInitialized = true;
  }

  /**
   * routeTask: Epsilon-Greedy stratejisiyle kazananı belirler.
   */
  public async routeTask(taskType: 'CODE' | 'RESEARCH' | 'SECURITY'): Promise<string> {
    await this.ensureInitialized();
    console.log(`[ModelRouter] Görev yönlendiriliyor: ${taskType}`);

    const epsilon = 0.15; // %15 Explorasyon
    const random = Math.random();

    if (random < epsilon) {
      const randomIndex = Math.floor(Math.random() * this.models.length);
      const selected = this.models[randomIndex]!;
      console.log(`[ModelRouter] Mod: EXPLORASYON (MAB). Seçilen: ${selected.name}`);
      return selected.id;
    }

    const winner = this.models.reduce((prev, curr) => {
      const prevScore = (prev.successRate * prev.weight) / (prev.tokenCost * 100);
      const currScore = (curr.successRate * curr.weight) / (curr.tokenCost * 100);
      return currScore > prevScore ? curr : prev;
    });

    console.log(`[ModelRouter] Mod: EKSPLOİTASYON (MAB). En İyi Performans: ${winner.name}`);
    return winner.id;
  }

  /**
   * updatePerformance: Sonuca göre modeli ödüllendirir veya cezalandırır ve diske yazar.
   */
  public async updatePerformance(modelId: string, success: boolean, latency: number): Promise<void> {
    await this.ensureInitialized();
    const model = this.models.find(m => m.id === modelId);
    if (!model) return;

    const learningRate = 0.05;
    if (success) {
      model.weight = Math.min(1.0, model.weight + learningRate);
      model.successRate = (model.successRate * 0.9) + (1.0 * 0.1);
    } else {
      model.weight = Math.max(0.1, model.weight - learningRate);
      model.successRate = (model.successRate * 0.9) + (0.0 * 0.1);
    }

    model.avgLatency = (model.avgLatency * 0.8) + (latency * 0.2);
    // Değişiklikleri kalıcı hale getir (Tip uyumu için cast kullanıldı)
    await this.memory.saveModelMetrics(this.models as unknown as Record<string, unknown>[]);
    console.log(`[ModelRouter] Adaptif Öğrenme Kaydedildi: ${model.name} (Ağırlık: ${model.weight.toFixed(2)})`);
  }
}
