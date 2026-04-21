import * as fs from "node:fs/promises";
import * as path from "node:path";
import AsyncLock from "async-lock";
import { AGENTS, getNextAgent, type AgentDefinition, AgentLayer } from "./agents";
import { SharedMemory } from "./shared-memory";
import { RARVEngine } from "./rarv-engine";
import { SkillMapper } from "./skill-mapper";
import { TerminalExecutor } from "./terminal-executor";
import { SkillGenerator } from "./skill-generator";
import type { AlloyGatewayClient } from "./gateway-client";
import { VerificationEngine } from "./verification-engine";
import type { CommandVerificationResult } from "./verification-engine";
import { CheckpointManager } from "./checkpoint-manager";
// import { sanitizeOutput } from "./schemas"; // Keep commented or remove if unused
import { eventBus } from "./event-bus";
import type { IToolExecutionEngine } from "./tool-execution-engine";
import type { PipelineOptimizer } from "../gateway/pipeline-optimizer";

import {
  PlanMode,
  type AgentResult,
  type PipelineResult,
  type ErrorCategory,
  type TokenUsage,
} from "./pipeline/pipeline-types";
export { PlanMode };
export type { AgentResult, PipelineResult };
import { CircuitBreaker } from "./pipeline/CircuitBreaker";
import { GeminiProvider, AnthropicProvider, OpenAIProvider } from "./pipeline/LLMProviders";
import type { ILLMProvider } from "./pipeline/ILLMProvider";
import { AgentExecutor } from "./pipeline/AgentExecutor";

