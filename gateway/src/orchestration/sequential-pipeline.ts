import * as fs from 'node:fs/promises';
import path from 'node:path';
import AsyncLock from 'async-lock';
import { AGENTS, getNextAgent, type AgentDefinition, AgentLayer } from './agents';
import { SharedMemory, type PipelineState } from './shared-memory';
import { RARVEngine } from './rarv-engine';
import { SkillMapper } from './skill-mapper';
import { TerminalExecutor, type CommandResult } from './terminal-executor';
import { SkillGenerator } from './skill-generator';
import { AlloyGatewayClient } from './gateway-client';
import { VerificationEngine, type VerificationResult, type CommandVerificationResult } from './verification-engine';
import { CheckpointManager } from './checkpoint-manager';
import { AGENT_SCHEMAS, sanitizeOutput } from './schemas';
import { eventBus } from './event-bus';
import type { IToolExecutionEngine } from './tool-execution-engine';
import type { PipelineOptimizer } from '../gateway/pipeline-optimizer';

/**
 * Plan modes: control which agents run.
 */
export const PlanMode = {
  FULL: 'full',
  MANAGEMENT_ONLY: 'management_only',
  DEV_ONLY: 'dev_only',
  QUALITY_ONLY: 'quality_only',
  CUSTOM: 'custom',
} as const;

export type PlanMode = (typeof PlanMode)[keyof typeof PlanMode];

/** Map plan modes to agent order ranges. */
const PLAN_MODE_RANGES: Record<string, { start: number; end: number }> = {
  full: { start: 1, end: 18 },
  management_only: { start: 1, end: 3 },
  dev_only: { start: 7, end: 10 },
  quality_only: { start: 11, end: 15 },
  custom: { start: 1, end: 18 },
};

/**
 * Error categories for structured error handling.
 */
export type ErrorCategory =
  | 'network'
  | 'timeout'
  | 'validation'
  | 'llm_error'
  | 'rate_limit'
  | 'auth'
  | 'unknown';

/**
 * Token usage tracking per agent.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/**
 * Circuit breaker state for a single LLM provider.
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureAt: number | null;
  isOpen: boolean;
  nextRetryAt: number;
}

/**
 * Pipeline execution options.
 */
export interface PipelineOptions {
  skipAgents?: string[];
  startFromOrder?: number;
  planMode?: PlanMode;
  modelOverride?: string;
  skillsDir?: string;
  extraSkills?: string[];
  autoVerify?: boolean;
  generateSkills?: boolean;
  onAgentStart?: (agent: AgentDefinition) => void | Promise<void>;
  onAgentComplete?: (agent: AgentDefinition, output: string) => void | Promise<void>;
  onError?: (agent: AgentDefinition, error: Error) => void | Promise<void>;
  onVerify?: (agent: AgentDefinition, result: CommandVerificationResult) => void | Promise<void>;
  onRarvPhase?: (phase: string) => void | Promise<void>;
  onHalt?: (agent: AgentDefinition, reason: string) => void | Promise<void>;
  force?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Result of a single agent execution.
 */
export interface AgentResult {
  agent: AgentDefinition;
  status: 'completed' | 'skipped' | 'failed' | 'halted';
  durationMs: number;
  outputFile: string | null;
  error?: string;
  verification?: VerificationResult;
  tokenUsage?: TokenUsage;
  attempts?: number;
}

/**
 * Result of the full pipeline run.
 */
export interface PipelineResult {
  status: 'completed' | 'failed' | 'paused' | 'halted';
  agentResults: AgentResult[];
  totalDurationMs: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  haltedCount: number;
  totalTokenUsage?: TokenUsage;
  totalEstimatedCostUsd?: number;
}

/**
 * SequentialPipeline â€” The core orchestration engine for Alloy AI.
 * Coordinates 18 agents in a staged, bulletproof flow.
 */
export class SequentialPipeline {
  private memory: SharedMemory;
  private rarv: RARVEngine;
  private skillMapper: SkillMapper | null = null;
  private terminal: TerminalExecutor;
  private verifier: VerificationEngine;
  private skillGenerator: SkillGenerator;
  private toolEngine: IToolExecutionEngine | null = null;
  private checkpointManager: CheckpointManager;
  private projectRoot: string;
  private paused: boolean = false;
  private running: boolean = false;
  private abortController: AbortController | null = null;
  private alloyClient?: AlloyGatewayClient;
  private temperature: number = 0.2;
  private maxOutputTokens: number = 4096;
  private sessionId: string;
  private checkpointIds: Map<string, string> = new Map();
  private backtrackLock = new AsyncLock();

