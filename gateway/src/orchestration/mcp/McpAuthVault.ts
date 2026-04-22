import { InterAgentBus } from '../InterAgentBus';

export interface McpCredential {
  serverName: string;
  keys: Record<string, string>;
  authorizedBy: string[]; // List of agent IDs who voted YES
  timestamp: number;
}

/**
 * McpAuthVault: The Sovereign Credential Manager.
 * Securely stores and authorizes API keys for Group B MCP servers.
 */
export class McpAuthVault {
  private vault: Map<string, McpCredential> = new Map();
  private bus: InterAgentBus;

  constructor() {
    this.bus = InterAgentBus.getInstance();
  }

  /**
   * storeCredential: Saves a credential after user/senate validation.
   */
  public async storeCredential(serverName: string, keys: Record<string, string>, authorizedBy: string[]) {
    console.log(`[McpAuthVault] Securing Credentials for ${serverName}...`);
    this.vault.set(serverName, {
      serverName,
      keys,
      authorizedBy,
      timestamp: Date.now()
    });
  }

  /**
   * authorizeInstallation: Links with SenateGate to request multi-agent quorum.
   */
  public async authorizeInstallation(serverName: string, _requiredQuorum: number = 2): Promise<boolean> {
    console.log(`[McpAuthVault] Initiating Senate Quorum for ${serverName} installation...`);
    
    // Broadcast to the swarm
    this.bus.publish({
      from: 'auth-vault',
      to: 'senate',
      type: 'VOTE_REQUEST',
      payload: { 
        sessionId: `install-${serverName}`,
        reason: `Credential validation for MCP: ${serverName}`
      },
      priority: 'high'
    });

    // Senato oylamasını bekle (Gerçek Bus Entegrasyonu)
    return new Promise((resolve) => {
      const voteHandler = (msg: unknown) => {
        const m = msg as { type?: string; payload?: { sessionId?: string; result?: string } };
        if (m.type === 'VOTE_COMPLETED' && m.payload?.sessionId === `install-${serverName}`) {
          this.bus.off('broadcast', voteHandler);
          resolve(m.payload.result === 'APPROVED');
        }
      };
      
      this.bus.on('broadcast', voteHandler);
      
      // Zaman aşımı (Timeout) - 60 saniye
      setTimeout(() => {
        this.bus.off('broadcast', voteHandler);
        resolve(false);
      }, 60000);
    });
  }

  public getKeys(serverName: string): Record<string, string> | null {
    const cred = this.vault.get(serverName);
    return cred ? { ...cred.keys } : null;
  }
}