/** Map plan modes to agent order ranges. */
const PLAN_MODE_RANGES: Record<string, { start: number; end: number }> = {
  full: { start: 1, end: 18 },
  management_only: { start: 1, end: 3 },
  dev_only: { start: 7, end: 10 },
  quality_only: { start: 11, end: 15 },
  custom: { start: 1, end: 18 },
};

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
 * SequentialPipeline — The core orchestration engine for Alloy AI.
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
  private epoch: number = 0;

  private isDisposed = false;
  private pipelineOptimizer: PipelineOptimizer | null = null;

  // Delegated Services
  private circuitBreaker: CircuitBreaker;
  private agentExecutor: AgentExecutor;
  private providers: Map<string, ILLMProvider> = new Map();

  // Token & cost tracking
  private cumulativeTokens: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };

  private rarvListeners: Set<(phase: string) => void | Promise<void>> = new Set();
  private agentStartListeners: Set<(agent: AgentDefinition) => void | Promise<void>> = new Set();
  private agentCompleteListeners: Set<(agent: AgentDefinition, output: string) => void | Promise<void>> = new Set();
  private verifyListeners: Set<(agent: AgentDefinition, result: CommandVerificationResult) => void | Promise<void>> = new Set();
  private errorListeners: Set<(agent: AgentDefinition, error: Error) => void | Promise<void>> = new Set();

  constructor(
    projectRoot: string,
    alloyClient?: AlloyGatewayClient,
    overrides: {
      memory?: SharedMemory;
      terminal?: TerminalExecutor;
      toolEngine?: IToolExecutionEngine;
      optimizer?: PipelineOptimizer;
    } = {}
  ) {
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

    // Initialize Delegated Services
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 60000,
      onTrip: (provider, state) => {
        console.warn(`Circuit breaker OPEN for ${provider}. Failures: ${state.failures}`);
      },
    });

    this.agentExecutor = new AgentExecutor({
      projectRoot,
      memory: this.memory,
      skillMapper: this.skillMapper,
    });

    // Strategy registration
    this.providers.set("gemini", new GeminiProvider());
    this.providers.set("anthropic", new AnthropicProvider());
    this.providers.set("openai", new OpenAIProvider());
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

  private async _emitVerify(agent: AgentDefinition, result: CommandVerificationResult, _options: PipelineOptions) {
    await Promise.all(Array.from(this.verifyListeners).map(async cb => { try { await cb(agent, result); } catch (e) { console.error(e); } }));
    await _options.onVerify?.(agent, result);
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
    this.epoch++;

    if (options.skillsDir) {
      this.skillMapper = new SkillMapper(options.skillsDir);
    }

    const startTime = Date.now();
    const skipSet = new Set(options.skipAgents ?? []);
    const agentResults: AgentResult[] = [];

    // Ensure agentExecutor has access to the latest skillMapper
    if (this.skillMapper) {
       this.agentExecutor = new AgentExecutor({
         projectRoot: this.projectRoot,
         memory: this.memory,
         skillMapper: this.skillMapper,
       });
    }

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
        // Rejected
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

    const startEpoch = this.epoch;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this.epoch !== startEpoch) return { status: 'failed', result: lastResult };
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
            const freshResults = agentResults.filter(r => r.agent.order >= targetAgent.order);
            if (freshResults.length === 0 && attempt === MAX_ATTEMPTS) {
               return { status: 'failed', result: lastResult! };
            }

            await this.recordBacktrack(agent.role, targetAgent.role, result.error ?? 'Max retries exceeded');
            this.epoch++; // Trigger epoch change
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
      
      const context = await this.agentExecutor.gatherContext(agent, userTask);
      const prompt = await this.agentExecutor.buildPrompt(agent, context, userTask, options.extraSkills);

      const providerKey = this.detectProvider(options.modelOverride ?? agent.preferredModel);
      const provider = this.providers.get(providerKey) || this.providers.get("gemini")!;

      this.circuitBreaker.check(providerKey);

      const response = await provider.execute(
        agent,
        agent.systemPrompt,
        prompt,
        options.modelOverride || agent.preferredModel,
        {
          temperature: options.temperature ?? this.temperature,
          maxOutputTokens: options.maxOutputTokens ?? this.maxOutputTokens,
          timeoutMs: Math.min((agent.estimatedMinutes + 2) * 60_000, 600_000),
        }
      );

      this.trackTokens(response.tokenUsage);
      this.circuitBreaker.recordSuccess(providerKey);

      await this._emitRarvPhase(`VERIFY for ${agent.role}`, options);
      const defaultFile = agent.outputFiles[0] ?? `${agent.role}-output.md`;
      
      const written = await this.memory.writeAgentOutput(agent.role, defaultFile, response.output);
      const verifyResult = await this.verifier.verify(agent, response.output);
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

      await this.rarv.finishCycle(agent.order);
      await this._emitAgentComplete(agent, response.output, options);
      return { agent, status: 'completed', durationMs: Date.now() - start, outputFile: written[0] ?? defaultFile, verification: verifyResult, tokenUsage: response.tokenUsage, attempts: 1 };

    } catch (error: unknown) {
      await this.rarv.finishCycle(agent.order);
      // Already handled rollback in backtrack logic if needed, but for individual agent failure:
      const checkpointId = this.checkpointIds.get(agent.role);
      // If epoch changed, we are in a backtrack, don't rollback locally
      // but if it's a simple failure, we might want to rollback to pre-agent state
      // Actually, executeAgentWithRetry handles backtrack rollback.
      // We only rollback here if it WASN'T a backtrack.
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isCircuitOpen = errorMessage.includes('Circuit breaker is OPEN');

      if (!isCircuitOpen) {
        const provider = this.detectProvider(options.modelOverride ?? agent.preferredModel);
        this.circuitBreaker.recordFailure(provider);
        if (checkpointId) await this.checkpointManager.rollback(checkpointId);
      }
      await this.memory.appendLog('system', `❌ Agent ${agent.role} failed: ${errorMessage.slice(0, 200)}`);

      await this._emitError(agent, error as Error, options);
      return { agent, status: 'failed', durationMs: Date.now() - start, outputFile: null, error: errorMessage };
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
    await this.memory.updateState({ backtrackHistory: history });
    await this.memory.appendLog('system', `🛑 BACKTRACK TRIGGERED: ${from} → ${to} (${reason.slice(0, 200)})`);
  }

  private async autoVerifyPipeline(_options: PipelineOptions) {
    const state = await this.memory.getState();
    if (state.completedAgents.includes('devops')) {
       const r = await this.terminal.runFullVerification();
       await this.memory.writeAgentOutput('pipeline', 'verification-result.md', `# Final Verification\nBuild: ${r.build.success ? '🏆 OK' : '❌ FAIL'}\nTest: ${r.test.success ? '🏆 OK' : '❌ FAIL'}`);
    }
  }

  private detectProvider(model: string): string {
    const lower = model.toLowerCase();
    if (lower.includes('claude') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('openai')) return 'openai';
    return 'gemini'; // default: gemini
  }

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

  private trackTokens(usage: TokenUsage) {
    this.cumulativeTokens.promptTokens += usage.promptTokens;
    this.cumulativeTokens.completionTokens += usage.completionTokens;
    this.cumulativeTokens.totalTokens += usage.totalTokens;
    this.cumulativeTokens.estimatedCostUsd += usage.estimatedCostUsd;
    
    // Persist to SharedMemory incrementally
    this.memory.updateState({ cumulativeTokens: usage }).catch(() => {});
    
    eventBus.publish('token_usage', usage);
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
      circuitBreakers: Object.fromEntries(this.circuitBreaker.getStates()),
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

  private async handleHalt(agent: AgentDefinition, result: AgentResult, startTime: number, results: AgentResult[], options: PipelineOptions) {
    results.push(result);
    await this.memory.updateState({ pipelineStatus: 'halted', currentAgent: agent.role });
    this.running = false;
    options.onHalt?.(agent, result.error ?? 'Halt');
    return this.buildResult(results, startTime, 'halted');
  }

  private async handleFailure(agent: AgentDefinition, result: AgentResult, startTime: number, results: AgentResult[]) {
    await this.memory.updateState({ pipelineStatus: 'failed' });
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
