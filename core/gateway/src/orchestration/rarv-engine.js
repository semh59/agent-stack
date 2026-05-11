"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RARVEngine = exports.RARVPhase = void 0;
const event_bus_1 = require("./event-bus");
/**
 * RARV Phase constants.
 * The core cycle: Reason â†’ Act â†’ Reflect â†’ Verify
 */
exports.RARVPhase = {
    REASON: 'reason',
    ACT: 'act',
    REFLECT: 'reflect',
    VERIFY: 'verify',
};
const DEFAULT_RARV_CONFIG = {
    maxRefinements: 3,
    phaseTimeoutMs: 120_000,
};
/**
 * RARVEngine: Reason-Act-Reflect-Verify dÃ¶ngÃ¼sÃ¼nÃ¼ yÃ¶netir.
 */
class RARVEngine {
    memory;
    bus = event_bus_1.EventBus.getInstance();
    config;
    constructor(memory, config = {}) {
        this.memory = memory;
        this.config = { ...DEFAULT_RARV_CONFIG, ...config };
    }
    /**
     * Start a new RARV cycle for a given task/agent pair.
     */
    async startCycle(taskId, agentId) {
        const state = {
            phase: exports.RARVPhase.REASON,
            taskId,
            agentId,
            data: {},
            phaseHistory: [],
            startedAt: new Date().toISOString(),
            completedAt: null,
            refinementCount: 0,
        };
        if (this.memory) {
            const current = (await this.memory.getState()).rarvState || {};
            current[taskId] = state;
            await this.memory.updateState({ rarvState: current });
        }
        const transition = {
            from: null,
            to: exports.RARVPhase.REASON,
            timestamp: new Date().toISOString(),
            input: 'cycle_start',
        };
        state.phaseHistory.push(transition);
        await this.bus.publish('rarv.cycle_started', { taskId, agentId });
        console.log(`[RARV] Cycle started for Task ${taskId} by Agent ${agentId}`);
        return state;
    }
    /**
     * Complete the current phase and advance to the next one.
     */
    async nextPhase(taskId, input) {
        let state;
        if (this.memory) {
            const memState = await this.memory.getState();
            state = memState.rarvState?.[taskId];
        }
        else {
            throw new Error("SharedMemory is required for persistent RARV operations.");
        }
        if (!state)
            throw new Error(`RARV state for Task ${taskId} not found.`);
        const oldPhase = state.phase;
        switch (state.phase) {
            case exports.RARVPhase.REASON:
                state.data.reasoning = input;
                state.phase = exports.RARVPhase.ACT;
                break;
            case exports.RARVPhase.ACT:
                state.data.actionTaken = input;
                state.phase = exports.RARVPhase.REFLECT;
                break;
            case exports.RARVPhase.REFLECT:
                state.data.reflection = input;
                state.phase = exports.RARVPhase.VERIFY;
                break;
            case exports.RARVPhase.VERIFY: {
                const verified = !!input;
                state.data.verificationResult = verified;
                if (verified) {
                    state.completedAt = new Date().toISOString();
                    await this.bus.publish('rarv.cycle_completed', { taskId, success: true });
                }
                else if (state.refinementCount < this.config.maxRefinements) {
                    state.refinementCount++;
                    state.phase = exports.RARVPhase.REFLECT;
                    state.data.errors = state.data.errors ?? [];
                    state.data.errors.push(`Verification failed (refinement ${state.refinementCount})`);
                    await this.bus.publish('rarv.refinement_triggered', { taskId, refinementCount: state.refinementCount });
                }
                else {
                    state.completedAt = new Date().toISOString();
                    await this.bus.publish('rarv.cycle_completed', { taskId, success: false, reason: 'Max refinements exhausted' });
                }
                break;
            }
        }
        const transition = {
            from: oldPhase,
            to: state.phase,
            timestamp: new Date().toISOString(),
            input,
        };
        state.phaseHistory.push(transition);
        if (this.memory) {
            const current = (await this.memory.getState()).rarvState || {};
            current[taskId] = state;
            await this.memory.updateState({ rarvState: current });
        }
        await this.bus.publish('rarv.phase_changed', { taskId, from: oldPhase, to: state.phase });
        return state;
    }
    /**
     * Force-finish a cycle and clean up its state.
     */
    async finishCycle(taskId) {
        const state = await this.getState(taskId);
        if (state && !state.completedAt) {
            state.completedAt = new Date().toISOString();
            await this.recordSummary(state, false);
        }
        else if (state) {
            await this.recordSummary(state, state.data.verificationResult ?? false);
        }
        if (this.memory) {
            const memState = await this.memory.getState();
            const current = memState.rarvState || {};
            delete current[taskId];
            await this.memory.updateState({ rarvState: current });
        }
    }
    /**
     * Get the current state of a cycle.
     */
    async getState(taskId) {
        if (this.memory) {
            const memState = await this.memory.getState();
            return memState.rarvState?.[taskId];
        }
        return undefined;
    }
    /**
     * Get aggregate metrics across all completed RARV cycles.
     */
    async getMetrics() {
        if (this.memory) {
            const memState = await this.memory.getState();
            return memState.rarvMetrics || {
                totalCycles: 0,
                successfulCycles: 0,
                failedCycles: 0,
                averageRefinements: 0,
                averageDurationMs: 0,
            };
        }
        return { totalCycles: 0, successfulCycles: 0, failedCycles: 0, averageRefinements: 0, averageDurationMs: 0 };
    }
    /**
     * Reset all persisted state.
     */
    async reset() {
        if (this.memory) {
            await this.memory.updateState({ rarvState: {}, rarvMetrics: undefined });
        }
    }
    /**
     * Record a summary and update aggregate metrics.
     */
    async recordSummary(state, success) {
        if (!this.memory)
            return;
        const startMs = new Date(state.startedAt).getTime();
        const endMs = state.completedAt ? new Date(state.completedAt).getTime() : Date.now();
        const durationMs = endMs - startMs;
        const memState = await this.memory.getState();
        const metrics = memState.rarvMetrics || {
            totalCycles: 0,
            successfulCycles: 0,
            failedCycles: 0,
            averageRefinements: 0,
            averageDurationMs: 0,
        };
        const newTotal = metrics.totalCycles + 1;
        metrics.successfulCycles += success ? 1 : 0;
        metrics.failedCycles += success ? 0 : 1;
        metrics.averageRefinements = (metrics.averageRefinements * metrics.totalCycles + state.refinementCount) / newTotal;
        metrics.averageDurationMs = (metrics.averageDurationMs * metrics.totalCycles + durationMs) / newTotal;
        metrics.totalCycles = newTotal;
        await this.memory.updateState({ rarvMetrics: metrics });
    }
}
exports.RARVEngine = RARVEngine;
//# sourceMappingURL=rarv-engine.js.map