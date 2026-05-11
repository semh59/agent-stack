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
exports.CausalInferenceEngine = void 0;
const fs = __importStar(require("node:fs/promises"));
/**
 * CausalInferenceEngine: Detects latent regressions by analyzing the timeline log.
 * Attributes current failures to past agent modifications.
 */
class CausalInferenceEngine {
    timelinePath;
    constructor(timelinePath) {
        this.timelinePath = timelinePath;
    }
    async analyzeFailure(failureEvent) {
        const events = await this.loadTimeline();
        const failureTime = new Date(failureEvent.timestamp).getTime();
        // Look for edits to the same components in the last 100 events
        const candidates = events
            .filter(e => new Date(e.timestamp).getTime() < failureTime)
            .filter(e => e.type === 'fs_change' || e.type === 'agent_action')
            .slice(-100);
        const links = [];
        const targetFiles = this.extractTargetFiles(failureEvent);
        for (const cause of candidates) {
            const causeFiles = this.extractTargetFiles(cause);
            const overlap = causeFiles.filter(f => targetFiles.includes(f));
            if (overlap.length > 0) {
                links.push({
                    cause,
                    effect: failureEvent,
                    confidence: this.calculateConfidence(cause, overlap),
                    reason: `Modified shared sectors: ${overlap.join(', ')}`
                });
            }
        }
        return links.sort((a, b) => b.confidence - a.confidence);
    }
    async loadTimeline() {
        try {
            const data = await fs.readFile(this.timelinePath, 'utf-8');
            return data.trim().split('\n').map(line => JSON.parse(line));
        }
        catch {
            return [];
        }
    }
    extractTargetFiles(event) {
        const data = event.data;
        if (event.type === 'fs_change' && typeof data?.path === 'string')
            return [data.path];
        if (event.type === 'terminal_output' && typeof data?.command === 'string') {
            // Simple heuristic: extract file names from test commands
            const matches = data.command.match(/[\w-]+\.\w+/g);
            return matches || [];
        }
        return [];
    }
    calculateConfidence(cause, overlap) {
        let score = 0.5;
        if (cause.role === 'architect' || cause.role === 'pm')
            score += 0.2;
        if (overlap.length > 2)
            score += 0.2;
        return Math.min(0.99, score);
    }
}
exports.CausalInferenceEngine = CausalInferenceEngine;
//# sourceMappingURL=CausalInferenceEngine.js.map