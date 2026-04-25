import type { SharedMemory } from './shared-memory';
import { InterAgentBus } from './InterAgentBus';
import type { AgentMessage } from './InterAgentBus';

export interface Verdict {
  agentId: string;
  approved: boolean;
  reason: string;
  timestamp: number;
}

/**
 * SenateGate: The Consensus Guard.
 * Implements the "Four-Eyes Rule" digitally. 
 * Prevents writes unless a quorum of specialized agents approves.
 */
export class SenateGate {
  private activeVotingSessions: Map<string, Verdict[]> = new Map();
  private bus: InterAgentBus;

  constructor(private memory: SharedMemory) {
    this.bus = InterAgentBus.getInstance();
    this.initBusListeners();
  }

  private initBusListeners() {
    this.bus.on('broadcast', (msg: AgentMessage) => {
      if (msg.type === 'VOTE_REQUEST') {
        const sessionId = msg.payload.sessionId as string;
        if (!this.activeVotingSessions.has(sessionId)) {
          this.activeVotingSessions.set(sessionId, []);
        }
      }
    });

    // Dynamic direct voting listener
    this.bus.on('direct:senate', (msg: AgentMessage) => {
      if (msg.type === 'VOTE_REQUEST' && msg.payload.verdict) {
         this.recordVote(msg.payload.sessionId as string, msg.payload.verdict as Verdict);
      }
    });
  }

  /**
   * requestApproval: Blocks until consensus is reached or timeout.
   */
  public async requestApproval(changeId: string, quorum: number = 2): Promise<boolean> {
    console.log(`[SenateGate] Quorum Request for Change: ${changeId} (Required: ${quorum})`);
    
    // Broadcast vote request to all agents
    this.bus.publish({
      from: 'senate',
      to: 'all',
      type: 'VOTE_REQUEST',
      payload: { sessionId: changeId },
      priority: 'high'
    });

    // Poll for consensus
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        const votes = this.activeVotingSessions.get(changeId) || [];
        const approvals = votes.filter(v => v.approved).length;
        
        if (approvals >= quorum) {
          clearInterval(interval);
          this.activeVotingSessions.delete(changeId); // LEAK FIX: Clear session
          console.log(`[SenateGate] QUORUM REACHED for ${changeId}. Proceeding.`);
          resolve(true);
        } else if (attempts++ > 10) { // Safety timeout
          clearInterval(interval);
          this.activeVotingSessions.delete(changeId); // LEAK FIX: Clear session
          console.log(`[SenateGate] TIMEOUT for ${changeId}. Quorum failed.`);
          resolve(false);
        }
      }, 500);
    });
  }

  public recordVote(sessionId: string, verdict: Verdict) {
    const session = this.activeVotingSessions.get(sessionId) || [];
    session.push(verdict);
    this.activeVotingSessions.set(sessionId, session);
  }
}
