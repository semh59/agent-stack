import { IntentClassifier, type TrainingExample } from './intent-classifier';
import { IntentTransformer } from './intent-transformer';
import { join } from 'node:path';
import { getConfigDir } from '../plugin/storage';
import { promises as fs } from 'node:fs';

export const PipelineType = {
  BUG_FIX: 'BUG_FIX',
  NEW_FEATURE: 'NEW_FEATURE',
  REFACTOR: 'REFACTOR',
  RESEARCH: 'RESEARCH'
} as const;

export type PipelineType = typeof PipelineType[keyof typeof PipelineType];

export interface IntentResult {
  pipeline: PipelineType;
  specialist: string;
  prediction: string; // Same as specialist for schema compliance
  confidence: number;
  feature_importance?: Record<string, number>;
  model_version: string;
  fallback_triggered: boolean;
  physics_override: boolean;
  tags: string[];
  method: 'ml' | 'hybrid' | 'fallback';
}

export class IntentEngine {
  private classifier: IntentClassifier;
  private transformer: IntentTransformer;
  private transformerEnabled = false;
  private keywordMap = {
    backend: ['api', 'endpoint', 'database', 'db', 'model', 'migration', 'service', 'python', 'auth', 'oauth', 'backend'],
    frontend: ['component', 'sayfa', 'page', 'ui', 'style', 'react', 'state', 'form', 'frontend', 'css', 'html', 'health', 'kalori', 'calorie', 'takip', 'timer', 'sayaÃ§', 'sayacÄ±', 'countdown'],
    qa: ['test', 'coverage', 'bug', 'edge case', 'regression', 'qa', 'vitest', 'jest', 'playwright', 'kalite', 'analizi', 'kod inceleme'],
    devops: ['deploy', 'production', 'release', 'ci', 'cd', 'docker', 'server', 'aws', 'cloud'],
    security: ['security', 'vulnerability', 'exploit', 'audit', 'pentest', 'aes', 'gcm', 'gÃ¼venlik', 'sql injection', 'xss', 'firewall', 'sandbox'],
    lead_architect: ['architecture', 'flow', 'design', 'structure', 'explain', 'diagram', 'pattern', 'hierarchy']
  };

  private trainingExamples: TrainingExample[] = [
    { text: 'JWT token doÄŸrulama aÃ§Ä±ÄŸÄ± var mÄ± kontrol et', label: 'security' },
    { text: 'Login sayfasÄ±ndaki buton rengini deÄŸiÅŸtir', label: 'frontend' },
    { text: 'PostgreSQL sorgusu yavaÅŸ, optimize et', label: 'backend' },
    { text: 'React component testlerini yaz', label: 'qa' },
    { text: 'Yeni kullanÄ±cÄ± kaydÄ± featureâ€™Ä±nÄ± deploy et', label: 'devops' },
    { text: 'API endpoint dÃ¶kÃ¼mantasyonu gÃ¼ncelle', label: 'lead_architect' },
    { text: 'GÃ¼venlik deÄŸil, sadece UI testi yap', label: 'qa' },
    { text: 'frontend bugâ€™Ä± deÄŸil backendâ€™deki null pointerâ€™Ä± dÃ¼zelt', label: 'backend' },
    { text: 'security analysis for the auth module', label: 'security' },
    { text: 'fix the css layout for mobile view', label: 'frontend' },
    { text: 'create a new database migration for users', label: 'backend' },
    { text: 'run full regression tests for the release', label: 'qa' },
    { text: 'setup github actions cd pipeline', label: 'devops' },
    { text: 'explain the encryption component hierarchy', label: 'lead_architect' },
    { text: 'how does the data flow between modules?', label: 'lead_architect' },
    { text: 'check for sql injection vulnerabilities', label: 'security' },
    { text: 'is there a cross-site scripting flaw?', label: 'security' },
    { text: 'GÃ¼venlik aÃ§Ä±ÄŸÄ± deÄŸil, sadece kod kalitesi analizi yap', label: 'qa' },
    { text: 'not a security audit, just refactoring and code review', label: 'qa' },
    { text: 'explain the encryption component hierarchy', label: 'lead_architect' }
  ];

  constructor() {
    this.classifier = new IntentClassifier();
    this.transformer = IntentTransformer.getInstance();
    this.initClassifier();
  }

  /**
   * Transformer modelini manuel olarak aktif eder (indirme gerekebilir).
   */
  public enableTransformer(): void {
    this.transformerEnabled = true;
  }

  private async initClassifier() {
    const modelPath = join(getConfigDir(), 'intent-model.json');
    try {
      const state = await fs.readFile(modelPath, 'utf-8');
      this.classifier = new IntentClassifier(JSON.parse(state));
    } catch {
      // First time or error: train from keywords + examples
      this.trainFromScratch();
      this.saveModel().catch(() => {});
    }
  }

