"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwarmController = void 0;
const InterAgentBus_1 = require("./InterAgentBus");
/**
 * SwarmController: The "Queen" of the HiveMind.
 * Manages specialized agents and synchronizes their output via CFRS merging.
 */
class SwarmController {
    memory;
    agents = new Map();
    bus;
    constructor(memory) {
        this.memory = memory;
        this.bus = InterAgentBus_1.InterAgentBus.getInstance();
        this.initBusListeners();
    }
    initBusListeners() {
        this.bus.on('broadcast', (msg) => {
            console.log(`[SwarmController] Received broadcast from ${msg.from}: ${msg.type}`);
        });
    }
    registerAgent(agent) {
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
    async executeSwarmTask(task) {
        // 1. Snapshot current state before swarm activity
        const preSnapshot = await this.memory.captureSnapshot();
        // 2. Parallel Dispatch with individual error isolation
        const results = await Promise.allSettled(Array.from(this.agents.values()).map(async (agent) => {
            try {
                return await agent.execute(task);
            }
            catch (err) {
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
    getAgents() {
        return Array.from(this.agents.values());
    }
}
exports.SwarmController = SwarmController;
//# sourceMappingURL=SwarmController.js.map