import { MemoryBankReconciler } from './memory/MemoryBankReconciler';
import { AnnotationManager } from './AnnotationManager';
import { ReasoningTracer } from './ReasoningTracer';
import { MerkleSnapshotEngine } from './MerkleSnapshotEngine';
import { BayesianConsensusGate } from './BayesianConsensusGate';
import type { Vote } from './BayesianConsensusGate';
import { AstStructuralAnchor } from './AstStructuralAnchor';
import type { AstFingerprint } from './AstStructuralAnchor';
import { CausalInferenceEngine } from './CausalInferenceEngine';
import { ResourceBackpressureController } from './ResourceBackpressureController';
import { ContextOrchestrator } from './ContextOrchestrator';
import type { ActiveTask, ADR } from './ContextOrchestrator';
import { BrowserToolExecutionEngine } from './BrowserToolExecutionEngine';
import type { BrowserAction } from './BrowserToolExecutionEngine';
import { DomSnapshotter } from './DomSnapshotter';
import type { DomNode } from './DomSnapshotter';
import { VisualSynapseEngine } from './VisualSynapseEngine';
import type { SynapseLink } from './VisualSynapseEngine';
import { SwarmController } from './SwarmController';
import type { BaseAgent } from './SwarmController';
import { SenateGate } from './SenateGate';
import type { Verdict } from './SenateGate';
import { McpMatchmakerEngine } from './mcp/McpMatchmakerEngine';
import { McpShadowFSGate } from './mcp/McpShadowFSGate';
import { McpAuthVault } from './mcp/McpAuthVault';
import { ModelRouterEngine } from './genetic/ModelRouterEngine';
import type { ModelMetrics } from './genetic/ModelRouterEngine';
import { InquisitorAgent } from './genetic/InquisitorAgent';
import { ContextCompressionEngine } from './genetic/ContextCompressionEngine';
import { PrivacySanctuaryGate } from './privacy/PrivacySanctuaryGate';
import { DifferentialPrivacyEngine } from './privacy/DifferentialPrivacyEngine';
import { ForensicPrivacyLedger } from './privacy/ForensicPrivacyLedger';
import type { TokenUsage } from './pipeline/pipeline-types';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { RARVState, RARVMetrics } from './rarv-engine';
import AsyncLock from 'async-lock';

export interface PipelineState {
  userTask: string;
  architecture?: string;
  designSystem?: string;
  techStack?: string;
  deploymentConfig?: string;
  authStrategy?: string;
  dbSchema?: string;
  apiContracts?: string;
  backtrackHistory?: unknown[];

  rarvState?: Record<number, RARVState>;
  rarvMetrics?: RARVMetrics;

  agentMetrics?: Record<string, unknown>;
  verificationResults?: Record<string, unknown>;
  pipelineStatus: 'completed' | 'failed' | 'paused' | 'halted' | 'idle' | 'running';
  currentAgent?: string | null;
  startedAt?: string;
  completedAt?: string | null;
  completedAgents: string[];
  filesCreated: string[];
  knownIssues: string[];
  cumulativeTokens?: TokenUsage;
  circuitBreakerState?: Record<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'>;
}

/**
 * SharedMemory: The central high-performance state layer for Alloy.
 * Hardened with namespace isolation, transactional integrity, and Phase 7 visual-context aware memory.
 */
export class SharedMemory {
  protected rootDir: string;
  private reconciler: MemoryBankReconciler;
  private annotationManager: AnnotationManager;
  private reasoningTracer: ReasoningTracer;
  private snapshotEngine: MerkleSnapshotEngine;
  private consensusGate: BayesianConsensusGate;
  private astAnchor: AstStructuralAnchor;
  private causalEngine: CausalInferenceEngine;
  private backpressure: ResourceBackpressureController;
  private contextOrchestrator: ContextOrchestrator;
  private browserEngine: BrowserToolExecutionEngine;
  private domSnapshotter: DomSnapshotter;
  private synapseEngine: VisualSynapseEngine;
  private swarmController: SwarmController;
  private senateGate: SenateGate;
  private mcpMatchmaker: McpMatchmakerEngine;
  private mcpShadowFS: McpShadowFSGate;
  private mcpAuthVault: McpAuthVault;
  private modelRouter: ModelRouterEngine;
  private inquisitor: InquisitorAgent;
  private contextCompression: ContextCompressionEngine;
  private privacyGate: PrivacySanctuaryGate;
  private diffPrivacy: DifferentialPrivacyEngine;
  private privacyLedger: ForensicPrivacyLedger;
  private lock: AsyncLock;

