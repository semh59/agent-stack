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
exports.SharedMemory = void 0;
const MemoryBankReconciler_1 = require("./memory/MemoryBankReconciler");
const AnnotationManager_1 = require("./AnnotationManager");
const ReasoningTracer_1 = require("./ReasoningTracer");
const MerkleSnapshotEngine_1 = require("./MerkleSnapshotEngine");
const BayesianConsensusGate_1 = require("./BayesianConsensusGate");
const AstStructuralAnchor_1 = require("./AstStructuralAnchor");
const CausalInferenceEngine_1 = require("./CausalInferenceEngine");
const ResourceBackpressureController_1 = require("./ResourceBackpressureController");
const ContextOrchestrator_1 = require("./ContextOrchestrator");
const BrowserToolExecutionEngine_1 = require("./BrowserToolExecutionEngine");
const DomSnapshotter_1 = require("./DomSnapshotter");
const VisualSynapseEngine_1 = require("./VisualSynapseEngine");
const SwarmController_1 = require("./SwarmController");
const SenateGate_1 = require("./SenateGate");
const McpMatchmakerEngine_1 = require("./mcp/McpMatchmakerEngine");
const McpShadowFSGate_1 = require("./mcp/McpShadowFSGate");
const McpAuthVault_1 = require("./mcp/McpAuthVault");
const ModelRouterEngine_1 = require("./genetic/ModelRouterEngine");
const InquisitorAgent_1 = require("./genetic/InquisitorAgent");
const ContextCompressionEngine_1 = require("./genetic/ContextCompressionEngine");
const PrivacySanctuaryGate_1 = require("./privacy/PrivacySanctuaryGate");
const DifferentialPrivacyEngine_1 = require("./privacy/DifferentialPrivacyEngine");
const ForensicPrivacyLedger_1 = require("./privacy/ForensicPrivacyLedger");
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs/promises"));
const async_lock_1 = __importDefault(require("async-lock"));
/**
 * SharedMemory: The central high-performance state layer for Alloy.
 * Hardened with namespace isolation, transactional integrity, and Phase 7 visual-context aware memory.
 */
