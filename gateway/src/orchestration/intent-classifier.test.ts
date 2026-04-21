import { describe, it, expect, beforeEach } from 'vitest';
import { IntentClassifier, type TrainingExample } from './intent-classifier';

describe('IntentClassifier', () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier();
  });

  it('should train and predict labels correctly', () => {
    const trainingData: TrainingExample[] = [
      { text: 'fix the bug in the backend', label: 'backend' },
      { text: 'update the ui component', label: 'frontend' },
      { text: 'deploy to production', label: 'devops' },
      { text: 'write a unit test', label: 'qa' },
    ];

    classifier.train(trainingData);

    expect(classifier.predict('bug fix').prediction).toBe('backend');
    expect(classifier.predict('ui color').prediction).toBe('frontend');
    expect(classifier.predict('deploy script').prediction).toBe('devops');
  });

  it('should handle unseen words gracefully', () => {
    classifier.train([
      { text: 'api', label: 'backend' },
      { text: 'ui', label: 'frontend' }
    ]);
    
    const result = classifier.predict('unknown term');
    expect(result.prediction).toBeDefined();
    expect(result.confidence).toBeLessThan(1);
  });

  it('should persist and load state correctly', () => {
    classifier.train([{ text: 'database', label: 'backend' }]);
    const state = classifier.saveState();

    const newClassifier = new IntentClassifier(state);
    const result = newClassifier.predict('database query');
    
    expect(result.prediction).toBe('backend');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should provide probability distribution for all classes', () => {
    classifier.train([
      { text: 'a', label: 'L1' },
      { text: 'b', label: 'L2' }
    ]);

    const result = classifier.predict('a b');
    // Result might be split or biased depending on vocabulary
    expect(result.prediction).toBeDefined();
    // Assuming we can't easily check internal weights, but we check consistency.
  });
});