  private isDisposed = false;
  private pipelineOptimizer: PipelineOptimizer | null = null;

  // Token & cost tracking
  private cumulativeTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

  // Circuit breaker per provider
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();

  private rarvListeners: Set<(phase: string) => void | Promise<void>> = new Set();
  private agentStartListeners: Set<(agent: AgentDefinition) => void | Promise<void>> = new Set();
  private agentCompleteListeners: Set<(agent: AgentDefinition, output: string) => void | Promise<void>> = new Set();
  private errorListeners: Set<(agent: AgentDefinition, error: Error) => void | Promise<void>> = new Set();
  private verifyListeners: Set<(agent: AgentDefinition, result: CommandVerificationResult) => void | Promise<void>> = new Set();

  constructor(projectRoot: string, alloyClient?: AlloyGatewayClient, overrides: { memory?: SharedMemory, terminal?: TerminalExecutor, toolEngine?: IToolExecutionEngine, optimizer?: PipelineOptimizer } = {}) {
    this.projectRoot = projectRoot;
    this.alloyClient = alloyClient;
    this.memory = overrides.memory ?? new SharedMemory(projectRoot);
    this.rarv = new RARVEngine(this.memory);
    this.terminal = overrides.terminal ?? new TerminalExecutor(projectRoot);
    this.verifier = new VerificationEngine(this.terminal);
    this.skillGenerator = new SkillGenerator(projectRoot);
    this.toolEngine = overrides.toolEngine ?? null;
    this.checkpointManager = new CheckpointManager(projectRoot, this.terminal);
    this.pipelineOptimizer = overrides.optimizer ?? null;
    this.sessionId = Math.random().toString(36).slice(2, 10);
  }

  public dispose() {
    this.isDisposed = true;
    this.running = false;
    this.abortController?.abort();
    this.rarvListeners.clear();
    this.agentStartListeners.clear();
    this.agentCompleteListeners.clear();
    this.errorListeners.clear();
    this.verifyListeners.clear();
  }

  public async init(): Promise<void> {
    await this.memory.init();
  }

  public isRunning(): boolean { return this.running; }
  public getMemory(): SharedMemory { return this.memory; }

  // Event Listeners
  public onRarvPhase(cb: (phase: string) => void | Promise<void>) { this.rarvListeners.add(cb); return { dispose: () => this.rarvListeners.delete(cb) }; }
  public onAgentStart(cb: (agent: AgentDefinition) => void | Promise<void>) { this.agentStartListeners.add(cb); return { dispose: () => this.agentStartListeners.delete(cb) }; }
  public onAgentComplete(cb: (agent: AgentDefinition, output: string) => void | Promise<void>) { this.agentCompleteListeners.add(cb); return { dispose: () => this.agentCompleteListeners.delete(cb) }; }
  public onVerify(cb: (agent: AgentDefinition, result: CommandVerificationResult) => void | Promise<void>) { this.verifyListeners.add(cb); return { dispose: () => this.verifyListeners.delete(cb) }; }
  public onError(cb: (agent: AgentDefinition, error: Error) => void | Promise<void>) { this.errorListeners.add(cb); return { dispose: () => this.errorListeners.delete(cb) }; }

  private async _emitAgentStart(agent: AgentDefinition, options: PipelineOptions) {
    await Promise.all(Array.from(this.agentStartListeners).map(async cb => { try { await cb(agent); } catch (e) { console.error(e); } }));
    await options.onAgentStart?.(agent);
    eventBus.publish('agent_start', { agent });
  }

  private async _emitAgentComplete(agent: AgentDefinition, output: string, options: PipelineOptions) {
    await Promise.all(Array.from(this.agentCompleteListeners).map(async cb => { try { await cb(agent, output); } catch (e) { console.error(e); } }));
    await options.onAgentComplete?.(agent, output);
    eventBus.publish('agent_complete', { agent, output: output.slice(0, 1000) });
  }

  private async _emitRarvPhase(phase: string, options: PipelineOptions) {
    await Promise.all(Array.from(this.rarvListeners).map(async cb => { try { await cb(phase); } catch (e) { console.error(e); } }));
    await options.onRarvPhase?.(phase);
    eventBus.publish('rarv_phase', { phase });
  }

  private async _emitVerify(agent: AgentDefinition, result: CommandVerificationResult, options: PipelineOptions) {
    await Promise.all(Array.from(this.verifyListeners).map(async cb => { try { await cb(agent, result); } catch (e) { console.error(e); } }));
    await options.onVerify?.(agent, result);
    eventBus.publish('verify', { agent, result });
  }