  private trainFromScratch() {
    const examples: TrainingExample[] = [...this.trainingExamples];
    
    // Add examples from keywordMap
    for (const [label, keywords] of Object.entries(this.keywordMap)) {
      for (const kw of keywords) {
        examples.push({ text: kw, label });
      }
    }
    
    this.classifier.train(examples);
  }

  private async saveModel() {
    const modelPath = join(getConfigDir(), 'intent-model.json');
    const state = this.classifier.saveState();
    await fs.writeFile(modelPath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * KullanÄ±cÄ± prompt'unu analiz eder ve en uygun pipeline'Ä±/uzmanÄ± dÃ¶ner.
   */
  public async analyze(prompt: string): Promise<IntentResult> {
    const lowerPrompt = prompt.toLowerCase();
    const tags: string[] = [];
    
    // 1. Pipeline Belirleme
    let pipeline: PipelineType = PipelineType.NEW_FEATURE;
    if (lowerPrompt.includes('bug') || lowerPrompt.includes('hata') || lowerPrompt.includes('fix')) {
      pipeline = PipelineType.BUG_FIX;
    } else if (lowerPrompt.includes('refactor') || lowerPrompt.includes('dÃ¼zenle') || lowerPrompt.includes('optimize')) {
      pipeline = PipelineType.REFACTOR;
    } else if (lowerPrompt.includes('araÅŸtÄ±r') || lowerPrompt.includes('incele') || lowerPrompt.includes('research')) {
      pipeline = PipelineType.RESEARCH;
    }

    // 2. Uzman Belirleme (Hybrid: ML + Keyword)
    const mlResult = this.classifier.predict(lowerPrompt);
    const modelVersion = 'naive-bayes-v1.0';
    
    let bestSpecialist = 'lead_architect';
    let maxHits = 0;
    let method: 'ml' | 'hybrid' | 'fallback' = 'fallback';

    const featureImportance: Record<string, number> = {};

    // Check keyword hits for explanation and fallback
    for (const [specialist, keywords] of Object.entries(this.keywordMap)) {
      let currentScore = 0;
      const foundKeywords = keywords.filter(k => lowerPrompt.includes(k));
      
      if (foundKeywords.length > 0) {
        tags.push(...foundKeywords);
        for (const kw of foundKeywords) {
          // Weighted score: longer keywords are more significant
          const score = kw.length; 
          currentScore += score;
          featureImportance[kw] = (featureImportance[kw] || 0) + 1;
        }
      }
      
      if (currentScore > maxHits) {
        maxHits = currentScore;
        if (mlResult.confidence < 0.75) {
           bestSpecialist = specialist;
           method = 'fallback';
        }
      }
    }

    // High confidence ML takes precedence
    if (mlResult.confidence >= 0.75) {
      bestSpecialist = mlResult.prediction;
      method = 'ml';
    } else if (mlResult.confidence >= 0.45 && tags.length > 0) {
      // Hybrid: If ML matches a tag, use it
      if (this.keywordMap[mlResult.prediction as keyof typeof this.keywordMap]?.some(k => lowerPrompt.includes(k))) {
        bestSpecialist = mlResult.prediction;
        method = 'hybrid';
      }
    }

    // Sovereign AI Rule: Confidence thresholds: < 0.60 (Yellow Warning), < 0.40 (Red/Manual Entry)
    // We trigger fallback or deep-dive if confidence is below 0.6
    let confidence = Math.max(mlResult.confidence, maxHits > 0 ? 0.9 : 0.5);
    let fallbackTriggered = confidence < 0.60;
    let finalSpecialist = fallbackTriggered ? 'lead_architect' : bestSpecialist;

    // Phase 2: Deep Dive with Transformer (if enabled and low confidence)
    if (fallbackTriggered && this.transformerEnabled) {
      try {
        const transResult = await this.transformer.predict(prompt);
        if (transResult.confidence > 0.70) {
          finalSpecialist = transResult.prediction;
          confidence = transResult.confidence;
          fallbackTriggered = false;
          method = 'ml'; // Upgraded from fallback to ML
        }
      } catch (err) {
        // Silently fail and keep original fallback
      }
    }

    return {
      pipeline,
      specialist: finalSpecialist,
      prediction: finalSpecialist,
      confidence,
      feature_importance: featureImportance,
      model_version: modelVersion,
      fallback_triggered: fallbackTriggered,
      physics_override: false,
      tags: Array.from(new Set(tags)),
      method: fallbackTriggered ? 'fallback' : method
    };
  }
}
