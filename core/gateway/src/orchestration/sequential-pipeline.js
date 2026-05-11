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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequentialPipeline = exports.PlanMode = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const async_lock_1 = __importDefault(require("async-lock"));
const agents_1 = require("./agents");
const shared_memory_1 = require("./shared-memory");
const rarv_engine_1 = require("./rarv-engine");
const skill_mapper_1 = require("./skill-mapper");
const terminal_executor_1 = require("./terminal-executor");
const skill_generator_1 = require("./skill-generator");
const verification_engine_1 = require("./verification-engine");
const checkpoint_manager_1 = require("./checkpoint-manager");
// import { sanitizeOutput } from "./schemas"; // Keep commented or remove if unused
const event_bus_1 = require("./event-bus");
const AutonomyPolicyEngine_1 = require("./policy/AutonomyPolicyEngine");
const pipeline_types_1 = require("./pipeline/pipeline-types");
Object.defineProperty(exports, "PlanMode", { enumerable: true, get: function () { return pipeline_types_1.PlanMode; } });
const CircuitBreaker_1 = require("./pipeline/CircuitBreaker");
const LLMProviders_1 = require("./pipeline/LLMProviders");
const AgentExecutor_1 = require("./pipeline/AgentExecutor");
const DependencyGraph_1 = require("./DependencyGraph");
const TaskScheduler_1 = require("./TaskScheduler");
const TimelineAggregator_1 = require("./TimelineAggregator");
const FsWatcher_1 = require("./FsWatcher");
const ContextProjector_1 = require("./ContextProjector");
/** Map plan modes to agent order ranges. */
const PLAN_MODE_RANGES = {
    full: { start: 1, end: 18 },
    management_only: { start: 1, end: 3 },
    dev_only: { start: 7, end: 10 },
    quality_only: { start: 11, end: 15 },
    custom: { start: 1, end: 18 },
};
/**
 * SequentialPipeline — The core orchestration engine for Alloy AI.
 * Coordinates 18 agents in a staged, bulletproof flow.
 */