class SharedMemory {
    sessionId;
    rootDir;
    reconciler;
    annotationManager;
    reasoningTracer;
    snapshotEngine;
    consensusGate;
    astAnchor;
    causalEngine;
    backpressure;
    contextOrchestrator;
    browserEngine;
    domSnapshotter;
    synapseEngine;
    swarmController;
    senateGate;
    mcpMatchmaker;
    mcpShadowFS;
    mcpAuthVault;
    modelRouter;
    inquisitor;
    contextCompression;
    privacyGate;
    diffPrivacy;
    privacyLedger;
    lock;
    constructor(projectRoot, sessionId = 'default') {
        this.sessionId = sessionId;
        this.rootDir = path.resolve(projectRoot, '.ai-company');
        this.reconciler = new MemoryBankReconciler_1.MemoryBankReconciler(projectRoot);
        this.annotationManager = new AnnotationManager_1.AnnotationManager(projectRoot);
        this.reasoningTracer = new ReasoningTracer_1.ReasoningTracer(projectRoot);
        this.snapshotEngine = new MerkleSnapshotEngine_1.MerkleSnapshotEngine(projectRoot);
        this.consensusGate = new BayesianConsensusGate_1.BayesianConsensusGate(projectRoot);
        this.astAnchor = new AstStructuralAnchor_1.AstStructuralAnchor();
        this.causalEngine = new CausalInferenceEngine_1.CausalInferenceEngine(path.join(this.rootDir, 'logs', sessionId, 'timeline.jsonl'));
        this.backpressure = new ResourceBackpressureController_1.ResourceBackpressureController();
        this.contextOrchestrator = new ContextOrchestrator_1.ContextOrchestrator(projectRoot);
        this.browserEngine = new BrowserToolExecutionEngine_1.BrowserToolExecutionEngine();
        this.domSnapshotter = new DomSnapshotter_1.DomSnapshotter();
        this.synapseEngine = new VisualSynapseEngine_1.VisualSynapseEngine(this);
        this.swarmController = new SwarmController_1.SwarmController(this);
        this.senateGate = new SenateGate_1.SenateGate(this);
        this.mcpMatchmaker = new McpMatchmakerEngine_1.McpMatchmakerEngine(this);
        this.mcpShadowFS = new McpShadowFSGate_1.McpShadowFSGate(projectRoot);
        this.mcpAuthVault = new McpAuthVault_1.McpAuthVault();
        this.modelRouter = new ModelRouterEngine_1.ModelRouterEngine(this);
        this.inquisitor = new InquisitorAgent_1.InquisitorAgent(this);
        this.contextCompression = new ContextCompressionEngine_1.ContextCompressionEngine();
        this.privacyGate = new PrivacySanctuaryGate_1.PrivacySanctuaryGate();
        this.diffPrivacy = new DifferentialPrivacyEngine_1.DifferentialPrivacyEngine();
        this.privacyLedger = new ForensicPrivacyLedger_1.ForensicPrivacyLedger();
        this.lock = new async_lock_1.default();
    }
    async init() {
        await fs.mkdir(this.rootDir, { recursive: true });
        await this.contextOrchestrator.init();
    }
    getRootDir() {
        return this.rootDir;
    }
    async captureSnapshot() {
        return this.snapshotEngine.captureSnapshot();
    }
    async rollbackTo(hash) {
        await this.snapshotEngine.revertTo(hash);
    }
    calculateConsensus(votes, domain = 'logic') {
        return this.consensusGate.calculateTruthScore(votes, domain);
    }
    async getAstFingerprint(filePath, line) {
        return this.astAnchor.getFingerprint(filePath, line);
    }
    async findNodeByFingerprint(filePath, fp) {
        return this.astAnchor.findNodeByFingerprint(filePath, fp);
    }
    async waitIfOverloaded() {
        await this.backpressure.waitIfOverloaded();
    }
    // --- Phase 7: Omniview (Visual & Contextual) ---
    async hydrateTaskContext(task) {
        await this.contextOrchestrator.hydrateActiveTask(task);
    }
    async recordArchitectureDecision(adr) {
        await this.contextOrchestrator.recordADR(adr);
    }
    async getContextSnapshot() {
        return this.contextOrchestrator.getContextSnapshot();
    }
    async executeBrowserAction(action) {
        return this.browserEngine.execute(action);
    }
    async getVisualDomSnapshot() {
        const page = await this.browserEngine.getPage();
        return this.domSnapshotter.captureSnapshot(page);
    }
    async findSourceForVisualNode(filePath, node) {
        return this.synapseEngine.findSourceForDomNode(filePath, node);
    }
    // --- Phase 8: HiveMind (Swarm & Senate) ---
    registerSwarmAgent(agent) {
        this.swarmController.registerAgent(agent);
    }
    async runSwarmTask(task) {
        await this.swarmController.executeSwarmTask(task);
    }
    async requestSenateApproval(changeId, quorum = 2) {
        return this.senateGate.requestApproval(changeId, quorum);
    }
    submitSenateVote(sessionId, verdict) {
        this.senateGate.recordVote(sessionId, verdict);
    }
    async initBrowser(headless = true) {
        await this.browserEngine.init(headless);
    }
    async closeBrowser() {
        await this.browserEngine.close();
    }
    // --- Phase 10: Singularity-Prime (MCP) ---
    async optimizeMcpEcosystem() {
        await this.mcpMatchmaker.analyzeProjectAndDeploy();
    }
    async secureMcpRead(filePath) {
        return this.mcpShadowFS.secureRead(filePath);
    }
    getMcpVault() {
        return this.mcpAuthVault;
    }
    // --- Phase 11: Genetic Singularity (Otonom Evrim) ---
    async getOptimizedModel(taskType) {
        return this.modelRouter.routeTask(taskType);
    }
    async updateModelPerformance(modelId, success, latency) {
        await this.modelRouter.updatePerformance(modelId, success, latency);
    }
    async compressContext(context) {
        return this.contextCompression.compress(context);
    }
    // --- Phase 12: Alloy Privacy (Glass Wall) ---
    async secureTransit(payload, destination) {
        const sanitized = await this.privacyGate.isolateContext(payload);
        this.privacyLedger.recordExport('shared-memory', destination, payload.length);
        return sanitized;
    }
    anonymizeTelemetry(metrics) {
        // Tip güvenliği için unknown cast kullanıldı
        const result = this.diffPrivacy.anonymizeModelMetrics(metrics);
        return result;
    }
    getPrivacyAudit() {
        return this.privacyLedger.getFullAuditTrail();
    }
    getPrivacyLedger() {
        return this.privacyLedger;
    }
    // --- Kalıcılık Katmanı (Persistence) ---
    async saveModelMetrics(metrics) {
        const metricsPath = path.join(this.rootDir, 'logs', this.sessionId, 'model_metrics.json');
        const dir = path.dirname(metricsPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2), 'utf-8');
    }
    async loadModelMetrics() {
        const metricsPath = path.join(this.rootDir, 'logs', this.sessionId, 'model_metrics.json');
        try {
            const content = await fs.readFile(metricsPath, 'utf-8');
            return JSON.parse(content);
        }
        catch (_e) {
            return null;
        }
    }
    // --- Temel Durum ve Log Yönetimi (Restored Core) ---
    async getState() {
        const statePath = path.join(this.rootDir, 'logs', this.sessionId, 'state.json');
        try {
            const content = await fs.readFile(statePath, 'utf-8');
            return JSON.parse(content);
        }
        catch (_e) {
            return {
                userTask: '',
                pipelineStatus: 'idle',
                currentAgent: null,
                completedAgents: [],
                filesCreated: [],
                knownIssues: []
            };
        }
    }
    async updateState(delta) {
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
    async appendLog(agent, message, metadata = {}) {
        await this.lock.acquire('logs', async () => {
            const logPath = path.join(this.rootDir, 'logs', this.sessionId, 'timeline.jsonl');
            const entry = JSON.stringify({
                timestamp: new Date().toISOString(),
                agent,
                message,
                ...metadata
            }) + '\n';
            await fs.mkdir(path.dirname(logPath), { recursive: true });
            await fs.appendFile(logPath, entry, 'utf-8');
        });
    }
    async readLogTail(limit = 20) {
        const logPath = path.join(this.rootDir, 'logs', this.sessionId, 'timeline.jsonl');
        try {
            const content = await fs.readFile(logPath, 'utf-8');
            const lines = content.trim().split('\n');
            return lines.slice(-limit).map(l => JSON.parse(l));
        }
        catch (_e) {
            return [];
        }
    }
    async getTimeline() {
        return this.readLogTail(1000);
    }
    async writeAgentOutput(agent, filename, content) {
        return await this.lock.acquire(`output:${filename}`, async () => {
            const outputPath = path.join(this.rootDir, 'logs', this.sessionId, filename);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, content, 'utf-8');
            await this.appendLog(agent, `Output generated: ${filename}`, { file: filename });
            return [filename];
        });
    }
    async readAgentOutput(filename) {
        const outputPath = path.join(this.rootDir, 'logs', this.sessionId, filename);
        try {
            return await fs.readFile(outputPath, 'utf-8');
        }
        catch (_e) {
            return null;
        }
    }
    async readMultipleOutputs(filenames) {
        const results = {};
        for (const f of filenames) {
            const content = await this.readAgentOutput(f);
            if (content !== null) {
                results[f] = content;
            }
        }
        return results;
    }
    async reset() {
        const sessionDir = path.join(this.rootDir, 'logs', this.sessionId);
        await fs.rm(sessionDir, { recursive: true, force: true });
    }
    async clean() {
        await fs.rm(this.rootDir, { recursive: true, force: true });
    }
    async getRelevantContext(agent, _task) {
        const role = typeof agent === 'string' ? agent : agent.role;
        const state = await this.getState();
        const logs = await this.readLogTail(10);
        return {
            [`${role}_context`]: JSON.stringify(state ?? {}).slice(0, 2000),
            recent_logs: JSON.stringify(logs),
        };
    }
    // --- Restored Missing Methods (from Audit) ---
    async getSummary() {
        const state = await this.getState();
        return state.userTask || '';
    }
    async setSummary(summary) {
        await this.updateState({ userTask: summary });
    }
    async getPlan() {
        const state = await this.getState();
        return state.architecture || ''; // architecture often stores the high-level plan
    }
    async setPlan(plan) {
        await this.updateState({ architecture: plan });
    }
    async getJournal() {
        return this.getTimeline();
    }
    async appendJournal(agent, message, metadata) {
        await this.appendLog(agent, message, metadata);
    }
    async getScopedValue(scope, key) {
        const state = (await this.getState());
        return state[`${scope}_${key}`];
    }
    async setScopedValue(scope, key, value) {
        await this.updateState({ [`${scope}_${key}`]: value });
    }
}
exports.SharedMemory = SharedMemory;
//# sourceMappingURL=shared-memory.js.map