  private async _emitError(agent: AgentDefinition, error: Error, options: PipelineOptions) {
    await Promise.all(Array.from(this.errorListeners).map(async cb => { try { await cb(agent, error); } catch (e) { console.error(e); } }));
    await options.onError?.(agent, error);
    eventBus.publish('error', { agent, error: error.message });
  }

  public async start(userTask: string, options: PipelineOptions = {}): Promise<PipelineResult> {
    await this.init();
    const currentState = await this.memory.getState();
    if (currentState.pipelineStatus === 'running' && !options.force) {
      throw new Error(`Pipeline is already running (started at ${currentState.startedAt}). Use "force" to override.`);
    }

    this.paused = false;
    this.running = true;
    this.abortController = new AbortController();
    this.temperature = options.temperature ?? 0.2;
    this.maxOutputTokens = options.maxOutputTokens ?? 4096;
    this.cumulativeTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

    if (options.skillsDir) {
      this.skillMapper = new SkillMapper(options.skillsDir);
    }

    const startTime = Date.now();
    const skipSet = new Set(options.skipAgents ?? []);
    const agentResults: AgentResult[] = [];

    const planMode = options.planMode ?? PlanMode.FULL;
    const range = PLAN_MODE_RANGES[planMode]!;
    const startOrder = options.startFromOrder ?? range.start;
    const endOrder = range.end;

    await this.memory.updateState({
      userTask,
      pipelineStatus: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
    });

    const allAgentsToRun = AGENTS.filter(a => a.order >= startOrder && a.order <= endOrder);
    const stages = this.groupIntoStages(allAgentsToRun);
    let stageIndex = 0;

    while (stageIndex < stages.length) {
      this.abortController.signal.throwIfAborted();
      const stage = stages[stageIndex]!;
      
      if (this.paused) {
        await this.memory.updateState({ pipelineStatus: 'paused', currentAgent: null });
        await this.saveWorkflow(agentResults, stages, stageIndex);
        this.running = false;
        return this.buildResult(agentResults, startTime, 'paused');
      }

      const state = await this.memory.getState();
      const agentsToExecute = stage.filter(a => !state.completedAgents.includes(a.role) && !skipSet.has(a.role));

      for (const agent of stage) {
        if (skipSet.has(agent.role)) {
          agentResults.push({ agent, status: 'skipped', durationMs: 0, outputFile: null });
        }
      }

      if (agentsToExecute.length === 0) {
        stageIndex++;
        continue;
      }

      // Use allSettled for robust parallel execution
      const settled = await Promise.allSettled(agentsToExecute.map(agent => 
        this.executeAgentWithRetry(agent, userTask, options, allAgentsToRun, agentResults)
      ));

      // Process settled results
      const results = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value;
        // Rejected â€” treat as failed
        const agent = agentsToExecute[i]!;
        const failResult: AgentResult = { agent, status: 'failed', durationMs: 0, outputFile: null, error: s.reason?.message ?? 'Unknown error' };
        agentResults.push(failResult);
        return { status: 'failed' as const, result: failResult };
      });

      const halt = results.find(r => r.status === 'halted');
      if (halt) return this.handleHalt(halt.result!.agent, halt.result!, startTime, agentResults, options);

      const backtrack = results.find(r => r.backtrack);
      if (backtrack) {
        const { targetAgent } = backtrack.backtrack!;
        const targetStageIndex = stages.findIndex(s => s.some(a => a.role === targetAgent.role));
        if (targetStageIndex !== -1) {
          stageIndex = targetStageIndex;
          continue;
        }
      }

      const fail = results.find(r => r.status === 'failed');
      if (fail) return this.handleFailure(fail.result!.agent, fail.result!, startTime, agentResults);

      stageIndex++;
    }

    if (options.autoVerify !== false) await this.autoVerifyPipeline(options);
    if (options.generateSkills !== false) await this.skillGenerator.generateProposals(this.memory).catch(() => []);

    await this.memory.updateState({
      pipelineStatus: 'completed',
      currentAgent: null,
      completedAt: new Date().toISOString(),
    });

    // Prune old checkpoints on successful completion
    await this.checkpointManager.pruneOldCheckpoints().catch(() => {});

