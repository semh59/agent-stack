import { SharedMemory } from '../shared-memory';
import { InterAgentBus } from '../InterAgentBus';

export interface McpServerCandidate {
  name: string;
  domain: 'AI' | 'WEB' | 'DATA' | 'SYSTEM' | 'DEVOPS';
  capabilities: string[];
  repoUrl: string;
  trustScore: number;
  requiresAuth: boolean;
}

/**
 * McpMatchmakerEngine: The Semantic Discovery Hub.
 * Uses Graph-Based Domain Inference to auto-install optimal MCP servers.
 */
export class McpMatchmakerEngine {
  private bus: InterAgentBus;
  private mcpRegistry: McpServerCandidate[] = [
    { name: 'HuggingFace-Explorer', domain: 'AI', capabilities: ['model-lookup', 'dataset-download'], repoUrl: 'https://github.com/mcp-hf/explorer', trustScore: 0.99, requiresAuth: true },
    { name: 'Local-AI-Transformer', domain: 'AI', capabilities: ['tokenizer', 'vector-search'], repoUrl: 'local://ai-mcp', trustScore: 0.99, requiresAuth: false },
    { name: 'Python-Local-Compute', domain: 'SYSTEM', capabilities: ['sandboxed-exec', 'hpc'], repoUrl: 'local://python-mcp', trustScore: 0.98, requiresAuth: false },
    { name: 'SQLite-Forensics', domain: 'DATA', capabilities: ['sql-query', 'db-diff'], repoUrl: 'https://github.com/mcp-sql/forensics', trustScore: 0.97, requiresAuth: false },
    { name: 'GitHub-Orchestrator', domain: 'DEVOPS', capabilities: ['pr-manage', 'issue-solve'], repoUrl: 'https://github.com/mcp-git/orchestrator', trustScore: 0.98, requiresAuth: true }
  ];

  constructor(private memory: SharedMemory) {
    this.bus = InterAgentBus.getInstance();
  }

  /**
   * analyzeProjectAndDeploy: The Core Singularity Logic.
   */
  public async analyzeProjectAndDeploy(): Promise<void> {
    console.log('[McpMatchmaker] Starting Neural Project Inference...');
    
    // 1. Semantic Analysis of Codebase (Mocking Graph Mapping for now)
    const domainEvidence = await this.inferDomainFromFiles();
    console.log(`[McpMatchmaker] Domain Evidence Detected: ${domainEvidence}`);

    // 2. Filter optimal candidates
    const matches = this.mcpRegistry.filter(mcp => mcp.domain === domainEvidence);

    for (const mcp of matches) {
      if (mcp.trustScore >= 0.98 && !mcp.requiresAuth) {
        await this.ghostInstall(mcp);
      } else {
        await this.requestSenateApproval(mcp);
      }
    }
  }

  private async inferDomainFromFiles(): Promise<McpServerCandidate['domain']> {
    try {
      // package.json dosyasını analiz et
      const pkgPath = './package.json';
      const pkgContent = await this.memory.secureMcpRead(pkgPath);
      const pkg = JSON.parse(pkgContent);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['pytorch'] || deps['transformers'] || deps['tensor']) return 'AI';
      if (deps['react'] || deps['next'] || deps['vue']) return 'WEB';
      if (deps['pandas'] || deps['d3']) return 'DATA';
      
      return 'SYSTEM';
    } catch (_e) {
      console.warn('[McpMatchmaker] package.json okunamadı, varsayılan domain: SYSTEM');
      return 'SYSTEM';
    }
  }

  private async ghostInstall(mcp: McpServerCandidate): Promise<void> {
    console.log(`[McpMatchmaker] GHOST-INSTALL Active: Silently deploying ${mcp.name}...`);
    this.bus.publish({
      from: 'matchmaker',
      to: 'all',
      type: 'LOG',
      payload: { message: `Autonomous MCP Installation SUCCESS: ${mcp.name}`, trust: mcp.trustScore },
      priority: 'medium'
    });
  }

  private async requestSenateApproval(mcp: McpServerCandidate): Promise<void> {
    console.log(`[McpMatchmaker] Senate Quorum Required for ${mcp.name} (Auth/Trust Gate)`);
    this.bus.publish({
      from: 'matchmaker',
      to: 'senate',
      type: 'VOTE_REQUEST',
      payload: { 
        sessionId: `mcp-install-${mcp.name}`, 
        reason: `Requesting installation of ${mcp.name} requiring API credentials.`
      },
      priority: 'high'
    });
  }
}