class SequentialPipeline {
    memory;
    rarv;
    skillMapper = null;
    terminal;
    verifier;
    skillGenerator;
    toolEngine = null;
    checkpointManager;
    projectRoot;
    paused = false;
    running = false;
    abortController = null;
    alloyClient;
    temperature = 0.2;
    maxOutputTokens = 4096;
    sessionId;
    checkpointIds = new Map();
    backtrackLock = new async_lock_1.default();
    epoch = 0;
    isDisposed = false;
    pipelineOptimizer = null;
    // Delegated Services
    circuitBreaker;
    agentExecutor;
    providers = new Map();
    autonomyPolicy = AutonomyPolicyEngine_1.autonomyPolicyEngine;
    timeline;
    fsWatcher;
    // Token & cost tracking
    cumulativeTokens = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
    };
    rarvListeners = new Set();
    agentStartListeners = new Set();
    agentCompleteListeners = new Set();
    verifyListeners = new Set();
    errorListeners = new Set();
    constructor(projectRoot, alloyClient, overrides = {}) {
        this.projectRoot = projectRoot;
        this.alloyClient = alloyClient;
        this.memory = overrides.memory ?? new shared_memory_1.SharedMemory(projectRoot);
        this.rarv = new rarv_engine_1.RARVEngine(this.memory);
        this.terminal = overrides.terminal ?? new terminal_executor_1.TerminalExecutor(projectRoot);
        this.verifier = new verification_engine_1.VerificationEngine(this.terminal);
        this.skillGenerator = new skill_generator_1.SkillGenerator(projectRoot);
        this.toolEngine = overrides.toolEngine ?? null;
        this.checkpointManager = new checkpoint_manager_1.CheckpointManager(projectRoot, this.terminal);
        this.pipelineOptimizer = overrides.optimizer ?? null;
        this.sessionId = Math.random().toString(36).slice(2, 10);
        // Initialize Delegated Services
        this.circuitBreaker = new CircuitBreaker_1.CircuitBreaker({
            failureThreshold: 3,
            cooldownMs: 60000,
            onTrip: (provider, state) => {
                console.warn(`Circuit breaker OPEN for ${provider}. Failures: ${state.failures}`);
            },
        });
        this.agentExecutor = new AgentExecutor_1.AgentExecutor({
            projectRoot,
            memory: this.memory,
            skillMapper: this.skillMapper,
        });
        this.providers.set("gemini", new LLMProviders_1.GeminiProvider());
        this.providers.set("anthropic", new LLMProviders_1.AnthropicProvider());
        this.providers.set("openai", new LLMProviders_1.OpenAIProvider());
        this.providers.set("speculative", new LLMProviders_1.SpeculativeProvider(`http://${overrides.optimizer?.['config']?.bridgeHost ?? '127.0.0.1'}:9100`));
        this.providers.set("ollama", new LLMProviders_1.OllamaProvider());
        // Phase 4 Services
        this.timeline = new TimelineAggregator_1.TimelineAggregator(projectRoot, this.sessionId);
        this.fsWatcher = new FsWatcher_1.FsWatcher(projectRoot);
    }
    dispose() {
        this.isDisposed = true;
        this.running = false;
        this.abortController?.abort();
        this.rarvListeners.clear();
        this.agentStartListeners.clear();
        this.agentCompleteListeners.clear();
        this.errorListeners.clear();
        this.verifyListeners.clear();
        // Phase 4 Tear Down
        this.timeline.dispose();
        this.fsWatcher.stop();
    }
    async init() {
        await this.memory.init();
    }
    isRunning() { return this.running; }
    getMemory() { return this.memory; }
    // Event Listeners
    onRarvPhase(cb) { this.rarvListeners.add(cb); return { dispose: () => this.rarvListeners.delete(cb) }; }
    onAgentStart(cb) { this.agentStartListeners.add(cb); return { dispose: () => this.agentStartListeners.delete(cb) }; }
    onAgentComplete(cb) { this.agentCompleteListeners.add(cb); return { dispose: () => this.agentCompleteListeners.delete(cb) }; }
    onVerify(cb) { this.verifyListeners.add(cb); return { dispose: () => this.verifyListeners.delete(cb) }; }
    onError(cb) { this.errorListeners.add(cb); return { dispose: () => this.errorListeners.delete(cb) }; }
    async _emitAgentStart(agent, options) {
        await Promise.all(Array.from(this.agentStartListeners).map(async (cb) => { try {
            await cb(agent);
        }
        catch (e) {
            console.error(e);
        } }));
        await options.onAgentStart?.(agent);
        event_bus_1.eventBus.publish('agent_start', { agent });
    }
    async _emitAgentComplete(agent, output, options) {
        await Promise.all(Array.from(this.agentCompleteListeners).map(async (cb) => { try {
            await cb(agent, output);
        }
        catch (e) {
            console.error(e);
        } }));
        await options.onAgentComplete?.(agent, output);
        event_bus_1.eventBus.publish('agent_complete', { agent, output: output.slice(0, 1000) });
    }
    async _emitRarvPhase(phase, options) {
        await Promise.all(Array.from(this.rarvListeners).map(async (cb) => { try {
            await cb(phase);
        }
        catch (e) {
            console.error(e);
        } }));
        await options.onRarvPhase?.(phase);
        event_bus_1.eventBus.publish('rarv_phase', { phase });
    }
    async _emitVerify(agent, result, _options) {
        await Promise.all(Array.from(this.verifyListeners).map(async (cb) => { try {
            await cb(agent, result);
        }
        catch (e) {
            console.error(e);
        } }));
        await _options.onVerify?.(agent, result);
        event_bus_1.eventBus.publish('verify', { agent, result });
    }
    async _emitError(agent, error, options) {
        await Promise.all(Array.from(this.errorListeners).map(async (cb) => { try {
            await cb(agent, error);
        }
        catch (e) {
            console.error(e);
        } }));
        await options.onError?.(agent, error);
        event_bus_1.eventBus.publish('error', { agent, error: error.message });
    }
    async start(userTask, options = {}) {
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
        // Start Phase 4 Monitoring
        await this.timeline.init();
        this.fsWatcher.start();
        if (options.skillsDir) {
            this.skillMapper = new skill_mapper_1.SkillMapper(options.skillsDir);
        }
        const startTime = Date.now();
        const skipSet = new Set(options.skipAgents ?? []);
        const agentResults = [];
        // Ensure agentExecutor has access to the latest skillMapper
        if (this.skillMapper) {
            this.agentExecutor = new AgentExecutor_1.AgentExecutor({
                projectRoot: this.projectRoot,
                memory: this.memory,
                skillMapper: this.skillMapper,
            });
        }
        const planMode = options.planMode ?? pipeline_types_1.PlanMode.FULL;
        const range = PLAN_MODE_RANGES[planMode];
        const startOrder = options.startFromOrder ?? range.start;
        const endOrder = range.end;
        await this.memory.updateState({
            userTask,
            pipelineStatus: 'running',
            startedAt: new Date().toISOString(),
            completedAt: null,
        });
        const allAgentsToRun = agents_1.AGENTS.filter(a => a.order >= startOrder && a.order <= endOrder);
        // Phase 3: High-Performance Parallel Orchestration
        const graph = new DependencyGraph_1.DependencyGraph(allAgentsToRun);
        const scheduler = new TaskScheduler_1.TaskScheduler({
            graph,
            maxConcurrency: 4 // Optimized for performance/rate-limits
        });
        scheduler.init(allAgentsToRun);
        const runningTasks = new Set();
        while (!scheduler.isDone()) {
            this.abortController.signal.throwIfAborted();
            if (this.paused) {
                await this.memory.updateState({ pipelineStatus: 'paused', currentAgent: null });
                await this.saveWorkflow(agentResults);
                this.running = false;
                return this.buildResult(agentResults, startTime, 'paused');
            }
            // Dispatch available tasks
            const readyRoles = scheduler.dispatch();
            for (const role of readyRoles) {
                const agent = allAgentsToRun.find(a => a.role === role);
                if (skipSet.has(role)) {
                    agentResults.push({ agent, status: 'skipped', durationMs: 0, outputFile: null });
                    scheduler.complete(role);
                    continue;
                }
                const taskPromise = this.executeAgentWithRetry(agent, userTask, options, allAgentsToRun, agentResults)
                    .then(async (execResult) => {
                    if (execResult.status === 'completed') {
                        scheduler.complete(role);
                    }
                    else if (execResult.status === 'halted') {
                        scheduler.abortAll(); // Abort others if we halt
                        this.pause();
                    }
                    else if (execResult.backtrack) {
                        scheduler.abortAll(); // Strategic Abort: Cancel siblings to reset level
                        this.epoch++;
                    }
                    else {
                        scheduler.abortAll(); // Extreme Hardening: Transactional failure
                        scheduler.fail(role, execResult.result?.error || 'Execution failed');
                    }
                    runningTasks.delete(taskPromise);
                });
                runningTasks.add(taskPromise);
            }
            // Performance Optimization: Wait for ANY task to complete before next dispatch cycle
            if (runningTasks.size > 0) {
                await Promise.race(runningTasks);
            }
            else if (readyRoles.length === 0 && !scheduler.isDone()) {
                // No ready tasks and not done? We might be waiting or in a deadlock
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        if (options.autoVerify !== false)
            await this.autoVerifyPipeline(options);
        if (options.generateSkills !== false)
            await this.skillGenerator.generateProposals(this.memory).catch(() => []);
        await this.memory.updateState({
            pipelineStatus: 'completed',
            currentAgent: null,
            completedAt: new Date().toISOString(),
        });
        // Prune old checkpoints on successful completion
        await this.checkpointManager.pruneOldCheckpoints().catch(() => { });
        this.running = false;
        return this.buildResult(agentResults, startTime, 'completed');
    }
    async executeAgentWithRetry(agent, userTask, options, agentsToRun, agentResults) {
        const MAX_ATTEMPTS = 3;
        const BASE_DELAY_MS = 1000;
        let lastResult;
        const startEpoch = this.epoch;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (this.epoch !== startEpoch)
                return { status: 'failed', result: lastResult };
            const result = await this.executeAgent(agent, userTask, options);
            lastResult = result;
            if (result.status === 'completed') {
                agentResults.push(result);
                return { status: 'completed', result };
            }
            if (result.status === 'halted')
                return { status: 'halted', result };
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
                    return await this.backtrackLock.acquire('backtrack', async () => {
                        const freshResults = agentResults.filter(r => r.agent.order >= targetAgent.order);
                        if (freshResults.length === 0 && attempt === MAX_ATTEMPTS) {
                            return { status: 'failed', result: lastResult };
                        }
                        await this.recordBacktrack(agent.role, targetAgent.role, result.error ?? 'Max retries exceeded');
                        this.epoch++; // Trigger epoch change
                        for (let i = agentResults.length - 1; i >= 0; i--) {
                            if (agentResults[i].agent.order >= targetAgent.order)
                                agentResults.splice(i, 1);
                        }
                        const checkpointId = this.checkpointIds.get(targetAgent.role);
                        if (checkpointId)
                            await this.checkpointManager.rollback(checkpointId);
                        return { status: 'failed', result, backtrack: target };
                    });
                }
            }
        }
        return { status: 'failed', result: lastResult };
    }
    async executeAgent(agent, userTask, options) {
        const start = Date.now();
        this.abortController?.signal.throwIfAborted();
        if (agent.layer === agents_1.AgentLayer.DEVELOPMENT || agent.layer === agents_1.AgentLayer.DESIGN) {
            const cid = await this.checkpointManager.createCheckpoint(`${this.sessionId}_pre_${agent.role}`);
            this.checkpointIds.set(agent.role, cid);
        }
        try {
            await this._emitAgentStart(agent, options);
            await this.memory.updateState({ currentAgent: agent.role });
            await this.rarv.startCycle(agent.order, agent.order);
            const context = await this.agentExecutor.gatherContext(agent, userTask);
            const prompt = await this.agentExecutor.buildPrompt(agent, context, userTask, options.extraSkills);
            let targetModel = options.modelOverride ?? agent.preferredModel;
            // Phase 8: Hardened routing. Pipe all DEVELOPMENT-layer tasks through Speculative Consensus if not explicitly overridden.
            if (!options.modelOverride && agent.layer === agents_1.AgentLayer.DEVELOPMENT) {
                targetModel = "speculative";
            }
            const providerKey = this.detectProvider(targetModel);
            const provider = this.providers.get(providerKey) || this.providers.get("gemini");
            this.circuitBreaker.check(providerKey);
            // Above Vision: Shadow Semantic Validation
            // We perform a blind check to ensure reasoning aligns with goals
            const shadowValidator = async (evalPrompt) => {
                const shadowResponse = await provider.execute(agent, "You are a Shadow Policy Validator.", evalPrompt, "gemini-1.5-flash", { temperature: 0, maxOutputTokens: 500, timeoutMs: 30000 });
                return shadowResponse.output;
            };
            // Phase 4: Chronos Context Ingestion
            const recentHistory = await ContextProjector_1.ContextProjector.projectRecentActivity(path.join(this.projectRoot, '.ai-company', 'logs', this.sessionId, 'timeline.jsonl'));
            this.timeline.setContext(agent.role, this.epoch);
            const agentReasoning = [
                `Agent: ${agent.role}`,
                `Layer: ${agent.layer}`,
                `Preferred model: ${agent.preferredModel}`,
                `Output files: ${agent.outputFiles.join(', ')}`,
                `Estimated minutes: ${agent.estimatedMinutes}`,
            ].join('\n');
            const semanticViolation = await this.autonomyPolicy.verifySemanticIntent(agentReasoning, prompt.slice(0, 500) + `\n\n[RECENT_HISTORY]\n${recentHistory}`, userTask, shadowValidator);
            if (semanticViolation) {
                throw new Error(`Alloy Intercept: ${semanticViolation.reason}`);
            }
            const response = await provider.execute(agent, agent.systemPrompt, prompt, options.modelOverride || agent.preferredModel, {
                temperature: options.temperature ?? this.temperature,
                maxOutputTokens: options.maxOutputTokens ?? this.maxOutputTokens,
                timeoutMs: Math.min((agent.estimatedMinutes + 2) * 60_000, 600_000),
            });
            this.trackTokens(response.tokenUsage);
            this.circuitBreaker.recordSuccess(providerKey);
            await this._emitRarvPhase(`VERIFY for ${agent.role}`, options);
            const defaultFile = agent.outputFiles[0] ?? `${agent.role}-output.md`;
            const written = await this.memory.writeAgentOutput(agent.role, defaultFile, response.output);
            const verifyResult = await this.verifier.verify(agent, response.output);
            for (const cmd of verifyResult.commands)
                await this._emitVerify(agent, cmd, options);
            const state = await this.memory.getState();
            const vResults = (state.verificationResults ?? {});
            vResults[agent.role] = { passed: verifyResult.passed, commands: verifyResult.commands.map(c => `${c.command}: ${c.passed ? 'OK' : 'FAIL'}`), timestamp: verifyResult.timestamp };
            const metrics = (state.agentMetrics ?? {});
            const rawM = metrics[agent.role];
            const m = rawM ?? { attempts: 0, totalDurationMs: 0, verificationPassed: false };
            metrics[agent.role] = { attempts: (m.attempts ?? 0) + 1, totalDurationMs: (m.totalDurationMs ?? 0) + (Date.now() - start), verificationPassed: verifyResult.passed };
            await this.memory.updateState({ verificationResults: vResults, agentMetrics: metrics, completedAgents: verifyResult.passed ? [agent.role] : [], filesCreated: written });
            if (verifyResult.haltTriggered)
                return { agent, status: 'halted', durationMs: Date.now() - start, outputFile: written[0] ?? defaultFile, error: verifyResult.haltReason, verification: verifyResult };
            if (!verifyResult.passed)
                throw new Error(`Verification failed for ${agent.role}`);
            await this.rarv.finishCycle(agent.order);
            await this._emitAgentComplete(agent, response.output, options);
            return { agent, status: 'completed', durationMs: Date.now() - start, outputFile: written[0] ?? defaultFile, verification: verifyResult, tokenUsage: response.tokenUsage, attempts: 1 };
        }
        catch (error) {
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
                if (checkpointId)
                    await this.checkpointManager.rollback(checkpointId);
            }
            await this.memory.appendLog('system', `❌ Agent ${agent.role} failed: ${errorMessage.slice(0, 200)}`, { epoch: this.epoch });
            await this._emitError(agent, error, options);
            return { agent, status: 'failed', durationMs: Date.now() - start, outputFile: null, error: errorMessage };
        }
    }
    // legacy groupIntoStages removed to favor DependencyGraph
    async findBacktrackTarget(agent, _agentsToRun, _curIdx) {
        const graph = new DependencyGraph_1.DependencyGraph(agents_1.AGENTS);
        const parents = graph.getDependencies(agent.role);
        if (parents.length > 0) {
            // Backtrack to the first parent in the graph for maximum semantic safety
            const targetRole = parents[0];
            const targetAgent = agents_1.AGENTS.find(a => a.role === targetRole);
            return { targetIndex: targetAgent.order - 1, targetAgent };
        }
        // Conservative fallback to manual targets or immediate previous order
        const manualTargets = agent.backtrackTargets ?? [];
        if (manualTargets.length > 0) {
            const targetAgent = agents_1.AGENTS.find(a => a.role === manualTargets[0]);
            return { targetIndex: targetAgent.order - 1, targetAgent };
        }
        return null;
    }
    async recordBacktrack(from, to, reason) {
        const state = await this.memory.getState();
        const history = state.backtrackHistory ?? [];
        history.push({ from, to, reason: reason.slice(0, 500), timestamp: new Date().toISOString() });
        await this.memory.updateState({ backtrackHistory: history });
        await this.memory.appendLog('system', `🛑 BACKTRACK TRIGGERED: ${from} → ${to} (${reason.slice(0, 200)})`, { epoch: this.epoch });
    }
    async autoVerifyPipeline(_options) {
        const state = await this.memory.getState();
        if (state.completedAgents.includes('devops')) {
            const r = await this.terminal.runFullVerification();
            await this.memory.writeAgentOutput('pipeline', 'verification-result.md', `# Final Verification\nBuild: ${r.build.success ? '🏆 OK' : '❌ FAIL'}\nTest: ${r.test.success ? '🏆 OK' : '❌ FAIL'}`);
        }
    }
    detectProvider(model) {
        const lower = model.toLowerCase();
        if (lower === 'speculative')
            return 'speculative';
        if (lower.startsWith("ollama/") || lower.includes("gemma") || lower.includes("llama") || lower.includes("mistral"))
            return 'ollama';
        if (lower.includes('claude') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('anthropic'))
            return 'anthropic';
        if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('openai'))
            return 'openai';
        return 'gemini'; // default: gemini
    }
    categorizeError(error) {
        const msg = (error.message ?? '').toLowerCase();
        if (msg.includes('timeout') || msg.includes('abort') || msg.includes('timed out'))
            return 'timeout';
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests'))
            return 'rate_limit';
        if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden'))
            return 'auth';
        if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed'))
            return 'network';
        if (msg.includes('validation') || msg.includes('schema') || msg.includes('zod') || msg.includes('parse'))
            return 'validation';
        if (msg.includes('llm') || msg.includes('empty response') || msg.includes('api'))
            return 'llm_error';
        return 'unknown';
    }
    trackTokens(usage) {
        this.cumulativeTokens.promptTokens += usage.promptTokens;
        this.cumulativeTokens.completionTokens += usage.completionTokens;
        this.cumulativeTokens.totalTokens += usage.totalTokens;
        this.cumulativeTokens.estimatedCostUsd += usage.estimatedCostUsd;
        // Persist to SharedMemory incrementally
        this.memory.updateState({
            cumulativeTokens: usage,
            circuitBreakerState: Object.fromEntries(this.circuitBreaker.getStates())
        }).catch(() => { });
        event_bus_1.eventBus.publish('token_usage', usage);
    }
    /**
     * Save current pipeline state as a workflow file for later resumption.
     * Refactored for Parallel Orchestration: Stores completed agents instead of stage index.
     */
    async saveWorkflow(agentResults) {
        const workflowPath = path.join(this.projectRoot, '.ai-company', 'workflow-state.json');
        const workflow = {
            sessionId: this.sessionId,
            savedAt: new Date().toISOString(),
            completedRoles: agentResults.filter(r => r.status === 'completed').map(r => r.agent.role),
            failedRoles: agentResults.filter(r => r.status === 'failed').map(r => ({ role: r.agent.role, error: r.error })),
            cumulativeTokens: { ...this.cumulativeTokens },
            circuitBreakers: Object.fromEntries(this.circuitBreaker.getStates()),
            epoch: this.epoch
        };
        await fs.mkdir(path.dirname(workflowPath), { recursive: true });
        await fs.writeFile(workflowPath, JSON.stringify(workflow, null, 2), 'utf-8');
        console.log(`[Alloy:Pipeline] Workflow saved to ${workflowPath}`);
    }
    /**
     * Load a previously saved workflow state.
     */
    async loadWorkflowState() {
        const workflowPath = path.join(this.projectRoot, '.ai-company', 'workflow-state.json');
        const content = await fs.readFile(workflowPath, 'utf-8').catch(() => null);
        if (!content)
            return null;
        try {
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * Clear a saved workflow state file.
     */
    async clearWorkflowState() {
        const workflowPath = path.join(this.projectRoot, '.ai-company', 'workflow-state.json');
        await fs.rm(workflowPath, { force: true }).catch(() => { });
    }
    async getProgress() {
        const state = await this.memory.getState();
        const current = agents_1.AGENTS.find(a => a.role === state.currentAgent) ?? null;
        const completedSet = new Set(state.completedAgents);
        const timeline = await this.memory.getTimeline();
        return {
            state, totalAgents: agents_1.AGENTS.length, completedCount: state.completedAgents.length,
            currentAgent: current, nextAgent: current ? (0, agents_1.getNextAgent)(current.order) ?? null : agents_1.AGENTS.find(a => !completedSet.has(a.role)) ?? null,
            estimatedRemainingMinutes: agents_1.AGENTS.filter(a => !completedSet.has(a.role)).reduce((sum, a) => sum + a.estimatedMinutes, 0),
            timeline,
            tokenUsage: { ...this.cumulativeTokens },
        };
    }
    pause() { this.paused = true; }
    async resume(task, opts = {}) {
        const state = await this.memory.getState();
        const last = state.completedAgents[state.completedAgents.length - 1];
        const next = last ? (agents_1.AGENTS.find(a => a.role === last)?.order ?? 0) + 1 : 1;
        return this.start(task || state.userTask, { ...opts, startFromOrder: next });
    }
    async handleHalt(agent, result, startTime, results, options) {
        results.push(result);
        await this.memory.updateState({ pipelineStatus: 'halted', currentAgent: agent.role });
        this.running = false;
        options.onHalt?.(agent, result.error ?? 'Halt');
        return this.buildResult(results, startTime, 'halted');
    }
    async handleFailure(agent, result, startTime, results) {
        await this.memory.updateState({ pipelineStatus: 'failed' });
        this.running = false;
        return this.buildResult(results, startTime, 'failed');
    }
    buildResult(results, start, status) {
        return {
            status,
            agentResults: results,
            totalDurationMs: Date.now() - start,
            completedCount: results.filter(r => r.status === 'completed').length,
            failedCount: results.filter(r => r.status === 'failed').length,
            skippedCount: results.filter(r => r.status === 'skipped').length,
            haltedCount: results.filter(r => r.status === 'halted').length,
        };
    }
}
exports.SequentialPipeline = SequentialPipeline;
//# sourceMappingURL=sequential-pipeline.js.map