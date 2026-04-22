/**
 * ContextCompressionEngine: The Signal-to-Noise Optimizer.
 * Prunes irrelevant context to maximize token-density and reasoning quality.
 */
export class ContextCompressionEngine {
  /**
   * compress: Implements Attention-Aware Sharding conceptually.
   */
  public async compress(fullContext: string, budgetLimit: number = 4000): Promise<string> {
    console.log(`[ContextCompression] Original Context Size: ${fullContext.length} chars.`);

    if (fullContext.length <= budgetLimit) {
      return fullContext;
    }

    // Logic: Split by lines and rank by entropy (Signal keywords)
    const lines = fullContext.split('\n');
    const signalKeywords = ['error', 'fix', 'feat', 'logic', 'critical', 'reason', 'decision'];

    const rankedLines = lines.map(line => {
      const entropy = signalKeywords.reduce((count, key) => count + (line.toLowerCase().includes(key) ? 10 : 0), 0);
      return { line, entropy };
    });

    // Sort by entropy and select the top lines within the budget
    const compressed = rankedLines
      .sort((a, b) => b.entropy - a.entropy)
      .slice(0, Math.floor(budgetLimit / 50)) // Rough estimation
      .map(entry => entry.line)
      .join('\n');

    console.log(`[ContextCompression] Compressed Context Size: ${compressed.length} chars. Efficiency Gain: ${((1 - compressed.length/fullContext.length)*100).toFixed(0)}%`);
    
    return compressed;
  }
}