  constructor(projectRoot: string, private readonly sessionId: string = 'default') {
    this.rootDir = path.resolve(projectRoot, '.ai-company');
    this.reconciler = new MemoryBankReconciler(projectRoot);
    this.annotationManager = new AnnotationManager(projectRoot);
    this.reasoningTracer = new ReasoningTracer(projectRoot);
    this.snapshotEngine = new MerkleSnapshotEngine(projectRoot);
    this.consensusGate = new BayesianConsensusGate(projectRoot);
    this.astAnchor = new AstStructuralAnchor();
    this.causalEngine = new CausalInferenceEngine(path.join(this.rootDir, 'logs', sessionId, 'timeline.jsonl'));
    this.backpressure = new ResourceBackpressureController();
    this.contextOrchestrator = new ContextOrchestrator(projectRoot);
    this.browserEngine = new BrowserToolExecutionEngine();
    this.domSnapshotter = new DomSnapshotter();
    this.synapseEngine = new VisualSynapseEngine(this);
    this.swarmController = new SwarmController(this);
    this.senateGate = new SenateGate(this);
    this.mcpMatchmaker = new McpMatchmakerEngine(this);
    this.mcpShadowFS = new McpShadowFSGate(projectRoot);
    this.mcpAuthVault = new McpAuthVault();
    this.modelRouter = new ModelRouterEngine(this);
    this.inquisitor = new InquisitorAgent(this);
    this.contextCompression = new ContextCompressionEngine();

    this.privacyGate = new PrivacySanctuaryGate();
    this.diffPrivacy = new DifferentialPrivacyEngine();
    this.privacyLedger = new ForensicPrivacyLedger();
    this.lock = new AsyncLock();
  }

  public async init(): Promise<void> {
    // Reconciler doesn't have init, skipping.
    await this.contextOrchestrator.init();
  }

  public getRootDir(): string {
    return this.rootDir;
  }

  public async captureSnapshot(): Promise<string> {
    return this.snapshotEngine.captureSnapshot();
  }

  public async rollbackTo(hash: string): Promise<void> {
    await this.snapshotEngine.revertTo(hash);
  }

  public calculateConsensus(votes: Vote[], domain: string = 'logic') {
    return this.consensusGate.calculateTruthScore(votes, domain);
  }

  public async getAstFingerprint(filePath: string, line: number): Promise<AstFingerprint | null> {
    return this.astAnchor.getFingerprint(filePath, line);
  }

  public async findNodeByFingerprint(filePath: string, fp: AstFingerprint): Promise<number | null> {
    return this.astAnchor.findNodeByFingerprint(filePath, fp);
  }

  public async waitIfOverloaded(): Promise<void> {
    await this.backpressure.waitIfOverloaded();
  }

  // --- Phase 7: Omniview (Visual & Contextual) ---

  public async hydrateTaskContext(task: ActiveTask): Promise<void> {
    await this.contextOrchestrator.hydrateActiveTask(task);
  }

  public async recordArchitectureDecision(adr: ADR): Promise<void> {
    await this.contextOrchestrator.recordADR(adr);
  }

  public async getContextSnapshot(): Promise<Record<string, unknown>> {
    return this.contextOrchestrator.getContextSnapshot();
  }

  public async executeBrowserAction(action: BrowserAction): Promise<unknown> {
    return this.browserEngine.execute(action);
  }

  public async getVisualDomSnapshot(): Promise<DomNode[]> {
    const page = await this.browserEngine.getPage();
    return this.domSnapshotter.captureSnapshot(page);
  }

  public async findSourceForVisualNode(filePath: string, node: DomNode): Promise<SynapseLink | null> {
    return this.synapseEngine.findSourceForDomNode(filePath, node);
  }

  // --- Phase 8: HiveMind (Swarm & Senate) ---

  public registerSwarmAgent(agent: BaseAgent): void {
    this.swarmController.registerAgent(agent);
  }

  public async runSwarmTask(task: string): Promise<void> {
    await this.swarmController.executeSwarmTask(task);
  }

  public async requestSenateApproval(changeId: string, quorum: number = 2): Promise<boolean> {
    return this.senateGate.requestApproval(changeId, quorum);
  }

  public submitSenateVote(sessionId: string, verdict: Verdict): void {
    this.senateGate.recordVote(sessionId, verdict);
  }

  public async initBrowser(headless: boolean = true): Promise<void> {
    await this.browserEngine.init(headless);
  }

  public async closeBrowser(): Promise<void> {
    await this.browserEngine.close();
  }

  // --- Phase 10: Singularity-Prime (MCP) ---

  public async optimizeMcpEcosystem(): Promise<void> {
    await this.mcpMatchmaker.analyzeProjectAndDeploy();
  }

  public async secureMcpRead(filePath: string): Promise<string> {
    return this.mcpShadowFS.secureRead(filePath);
  }

  public getMcpVault(): McpAuthVault {
    return this.mcpAuthVault;
  }

  // --- Phase 11: Genetic Singularity (Otonom Evrim) ---

  public async getOptimizedModel(taskType: 'CODE' | 'RESEARCH' | 'SECURITY'): Promise<string> {
    return this.modelRouter.routeTask(taskType);
  }

  public async updateModelPerformance(modelId: string, success: boolean, latency: number): Promise<void> {
    await this.modelRouter.updatePerformance(modelId, success, latency);
  }

