import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * BayesianConsensusGate: Upgrades multi-model validation with weighted probabilistic truth scoring.
 */
export interface Vote {
  modelId: string;
  verdict: boolean;
  confidence: number; // 0 to 1
  reasoning: string;
}

export interface ModelProfile {
  id: string;
  globalReliability: number; // Historical success rate
  specializedDomains: Record<string, number>; // Domain-specific weights
}

export class BayesianConsensusGate {
  private profiles: Map<string, ModelProfile> = new Map();
  private profilePath: string;

  constructor(projectRoot: string) {
    this.profilePath = path.resolve(projectRoot, '.ai-company', 'consensus_profiles.json');
    
    // Default weights
    this.profiles.set('gemini-1.5-pro', { id: 'gemini-1.5-pro', globalReliability: 0.92, specializedDomains: { 'logic': 0.95, 'creative': 0.88 } });
    this.profiles.set('gpt-4o', { id: 'gpt-4o', globalReliability: 0.94, specializedDomains: { 'logic': 0.98, 'documentation': 0.90 } });
    this.profiles.set('claude-3.5-sonnet', { id: 'claude-3.5-sonnet', globalReliability: 0.95, specializedDomains: { 'coding': 0.97, 'security': 0.94 } });
  
    void this.loadProfiles();
  }

  private async loadProfiles(): Promise<void> {
    try {
      const data = await fs.readFile(this.profilePath, 'utf-8');
      const loaded = JSON.parse(data);
      for (const [id, profile] of Object.entries(loaded)) {
        this.profiles.set(id, profile as ModelProfile);
      }
    } catch {
      // Use defaults if file missing
    }
  }

  private async saveProfiles(): Promise<void> {
    try {
      const obj = Object.fromEntries(this.profiles);
      await fs.writeFile(this.profilePath, JSON.stringify(obj, null, 2));
    } catch (err) {
      console.error('[ConsensusGate] Failed to save profiles:', err);
    }
  }

  /**
   * calculateTruthScore: Computes the weighted probability of a "Pass" verdict.
   */
  public calculateTruthScore(votes: Vote[], domain: string = 'logic'): { score: number, consensus: boolean, meta: Record<string, unknown> } {
    let weightedSum = 0;
    let totalWeight = 0;

    // BASELINE: The system itself has a baseline weight (p=0.5, weight=0.1) 
    // to prevent a single untrusted model from dominating if totalWeight is low.
    const baselineWeight = 0.2;
    weightedSum += 0.5 * baselineWeight;
    totalWeight += baselineWeight;

    for (const vote of votes) {
      const p = this.profiles.get(vote.modelId);
      const profile = p || { id: 'unknown', globalReliability: 0.5, specializedDomains: {} as Record<string, number> };
      const weight = (profile.specializedDomains[domain] || profile.globalReliability) * vote.confidence;
      
      weightedSum += (vote.verdict ? 1 : 0) * weight;
      totalWeight += weight;
    }

    const finalScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
    
    return {
      score: finalScore,
      consensus: finalScore > 0.75,
      meta: {
        totalVotes: votes.length,
        agreement: votes.filter(v => v.verdict).length / (votes.length || 1),
        systemConfidence: totalWeight
      }
    };
  }

  public updateReliability(modelId: string, result: 'success' | 'failure'): void {
    let profile = this.profiles.get(modelId);
    if (!profile) {
      profile = { id: modelId, globalReliability: 0.5, specializedDomains: {} };
      this.profiles.set(modelId, profile);
    }

    if (result === 'success') {
      profile.globalReliability = Math.min(0.99, profile.globalReliability + 0.1 * (1 - profile.globalReliability));
    } else {
      // Aggressive 50% drop on failure to neutralize liars quickly
      profile.globalReliability = Math.max(0.01, profile.globalReliability * 0.5);
    }
    
    void this.saveProfiles();
  }
}