    this.running = false;
    return this.buildResult(agentResults, startTime, 'completed');
  }

  private async executeAgentWithRetry(
    agent: AgentDefinition,
    userTask: string,
    options: PipelineOptions,
    agentsToRun: AgentDefinition[],
    agentResults: AgentResult[]
  ): Promise<{ status: AgentResult['status']; result?: AgentResult; backtrack?: { targetIndex: number; targetAgent: AgentDefinition } }> {
    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 1000;
    let lastResult: AgentResult | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await this.executeAgent(agent, userTask, options);
      lastResult = result;

      if (result.status === 'completed') {
        agentResults.push(result);
        return { status: 'completed', result };
      }

      if (result.status === 'halted') return { status: 'halted', result };

      // Exponential backoff before retry
      if (attempt < MAX_ATTEMPTS) {
        const errorCat = this.categorizeError(new Error(result.error ?? 'unknown'));
        // Longer backoff for rate limits
        const multiplier = errorCat === 'rate_limit' ? 4 : 1;
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1) * multiplier;
        console.log(`[Alloy:Pipeline] Retry ${attempt}/${MAX_ATTEMPTS} for ${agent.role} in ${delayMs}ms (category: ${errorCat})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      if (attempt === MAX_ATTEMPTS) {
        const curIdx = agentsToRun.findIndex(a => a.role === agent.role);
        const target = await this.findBacktrackTarget(agent, agentsToRun, curIdx);
        if (target) {
          const { targetAgent } = target;
          return await this.backtrackLock.acquire('backtrack', async (): Promise<{ status: AgentResult['status']; result: AgentResult; backtrack?: { targetIndex: number; targetAgent: AgentDefinition } }> => {
            // Re-verify if we still need to backtrack (idempotency)
            const freshResults = agentResults.filter(r => r.agent.order >= targetAgent.order);
            if (freshResults.length === 0 && attempt === MAX_ATTEMPTS) {
               // Already backtracked or handled by another worker
               return { status: 'failed', result: lastResult! };
            }

            await this.recordBacktrack(agent.role, targetAgent.role, result.error ?? 'Max retries exceeded');
            for (let i = agentResults.length - 1; i >= 0; i--) {
              if (agentResults[i]!.agent.order >= targetAgent.order) agentResults.splice(i, 1);
            }
            const checkpointId = this.checkpointIds.get(targetAgent.role);
            if (checkpointId) await this.checkpointManager.rollback(checkpointId);
            return { status: 'failed', result, backtrack: target };
          });
        }
      }
    }
    return { status: 'failed', result: lastResult };
  }

  private async executeAgent(agent: AgentDefinition, userTask: string, options: PipelineOptions): Promise<AgentResult> {
    const start = Date.now();
    this.abortController?.signal.throwIfAborted();

    if (agent.layer === AgentLayer.DEVELOPMENT || agent.layer === AgentLayer.DESIGN) {
      const cid = await this.checkpointManager.createCheckpoint(`${this.sessionId}_pre_${agent.role}`);
      this.checkpointIds.set(agent.role, cid);
    }

    try {
      await this._emitAgentStart(agent, options);
      await this.memory.updateState({ currentAgent: agent.role });
      await this.rarv.startCycle(agent.order, agent.order);
      
      const context = await this.gatherAgentContext(agent, userTask);
      let prompt = await this.buildAgentPrompt(agent, context, userTask, options);

      let model = options.modelOverride ?? agent.preferredModel;
      let llmOutput: string;
      let tokenUsage: TokenUsage | undefined;

      if (this.pipelineOptimizer) {
        const opt = await this.pipelineOptimizer.optimize(agent, prompt);
        model = opt.model.id;
        if (opt.cacheHit && opt.cachedResponse) {
          llmOutput = opt.cachedResponse;
        } else {
          const llmResult = await this.executeLlmCallWithTimeout(agent, opt.optimizedPrompt ?? prompt, userTask, model);
          llmOutput = llmResult.output;
          tokenUsage = llmResult.tokenUsage;
        }
      } else {
        const llmResult = await this.executeLlmCallWithTimeout(agent, prompt, userTask, model);
        llmOutput = llmResult.output;
        tokenUsage = llmResult.tokenUsage;
      }

      // Accumulate token usage
      if (tokenUsage) {
        this.cumulativeTokens.promptTokens += tokenUsage.promptTokens;
        this.cumulativeTokens.completionTokens += tokenUsage.completionTokens;
        this.cumulativeTokens.totalTokens += tokenUsage.totalTokens;
        this.cumulativeTokens.estimatedCostUsd += tokenUsage.estimatedCostUsd;
      }

      await this._emitRarvPhase(`VERIFY for ${agent.role}`, options);
      const defaultFile = agent.outputFiles[0] ?? `${agent.role}-output.md`;
      
      // Use improved sanitizeOutput from schemas.ts
      const schemaResult = sanitizeOutput(agent.role, llmOutput);
      if (!schemaResult.success) {
        console.warn(`[Alloy:Pipeline] Schema validation warning for ${agent.role}: ${schemaResult.errors?.join(', ') ?? 'unknown'}`);
      }

      const written = await this.memory.writeAgentOutput(agent.role, defaultFile, llmOutput);
      const verifyResult = await this.verifier.verify(agent, llmOutput);
      for (const cmd of verifyResult.commands) await this._emitVerify(agent, cmd, options);
      
      const state = await this.memory.getState();
      const vResults = state.verificationResults ?? {};
      vResults[agent.role] = { passed: verifyResult.passed, commands: verifyResult.commands.map(c => `${c.command}: ${c.passed ? 'OK' : 'FAIL'}`), timestamp: verifyResult.timestamp };
      
      const metrics = state.agentMetrics ?? {};
      const m = metrics[agent.role] ?? { attempts: 0, totalDurationMs: 0, verificationPassed: false };
      metrics[agent.role] = { attempts: m.attempts + 1, totalDurationMs: m.totalDurationMs + (Date.now() - start), verificationPassed: verifyResult.passed };
      
      await this.memory.updateState({ verificationResults: vResults, agentMetrics: metrics, completedAgents: verifyResult.passed ? [agent.role] : [], filesCreated: written });

      if (verifyResult.haltTriggered) return { agent, status: 'halted', durationMs: Date.now() - start, outputFile: written[0] ?? defaultFile, error: verifyResult.haltReason, verification: verifyResult };

      if (!verifyResult.passed) throw new Error(`Verification failed for ${agent.role}`);

      this.rarv.finishCycle(agent.order);
      await this._emitAgentComplete(agent, llmOutput, options);
      return { agent, status: 'completed', durationMs: Date.now() - start, outputFile: written[0] ?? defaultFile, verification: verifyResult, tokenUsage, attempts: 1 };

    } catch (error: any) {
      this.rarv.finishCycle(agent.order);
      const checkpointId = this.checkpointIds.get(agent.role);
      if (checkpointId) await this.checkpointManager.rollback(checkpointId);

      // Update circuit breaker
      const provider = this.detectProvider(options.modelOverride ?? agent.preferredModel);
      this.recordCircuitFailure(provider);

      // Log structured error
      const category = this.categorizeError(error);
      await this.memory.appendLog('system', `â Œ Agent ${agent.role} failed [${category}]: ${error.message?.slice(0, 200) ?? 'Unknown'}`);

      await this._emitError(agent, error, options);
      return { agent, status: 'failed', durationMs: Date.now() - start, outputFile: null, error: error.message };
    }
  }

  private groupIntoStages(agents: AgentDefinition[]): AgentDefinition[][] {
    const roleMap = new Map(agents.map(a => [a.role, a]));
    const stageDefs = [['ceo'], ['pm'], ['architect'], ['ui_ux', 'database'], ['api_designer'], ['backend'], ['frontend', 'auth'], ['integration'], ['unit_test', 'integration_test'], ['security', 'performance'], ['code_review'], ['docs', 'tech_writer'], ['devops']];
    const stages: AgentDefinition[][] = [];
    for (const roles of stageDefs) {
      const sa = roles.map(r => roleMap.get(r)).filter((a): a is AgentDefinition => !!a);
      if (sa.length > 0) stages.push(sa);
    }
    const mapped = new Set(stageDefs.flat());
    const extra = agents.filter(a => !mapped.has(a.role));
    if (extra.length > 0) stages.push(...extra.map(a => [a]));
    return stages;
  }

  private async findBacktrackTarget(agent: AgentDefinition, agentsToRun: AgentDefinition[], curIdx: number) {
    const targets = agent.backtrackTargets ?? [];
    for (const t of targets) {
      const idx = agentsToRun.findIndex(a => a.role === t);
      if (idx >= 0 && idx < curIdx) return { targetIndex: idx, targetAgent: agentsToRun[idx]! };
    }
    return curIdx > 0 ? { targetIndex: curIdx - 1, targetAgent: agentsToRun[curIdx - 1]! } : null;
  }

  private async recordBacktrack(from: string, to: string, reason: string) {
    const state = await this.memory.getState();
    const history = state.backtrackHistory ?? [];
    history.push({ from, to, reason: reason.slice(0, 500), timestamp: new Date().toISOString() });
    await this.memory.updateState({ backtrackHistory: history } as any);
    await this.memory.appendLog('system', `ğŸ›‘ BACKTRACK TRIGGERED: ${from} â†’ ${to} (${reason.slice(0, 200)})`);
  }

  private async gatherAgentContext(agent: AgentDefinition, userTask: string) {
    const context: Record<string, string> = { _userTask: userTask };
    if (agent.inputFiles.length > 0) Object.assign(context, await this.memory.readMultipleOutputs(agent.inputFiles));
    return context;
  }

  private async buildAgentPrompt(agent: AgentDefinition, context: Record<string, string>, userTask: string, options: PipelineOptions) {
    let system = agent.systemPrompt;
    if (this.skillMapper) system = await this.skillMapper.buildEnrichedPrompt(agent, options.extraSkills).catch(() => system);
    const logs = await this.memory.readLogTail(30);
    const workflow = await this.loadWorkflow(agent);
    
    return [
      `# ${agent.emoji} ROLE: ${agent.name} (${agent.role})`,
      '## REAL-WORLD TERMINAL LOGS\n```text\n' + (logs || '(Empty)') + '\n```',
      '## CORE INSTRUCTIONS\n' + system,
      agent.outputValidation ? `## REQUIRED SECTIONS\n${agent.outputValidation.map(s => `- [ ] ${s}`).join('\n')}` : '',
      workflow ? `## STANDARD WORKFLOW\n${workflow}` : '',
      '## USER OBJECTIVE\n' + userTask,
      '## SOURCE DOCUMENTS\n' + Object.keys(context).filter(k => !k.startsWith('_')).map(k => `### ${k}\n\`\`\`\n${context[k]}\n\`\`\``).join('\n\n')
    ].join('\n\n');
  }

  /**
   * Detect which LLM provider a model string refers to.
   */
  private detectProvider(model: string): string {
    const lower = model.toLowerCase();
    if (lower.includes('claude') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('openai')) return 'openai';
    return 'google'; // default: gemini
  }

  /**
   * Check if the circuit breaker is open for a provider.
   * If open, throw an error to prevent calls.
   */
  private checkCircuitBreaker(provider: string): void {
    const cb = this.circuitBreakers.get(provider);
    if (!cb || !cb.isOpen) return;
    if (Date.now() >= cb.nextRetryAt) {
      // Half-open: allow one attempt
      console.log(`[Alloy:Breaker] Half-open for ${provider}, allowing attempt`);
      return;
    }
    throw new Error(`Circuit breaker is OPEN for ${provider}. Next retry at ${new Date(cb.nextRetryAt).toISOString()}`);
  }

  /**
   * Record a failure in the circuit breaker for a provider.
   */
  private recordCircuitFailure(provider: string): void {
    let cb = this.circuitBreakers.get(provider);
    if (!cb) {
      cb = { failures: 0, lastFailureAt: null, isOpen: false, nextRetryAt: 0 };
      this.circuitBreakers.set(provider, cb);
    }
    cb.failures++;
    cb.lastFailureAt = Date.now();
    // Open circuit after 5 consecutive failures
    if (cb.failures >= 5) {
      cb.isOpen = true;
      cb.nextRetryAt = Date.now() + 60_000; // 1 minute cooldown
      console.warn(`[Alloy:Breaker] OPENED for ${provider} after ${cb.failures} failures`);
      
      // Phase 4.2: Health Telemetry
      this.memory.updateState({ 
        knownIssues: [`Circuit breaker OPEN for ${provider}`]
      }).catch(() => {});
    }
  }

  /**
   * Record a success â€” reset the circuit breaker.
   */
  private recordCircuitSuccess(provider: string): void {
    this.circuitBreakers.delete(provider);
  }

  /**
   * Categorize an error for structured handling.
   */
  private categorizeError(error: Error): ErrorCategory {
    const msg = (error.message ?? '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('abort') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return 'rate_limit';
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) return 'auth';
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed')) return 'network';
    if (msg.includes('validation') || msg.includes('schema') || msg.includes('zod') || msg.includes('parse')) return 'validation';
    if (msg.includes('llm') || msg.includes('empty response') || msg.includes('api')) return 'llm_error';
    return 'unknown';
  }

  /**
   * Execute an LLM call with agent-specific timeout based on estimatedMinutes.
   */
  private async executeLlmCallWithTimeout(
    agent: AgentDefinition,
    systemPrompt: string,
    userPrompt: string,
    model: string,
  ): Promise<{ output: string; tokenUsage: TokenUsage }> {
    const provider = this.detectProvider(model);
    this.checkCircuitBreaker(provider);

    // Agent timeout: estimatedMinutes + 2 minute buffer, max 10 minutes
    const timeoutMs = Math.min((agent.estimatedMinutes + 2) * 60_000, 600_000);

    const result = await this.executeLlmCall(agent, systemPrompt, userPrompt, model, timeoutMs);
    this.recordCircuitSuccess(provider);
    return result;
  }

  /**
   * Core LLM API call. Supports Gemini, Anthropic, and OpenAI providers.
   * Returns the text output and estimated token usage.
   */
  private async executeLlmCall(
    agent: AgentDefinition,
    systemPrompt: string,
    userPrompt: string,
    model: string,
    timeoutMs: number = 180_000,
  ): Promise<{ output: string; tokenUsage: TokenUsage }> {
    const provider = this.detectProvider(model);
    const fetchFn = this.alloyClient ? this.alloyClient.fetch.bind(this.alloyClient) : fetch;

    let output: string;
    let tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

    if (provider === 'anthropic') {
      const result = await this.executeAnthropicCall(fetchFn, model, systemPrompt, userPrompt, timeoutMs);
      output = result.output;
      tokenUsage = result.tokenUsage;
    } else if (provider === 'openai') {
      const result = await this.executeOpenAICall(fetchFn, model, systemPrompt, userPrompt, timeoutMs);
      output = result.output;
      tokenUsage = result.tokenUsage;
    } else {
      // Default: Google Gemini
      const result = await this.executeGeminiCall(fetchFn, model, systemPrompt, userPrompt, timeoutMs);
      output = result.output;
      tokenUsage = result.tokenUsage;
    }

    if (!output) throw new Error(`Empty response from ${agent.role} (${model})`);
    return { output, tokenUsage };
  }

  /**
   * Google Gemini API call.
   */
  private async executeGeminiCall(
    fetchFn: typeof fetch,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<{ output: string; tokenUsage: TokenUsage }> {
    const cleanModel = model.includes('/') ? model.split('/')[1]! : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;

    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: this.temperature, maxOutputTokens: this.maxOutputTokens },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini API Error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const usage = data.usageMetadata;
    const tokenUsage: TokenUsage = {
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
      estimatedCostUsd: (usage?.totalTokenCount ?? 0) * 0.000_000_1,
    };
    return { output: text, tokenUsage };
  }

  /**
   * Anthropic Claude API call.
   */
  private async executeAnthropicCall(
    fetchFn: typeof fetch,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<{ output: string; tokenUsage: TokenUsage }> {
    // Map short names to full model IDs
    const modelMap: Record<string, string> = {
      'opus': 'claude-opus-4-0-20250514',
      'sonnet': 'claude-sonnet-4-20250514',
      'haiku': 'claude-haiku-4-20250514',
    };
    const fullModel = modelMap[model.toLowerCase()] ?? model;

    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: fullModel,
        max_tokens: this.maxOutputTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: this.temperature,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API Error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json() as any;
    const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') ?? '';
    const usage = data.usage;
    const tokenUsage: TokenUsage = {
      promptTokens: usage?.input_tokens ?? 0,
      completionTokens: usage?.output_tokens ?? 0,
      totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
      estimatedCostUsd: ((usage?.input_tokens ?? 0) * 0.000_015) + ((usage?.output_tokens ?? 0) * 0.000_075),
    };
    return { output: text, tokenUsage };
  }

  /**
   * OpenAI API call.
   */
  private async executeOpenAICall(
    fetchFn: typeof fetch,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<{ output: string; tokenUsage: TokenUsage }> {
    const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        max_tokens: this.maxOutputTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI API Error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage;
    const tokenUsage: TokenUsage = {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      estimatedCostUsd: (usage?.total_tokens ?? 0) * 0.000_005,
    };
    return { output: text, tokenUsage };
  }

  private async loadWorkflow(agent: AgentDefinition) {
    const workflowMap: Record<string, string> = { 'ceo': '1_gereksinim_analizi.md', 'pm': '1_gereksinim_analizi.md', 'architect': '2_mimari_tasarim.md', 'ui_ux': '10_ui_ux_refinement.md', 'database': '3_veritabani_sema.md', 'api_designer': '4_api_spec.md', 'backend': '7_backend_gelistirme.md', 'frontend': '8_frontend_gelistirme.md', 'auth': '5_guvenlik_uyum.md', 'integration': '9_entegrasyon_testi.md', 'unit_test': '6_birim_test.md', 'integration_test': '9_entegrasyon_testi.md', 'security': '5_guvenlik_uyum.md', 'performance': '11_performans_opt.md', 'code_review': '14_proje_teslim.md', 'docs': '12_dokumantasyon.md', 'tech_writer': '12_dokumantasyon.md', 'devops': '13_devops_deployment.md' };
    const file = workflowMap[agent.role];
    if (!file) return null;
    return fs.readFile(path.join(this.projectRoot, '.agent', 'workflows', file), 'utf-8').catch(() => null);
  }

  private async autoVerifyPipeline(options: PipelineOptions) {
    const state = await this.memory.getState();
    if (state.completedAgents.includes('devops')) {
       const r = await this.terminal.runFullVerification();
       await this.memory.writeAgentOutput('pipeline', 'verification-result.md', `# Final Verification\nBuild: ${r.build.success ? 'ğŸ† OK' : 'âŒ FAIL'}\nTest: ${r.test.success ? 'ğŸ† OK' : 'âŒ FAIL'}`);
    }
  }

  /**
   * Save current pipeline state as a workflow file for later resumption.
   */
  private async saveWorkflow(agentResults: AgentResult[], stages: AgentDefinition[][], currentStageIndex: number) {
    const workflowPath = path.join(this.projectRoot, '.ai-company', 'workflow-state.json');
    const workflow = {
      sessionId: this.sessionId,
      savedAt: new Date().toISOString(),
      currentStageIndex,
      totalStages: stages.length,
      completedRoles: agentResults.filter(r => r.status === 'completed').map(r => r.agent.role),
      failedRoles: agentResults.filter(r => r.status === 'failed').map(r => ({ role: r.agent.role, error: r.error })),
      cumulativeTokens: { ...this.cumulativeTokens },
      circuitBreakers: Object.fromEntries(this.circuitBreakers),
    };
    await fs.mkdir(path.dirname(workflowPath), { recursive: true });
    await fs.writeFile(workflowPath, JSON.stringify(workflow, null, 2), 'utf-8');
    console.log(`[Alloy:Pipeline] Workflow saved to ${workflowPath}`);
  }

  /**
   * Load a previously saved workflow state.
   */
  public async loadWorkflowState(): Promise<{
    sessionId: string;
    savedAt: string;
    currentStageIndex: number;
    completedRoles: string[];
    failedRoles: Array<{ role: string; error?: string }>;
  } | null> {
    const workflowPath = path.join(this.projectRoot, '.ai-company', 'workflow-state.json');
    const content = await fs.readFile(workflowPath, 'utf-8').catch(() => null);
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Clear a saved workflow state file.
   */
  public async clearWorkflowState(): Promise<void> {
    const workflowPath = path.join(this.projectRoot, '.ai-company', 'workflow-state.json');
    await fs.rm(workflowPath, { force: true }).catch(() => {});
  }

  public async getProgress() {
    const state = await this.memory.getState();
    const current = AGENTS.find(a => a.role === state.currentAgent) ?? null;
    const completedSet = new Set(state.completedAgents);
    const timeline = await this.memory.getTimeline();
    return {
      state, totalAgents: AGENTS.length, completedCount: state.completedAgents.length,
      currentAgent: current, nextAgent: current ? getNextAgent(current.order) ?? null : AGENTS.find(a => !completedSet.has(a.role)) ?? null,
      estimatedRemainingMinutes: AGENTS.filter(a => !completedSet.has(a.role)).reduce((sum, a) => sum + a.estimatedMinutes, 0),
      timeline,
      tokenUsage: { ...this.cumulativeTokens },
    };
  }

  public pause() { this.paused = true; }
  public async resume(task: string, opts: PipelineOptions = {}) {
     const state = await this.memory.getState();
     const last = state.completedAgents[state.completedAgents.length - 1];
     const next = last ? (AGENTS.find(a => a.role === last)?.order ?? 0) + 1 : 1;
     return this.start(task || state.userTask, { ...opts, startFromOrder: next });
  }

  private handleHalt(agent: AgentDefinition, result: AgentResult, startTime: number, results: AgentResult[], options: PipelineOptions) {
    results.push(result);
    this.memory.updateState({ pipelineStatus: 'halted', currentAgent: agent.role });
    this.running = false;
    options.onHalt?.(agent, result.error ?? 'Halt');
    return this.buildResult(results, startTime, 'halted');
  }

  private handleFailure(agent: AgentDefinition, result: AgentResult, startTime: number, results: AgentResult[]) {
    this.memory.updateState({ pipelineStatus: 'failed' });
    this.running = false;
    return this.buildResult(results, startTime, 'failed');
  }

  private buildResult(results: AgentResult[], start: number, status: PipelineResult['status']): PipelineResult {
     return {
       status,
       agentResults: results,
       totalDurationMs: Date.now() - start,
       completedCount: results.filter(r => r.status === 'completed').length,
       failedCount: results.filter(r => r.status === 'failed').length,
       skippedCount: results.filter(r => r.status === 'skipped').length,
       haltedCount: results.filter(r => r.status === 'halted').length,
       totalTokenUsage: { ...this.cumulativeTokens },
       totalEstimatedCostUsd: this.cumulativeTokens.estimatedCostUsd,
     };
  }
}