  public async compressContext(context: string): Promise<string> {
    return this.contextCompression.compress(context);
  }

  // --- Phase 12: Sovereign Privacy (Cam Duvar) ---

  public async secureTransit(payload: string, destination: string): Promise<string> {
    const sanitized = await this.privacyGate.isolateContext(payload);
    this.privacyLedger.recordExport('shared-memory', destination, payload.length);
    return sanitized;
  }

  public anonymizeTelemetry(metrics: Record<string, unknown>): Record<string, unknown> {
    // Tip güvenliği için unknown cast kullanıldı
    const result = this.diffPrivacy.anonymizeModelMetrics(metrics as unknown as ModelMetrics);
    return result as unknown as Record<string, unknown>;
  }

  public getPrivacyAudit(): string[] {
    return this.privacyLedger.getFullAuditTrail();
  }

  public getPrivacyLedger(): ForensicPrivacyLedger {
    return this.privacyLedger;
  }


  // --- Kalıcılık Katmanı (Persistence) ---

  public async saveModelMetrics(metrics: Record<string, unknown>[]): Promise<void> {
    const metricsPath = path.join(this.rootDir, 'logs', this.sessionId, 'model_metrics.json');
    const dir = path.dirname(metricsPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2), 'utf-8');
  }

  public async loadModelMetrics(): Promise<Record<string, unknown>[] | null> {
    const metricsPath = path.join(this.rootDir, 'logs', this.sessionId, 'model_metrics.json');
    try {
      const content = await fs.readFile(metricsPath, 'utf-8');
      return JSON.parse(content);
    } catch (_e) {
      return null;
    }
  }

  // --- Temel Durum ve Log Yönetimi (Restored Core) ---

  public async getState(): Promise<PipelineState> {
    const statePath = path.join(this.rootDir, 'logs', this.sessionId, 'state.json');
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      return JSON.parse(content);
    } catch (_e) {
      return {
        userTask: '',
        pipelineStatus: 'idle',
        completedAgents: [],
        filesCreated: [],
        knownIssues: []
      };
    }
  }

  public async updateState(delta: Partial<PipelineState>): Promise<void> {
    await this.lock.acquire('state', async () => {
      const currentState = await this.getState();
      const newState = { ...currentState, ...delta };
      
      // Arrays merge (completedAgents, filesCreated)
      if (delta.completedAgents) {
        newState.completedAgents = Array.from(new Set([...currentState.completedAgents, ...delta.completedAgents]));
      }
      if (delta.filesCreated) {
        newState.filesCreated = Array.from(new Set([...currentState.filesCreated, ...delta.filesCreated]));
      }

      const statePath = path.join(this.rootDir, 'logs', this.sessionId, 'state.json');
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(statePath, JSON.stringify(newState, null, 2), 'utf-8');
    });
  }

  public async appendLog(agent: string, message: string, metadata: Record<string, unknown> = {}): Promise<void> {
    const logPath = path.join(this.rootDir, 'logs', this.sessionId, 'timeline.jsonl');
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      agent,
      message,
      ...metadata
    }) + '\n';
    
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, entry, 'utf-8');
  }

  public async readLogTail(limit: number = 20): Promise<Record<string, unknown>[]> {
    const logPath = path.join(this.rootDir, 'logs', this.sessionId, 'timeline.jsonl');
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.slice(-limit).map(l => JSON.parse(l));
    } catch (_e) {
      return [];
    }
  }

  public async getTimeline(): Promise<Record<string, unknown>[]> {
    return this.readLogTail(1000);
  }

  public async writeAgentOutput(agent: string, filename: string, content: string): Promise<string[]> {
    const outputPath = path.join(this.rootDir, 'logs', this.sessionId, filename);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, 'utf-8');
    
    await this.appendLog(agent, `Output generated: ${filename}`, { file: filename });
    return [filename];
  }

  public async readAgentOutput(filename: string): Promise<string> {
    const outputPath = path.join(this.rootDir, 'logs', this.sessionId, filename);
    try {
      return await fs.readFile(outputPath, 'utf-8');
    } catch (_e) {
      return '';
    }
  }

  public async readMultipleOutputs(filenames: string[]): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    for (const f of filenames) {
        results[f] = await this.readAgentOutput(f);
    }
    return results;
  }

  public async reset(): Promise<void> {
    const sessionDir = path.join(this.rootDir, 'logs', this.sessionId);
    await fs.rm(sessionDir, { recursive: true, force: true });
  }

  public async clean(): Promise<void> {
    await fs.rm(this.rootDir, { recursive: true, force: true });
  }

  public async getRelevantContext(agent: string | { role: string }, _task: string): Promise<Record<string, string>> {
    const role = typeof agent === 'string' ? agent : agent.role;
    const state = await this.getState();
    const logs = await this.readLogTail(10);
    return {
      [`${role}_context`]: JSON.stringify(state ?? {}).slice(0, 2000),
      recent_logs: JSON.stringify(logs),
    };
  }
}
