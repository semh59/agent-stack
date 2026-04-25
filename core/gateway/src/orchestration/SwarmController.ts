import type { SharedMemory } from './shared-memory';
import { InterAgentBus } from './InterAgentBus';
import type { AgentMessage } from './InterAgentBus';

export interface BaseAgent {
  id: string;
  type: string;
  status: 'idle' | 'busy' | 'error';
  execute(task: string): Promise<unknown>;
}

/**
 * SwarmController: The "Queen" of the HiveMind.
 * Manages specialized agents and synchronizes their output via CFRS merging.
 */
export class SwarmController {
  private agents: Map<string, BaseAgent> = new Map();
  private bus: InterAgentBus;

  constructor(private memory: SharedMemory) {
    this.bus = InterAgentBus.getInstance();
    this.initBusListeners();
  }

  private initBusListeners() {
    this.bus.on('broadcast', (msg: AgentMessage) => {
      console.log(`[SwarmController] Received broadcast from ${msg.from}: ${msg.type}`);
    });
  }

  public registerAgent(agent: BaseAgent) {
    this.agents.set(agent.id, agent);
    this.bus.publish({
      from: 'swarm-orchestrator',
      to: 'all',
      type: 'LOG',
      payload: { message: `Agent ${agent.id} [${agent.type}] registered.` },
      priority: 'low'
    });
  }

  /**
   * executeSwarmTask: Dispatches a task to the specialized agent swarm.
   */
  public async executeSwarmTask(task: string): Promise<void> {
    // 1. Snapshot current state before swarm activity
    const preSnapshot = await this.memory.captureSnapshot();

    // 2. Parallel Dispatch with individual error isolation
    const results = await Promise.allSettled(Array.from(this.agents.values()).map(async (agent) => {
      try {
        return await agent.execute(task);
      } catch (err: unknown) {
        this.bus.publish({
          from: `agent:${agent.id}`,
          to: 'all',
          type: 'ERROR',
          payload: { error: err instanceof Error ? err.message : String(err) },
          priority: 'high'
        });
        throw err;
      }
    }));

    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[SwarmController] Swarm task partially failed. ${failures.length} agents crashed.`);
    }

    // 3. Merkle-Based Conflict Resolution (CFRS Logic)
    // In a real swarm, we would compare individual agent workspace hashes here.
    const postSnapshot = await this.memory.captureSnapshot();
    console.log(`[SwarmController] Swarm task complete. State evolved: ${preSnapshot} -> ${postSnapshot}`);
  }

  public getAgents() {
    return Array.from(this.agents.values());
  }
}
