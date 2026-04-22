import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export interface AgentMessage {
  id: string;
  from: string;
  to: 'all' | string;
  type: 'TASK_REQUEST' | 'VOTE_REQUEST' | 'VOTE_CAST' | 'VOTE_COMPLETED' | 'AUDIT_REQUEST' | 'TELEMETRY' | 'ERROR' | 'LOG';
  payload: Record<string, unknown>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
}

/**
 * InterAgentBus: The IAMB Protocol.
 * High-performance event bus for decentralized agent communication.
 */
export class InterAgentBus extends EventEmitter {
  private static instance: InterAgentBus;
  private messageLog: AgentMessage[] = [];

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): InterAgentBus {
    if (!InterAgentBus.instance) {
      InterAgentBus.instance = new InterAgentBus();
    }
    return InterAgentBus.instance;
  }

  /**
   * publish: Broadcasts or targets a message to the agent mesh.
   */
  public publish(msg: Omit<AgentMessage, 'id' | 'timestamp'>): string {
    const message: AgentMessage = {
      ...msg,
      id: randomUUID(), // SECURE ID
      timestamp: Date.now()
    };

    this.messageLog.push(message);
    if (this.messageLog.length > 1000) this.messageLog.shift();

    // Specific agent or all
    if (message.to === 'all') {
      this.emit('broadcast', message);
    } else {
      this.emit(`direct:${message.to}`, message);
    }

    return message.id;
  }

  /**
   * getRecentHistory: Returns limited history to prevent OOM/Performance lag.
   */
  public getRecentHistory(limit: number = 100): AgentMessage[] {
    return this.messageLog.slice(-limit);
  }
}
