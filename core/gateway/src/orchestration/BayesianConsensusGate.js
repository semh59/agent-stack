"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BayesianConsensusGate = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
class BayesianConsensusGate {
    profiles = new Map();
    profilePath;
    constructor(projectRoot) {
        this.profilePath = path.resolve(projectRoot, '.ai-company', 'consensus_profiles.json');
        // Default weights
        this.profiles.set('gemini-1.5-pro', { id: 'gemini-1.5-pro', globalReliability: 0.92, specializedDomains: { 'logic': 0.95, 'creative': 0.88 } });
        this.profiles.set('gpt-4o', { id: 'gpt-4o', globalReliability: 0.94, specializedDomains: { 'logic': 0.98, 'documentation': 0.90 } });
        this.profiles.set('claude-3.5-sonnet', { id: 'claude-3.5-sonnet', globalReliability: 0.95, specializedDomains: { 'coding': 0.97, 'security': 0.94 } });
        void this.loadProfiles();
    }
    async loadProfiles() {
        try {
            const data = await fs.readFile(this.profilePath, 'utf-8');
            const loaded = JSON.parse(data);
            for (const [id, profile] of Object.entries(loaded)) {
                this.profiles.set(id, profile);
            }
        }
        catch {
            // Use defaults if file missing
        }
    }
    async saveProfiles() {
        try {
            const obj = Object.fromEntries(this.profiles);
            await fs.writeFile(this.profilePath, JSON.stringify(obj, null, 2));
        }
        catch (err) {
            console.error('[ConsensusGate] Failed to save profiles:', err);
        }
    }
    /**
     * calculateTruthScore: Computes the weighted probability of a "Pass" verdict.
     */
    calculateTruthScore(votes, domain = 'logic') {
        let weightedSum = 0;
        let totalWeight = 0;
        // BASELINE: The system itself has a baseline weight (p=0.5, weight=0.1) 
        // to prevent a single untrusted model from dominating if totalWeight is low.
        const baselineWeight = 0.2;
        weightedSum += 0.5 * baselineWeight;
        totalWeight += baselineWeight;
        for (const vote of votes) {
            const p = this.profiles.get(vote.modelId);
            const profile = p || { id: 'unknown', globalReliability: 0.5, specializedDomains: {} };
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
    updateReliability(modelId, result) {
        let profile = this.profiles.get(modelId);
        if (!profile) {
            profile = { id: modelId, globalReliability: 0.5, specializedDomains: {} };
            this.profiles.set(modelId, profile);
        }
        if (result === 'success') {
            profile.globalReliability = Math.min(0.99, profile.globalReliability + 0.1 * (1 - profile.globalReliability));
        }
        else {
            // Aggressive 50% drop on failure to neutralize liars quickly
            profile.globalReliability = Math.max(0.01, profile.globalReliability * 0.5);
        }
        void this.saveProfiles();
    }
}
exports.BayesianConsensusGate = BayesianConsensusGate;
//# sourceMappingURL=BayesianConsensusGate.js.map