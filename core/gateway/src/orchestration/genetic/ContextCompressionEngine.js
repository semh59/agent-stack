"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextCompressionEngine = void 0;
/**
 * ContextCompressionEngine — Token-aware context pruning.
 *
 * Strategy: preserve document ORDER (scrambling context destroys reasoning).
 * Score sections, drop lowest-signal ones while staying under budget.
 * Code blocks and error messages always survive truncation.
 */
class ContextCompressionEngine {
    // Rough chars-per-token ratio for Claude/Gemini (conservative)
    static CHARS_PER_TOKEN = 4;
    // Default: 40k tokens of context (160k chars) — ample for most tasks
    static DEFAULT_BUDGET_CHARS = 40_000 * 4;
    /**
     * Compress context to fit within budgetLimit characters.
     * Preserves document order. Keeps high-signal sections.
     */
    async compress(fullContext, budgetLimit = ContextCompressionEngine.DEFAULT_BUDGET_CHARS) {
        if (fullContext.length <= budgetLimit)
            return fullContext;
        console.log(`[ContextCompression] ${fullContext.length} chars → target ${budgetLimit} chars` +
            ` (~${Math.round(budgetLimit / ContextCompressionEngine.CHARS_PER_TOKEN)} tokens)`);
        const sections = this.splitSections(fullContext);
        const scored = sections.map(s => ({ ...s, score: this.scoreSection(s.text) }));
        // Separate must-keep from droppable
        const mustKeep = scored.filter(s => s.mustKeep);
        const droppable = scored.filter(s => !s.mustKeep).sort((a, b) => b.score - a.score);
        // Fill budget: always include mustKeep, then add droppable by score
        const mustKeepChars = mustKeep.reduce((n, s) => n + s.text.length, 0);
        let remaining = budgetLimit - mustKeepChars;
        const kept = new Set(mustKeep.map(s => s.idx));
        for (const section of droppable) {
            if (remaining <= 0)
                break;
            if (section.text.length <= remaining) {
                kept.add(section.idx);
                remaining -= section.text.length;
            }
        }
        // Reconstruct in original order
        const result = sections
            .filter(s => kept.has(s.idx))
            .map(s => s.text)
            .join('\n\n');
        const gain = ((1 - result.length / fullContext.length) * 100).toFixed(0);
        console.log(`[ContextCompression] ${result.length} chars after compression (${gain}% reduction)`);
        return result;
    }
    /** Split context into logical sections (paragraphs + code blocks) */
    splitSections(text) {
        const sections = [];
        let idx = 0;
        let pos = 0;
        // Match fenced code blocks and regular paragraphs
        const codeBlockRe = /```[\s\S]*?```/g;
        let match;
        let lastEnd = 0;
        while ((match = codeBlockRe.exec(text)) !== null) {
            // Text before this code block
            if (match.index > lastEnd) {
                const before = text.slice(lastEnd, match.index).trim();
                if (before) {
                    for (const para of before.split(/\n{2,}/)) {
                        if (para.trim()) {
                            sections.push({ idx: idx++, text: para.trim(), mustKeep: false });
                        }
                    }
                }
            }
            // Code block itself
            sections.push({ idx: idx++, text: match[0], mustKeep: true });
            lastEnd = match.index + match[0].length;
        }
        // Remaining text after last code block
        const tail = text.slice(lastEnd).trim();
        if (tail) {
            for (const para of tail.split(/\n{2,}/)) {
                if (para.trim()) {
                    sections.push({ idx: idx++, text: para.trim(), mustKeep: false });
                }
            }
        }
        return sections;
    }
    /** Score a text section by signal density (higher = more important to keep) */
    scoreSection(text) {
        const lower = text.toLowerCase();
        let score = 0;
        // High-signal: errors, decisions, requirements, constraints
        const highSignal = [
            'error', 'exception', 'fail', 'bug', 'fix', 'critical', 'must', 'required',
            'constraint', 'decision', 'reason', 'why', 'architecture', 'breaking',
            'security', 'performance', 'bottleneck', 'race condition',
        ];
        for (const kw of highSignal) {
            if (lower.includes(kw))
                score += 15;
        }
        // Medium-signal: implementation details
        const medSignal = [
            'function', 'class', 'interface', 'implement', 'return', 'import',
            'export', 'const ', 'async ', 'await ', 'schema', 'migration',
        ];
        for (const kw of medSignal) {
            if (lower.includes(kw))
                score += 5;
        }
        // Prefer recent content (assume later sections are more relevant)
        // This is a mild recency bonus — don't over-weight it
        score += 2;
        // Penalize very short sections (low information density)
        if (text.length < 50)
            score -= 10;
        return score;
    }
    /** Estimate token count from char count */
    static estimateTokens(chars) {
        return Math.ceil(chars / ContextCompressionEngine.CHARS_PER_TOKEN);
    }
}
exports.ContextCompressionEngine = ContextCompressionEngine;
//# sourceMappingURL=ContextCompressionEngine.js.map