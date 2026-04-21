import { EventBus } from './event-bus';

/**
 * RARV Phase constants.
 * The core cycle: Reason â†’ Act â†’ Reflect â†’ Verify
 */
export const RARVPhase = {
  REASON: 'reason',
  ACT: 'act',
  REFLECT: 'reflect',
  VERIFY: 'verify',
} as const;

export type RARVPhase = (typeof RARVPhase)[keyof typeof RARVPhase];

/**
 * Record of a single phase transition within a RARV cycle.
 */
export interface PhaseTransition {
  from: RARVPhase | null;
  to: RARVPhase;
  timestamp: string;
  input: string | boolean;
}

/**
 * The state of a single RARV cycle.
 */
export interface RARVState {
  phase: RARVPhase;
  taskId: number;
  agentId: number;
  data: {
    reasoning?: string;
    actionTaken?: string;
    reflection?: string;
    verificationResult?: boolean;
    errors?: string[];
  };
  phaseHistory: PhaseTransition[];
  startedAt: string;
  completedAt: string | null;
  refinementCount: number;
}

/**
 * Configuration for a RARV cycle.
 */
export interface RARVConfig {
  maxRefinements: number;
  phaseTimeoutMs: number;
}

const DEFAULT_RARV_CONFIG: RARVConfig = {
  maxRefinements: 3,
  phaseTimeoutMs: 120_000,
};

/**
 * Summary of a completed RARV cycle.
 */
export interface RARVSummary {
  taskId: number;
  agentId: number;
  success: boolean;
  totalPhases: number;
  refinementCount: number;
  durationMs: number;
  phases: PhaseTransition[];
}

/**
 * Aggregate metrics across all RARV cycles.
 */
export interface RARVMetrics {
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  averageRefinements: number;
  averageDurationMs: number;
}

/**
 * RARVEngine: Reason-Act-Reflect-Verify dÃ¶ngÃ¼sÃ¼nÃ¼ yÃ¶netir.
 */
export class RARVEngine {
  private bus = EventBus.getInstance();
  private config: RARVConfig;

  constructor(private memory?: any, config: Partial<RARVConfig> = {}) {
    this.config = { ...DEFAULT_RARV_CONFIG, ...config };
  }

  /**
   * Start a new RARV cycle for a given task/agent pair.
   */
  public async startCycle(taskId: number, agentId: number): Promise<RARVState> {
    const state: RARVState = {
      phase: RARVPhase.REASON,
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

    const transition: PhaseTransition = {
      from: null,
      to: RARVPhase.REASON,
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
  public async nextPhase(
    taskId: number,
    input: string | boolean,
  ): Promise<RARVState> {
    let state: RARVState;
    
    if (this.memory) {
      const memState = await this.memory.getState();
      state = memState.rarvState?.[taskId];
    } else {
        throw new Error("SharedMemory is required for persistent RARV operations.");
    }
    
    if (!state) throw new Error(`RARV state for Task ${taskId} not found.`);

    const oldPhase = state.phase;

    switch (state.phase) {
      case RARVPhase.REASON:
        state.data.reasoning = input as string;
        state.phase = RARVPhase.ACT;
        break;

      case RARVPhase.ACT:
        state.data.actionTaken = input as string;
        state.phase = RARVPhase.REFLECT;
        break;

      case RARVPhase.REFLECT:
        state.data.reflection = input as string;
        state.phase = RARVPhase.VERIFY;
        break;

      case RARVPhase.VERIFY: {
        const verified = !!input;
        state.data.verificationResult = verified;

        if (verified) {
          state.completedAt = new Date().toISOString();
          await this.bus.publish('rarv.cycle_completed', { taskId, success: true });
        } else if (state.refinementCount < this.config.maxRefinements) {
          state.refinementCount++;
          state.phase = RARVPhase.REFLECT;
          state.data.errors = state.data.errors ?? [];
          state.data.errors.push(`Verification failed (refinement ${state.refinementCount})`);
          await this.bus.publish('rarv.refinement_triggered', { taskId, refinementCount: state.refinementCount });
        } else {
          state.completedAt = new Date().toISOString();
          await this.bus.publish('rarv.cycle_completed', { taskId, success: false, reason: 'Max refinements exhausted' });
        }
        break;
      }
    }

    const transition: PhaseTransition = {
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
  public async finishCycle(taskId: number): Promise<void> {
    const state = await this.getState(taskId);
    if (state && !state.completedAt) {
      state.completedAt = new Date().toISOString();
      await this.recordSummary(state, false);
    } else if (state) {
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
  public async getState(taskId: number): Promise<RARVState | undefined> {
    if (this.memory) {
      const memState = await this.memory.getState();
      return memState.rarvState?.[taskId];
    }
    return undefined;
  }

  /**
   * Get aggregate metrics across all completed RARV cycles.
   */
  public async getMetrics(): Promise<RARVMetrics> {
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
  public async reset(): Promise<void> {
    if (this.memory) {
      await this.memory.updateState({ rarvState: {}, rarvMetrics: undefined });
    }
  }

  /**
   * Record a summary and update aggregate metrics.
   */
  private async recordSummary(state: RARVState, success: boolean): Promise<void> {
    if (!this.memory) return;

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
