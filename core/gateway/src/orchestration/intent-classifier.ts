export interface TrainingExample {
  text: string;
  label: string;
}

export interface ClassifierState {
  version: number;
  vocabulary: string[];
  classDocsCount: Record<string, number>;
  classWordCounts: Record<string, Record<string, number>>;
  totalDocs: number;
}

export class IntentClassifier {
  private vocabulary: Set<string> = new Set();
  private classDocsCount: Map<string, number> = new Map();
  private classWordCounts: Map<string, Map<string, number>> = new Map();
  private totalDocs: number = 0;

  constructor(state?: ClassifierState) {
    if (state) {
      this.loadState(state);
    }
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\sĞ°-ÑÄŸÃ¼ÅŸÄ±Ã¶Ã§]/gi, '') // Support basic Turkish characters
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  train(examples: TrainingExample[]): void {
    for (const example of examples) {
      const tokens = this.tokenize(example.text);
      const label = example.label;

      this.totalDocs++;
      this.classDocsCount.set(label, (this.classDocsCount.get(label) || 0) + 1);

      if (!this.classWordCounts.has(label)) {
        this.classWordCounts.set(label, new Map());
      }
      const wordCounts = this.classWordCounts.get(label)!;

      for (const token of tokens) {
        this.vocabulary.add(token);
        wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
      }
    }
  }

  predict(text: string): { 
    prediction: string; 
    confidence: number; 
    feature_importance: Record<string, number>;
    model_version: string;
    fallback_triggered: boolean;
    physics_override: boolean;
  } {
    const tokens = this.tokenize(text);
    if (this.totalDocs === 0 || tokens.length === 0) {
      return { 
        prediction: 'lead_architect', 
        confidence: 0,
        feature_importance: {},
        model_version: 'intent-v1',
        fallback_triggered: false,
        physics_override: false
      };
    }

    let bestLabel = 'lead_architect';
    let maxLogProb = -Infinity;
    const scores: Record<string, number> = {};
    const feature_importance: Record<string, number> = {};

    for (const label of this.classDocsCount.keys()) {
      let logProb = Math.log(this.classDocsCount.get(label)! / this.totalDocs);
      const wordCounts = this.classWordCounts.get(label)!;
      const totalWordsInClass = Array.from(wordCounts.values()).reduce((a, b) => a + b, 0);

      for (const token of tokens) {
        const wordCount = wordCounts.get(token) || 0;
        const wordWeight = (wordCount + 1) / (totalWordsInClass + this.vocabulary.size);
        logProb += Math.log(wordWeight);
        
        // Simple feature importance based on word weight
        feature_importance[token] = (feature_importance[token] || 0) + wordWeight;
      }

      scores[label] = logProb;
      if (logProb > maxLogProb) {
        maxLogProb = logProb;
        bestLabel = label;
      }
    }

    const exponents = Object.values(scores).map(s => Math.exp(s - maxLogProb));
    const totalExp = exponents.reduce((a, b) => a + b, 0);
    const confidence = Math.exp(scores[bestLabel]! - maxLogProb) / totalExp;

    return { 
      prediction: bestLabel, 
      confidence,
      feature_importance,
      model_version: 'intent-v1',
      fallback_triggered: false,
      physics_override: false
    };
  }

  saveState(): ClassifierState {
    const classWordCountsRecord: Record<string, Record<string, number>> = {};
    for (const [label, counts] of this.classWordCounts) {
      classWordCountsRecord[label] = Object.fromEntries(counts);
    }

    return {
      version: 1,
      vocabulary: Array.from(this.vocabulary),
      classDocsCount: Object.fromEntries(this.classDocsCount),
      classWordCounts: classWordCountsRecord,
      totalDocs: this.totalDocs
    };
  }

  private loadState(state: ClassifierState): void {
    this.vocabulary = new Set(state.vocabulary);
    this.classDocsCount = new Map(Object.entries(state.classDocsCount));
    this.totalDocs = state.totalDocs;

    this.classWordCounts = new Map();
    for (const [label, counts] of Object.entries(state.classWordCounts)) {
      this.classWordCounts.set(label, new Map(Object.entries(counts)));
    }
  }
}
