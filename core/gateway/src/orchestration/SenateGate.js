"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SenateGate = void 0;
const InterAgentBus_1 = require("./InterAgentBus");
/**
 * SenateGate: The Consensus Guard.
 * Implements the "Four-Eyes Rule" digitally.
 * Prevents writes unless a quorum of specialized agents approves.
 */
class SenateGate {
    memory;
    activeVotingSessions = new Map();
    bus;
    constructor(memory) {
        this.memory = memory;
        this.bus = InterAgentBus_1.InterAgentBus.getInstance();
        this.initBusListeners();
    }
    initBusListeners() {
        this.bus.on('broadcast', (msg) => {
            if (msg.type === 'VOTE_REQUEST') {
                const sessionId = msg.payload.sessionId;
                if (!this.activeVotingSessions.has(sessionId)) {
                    this.activeVotingSessions.set(sessionId, []);
                }
            }
        });
        // Dynamic direct voting listener
        this.bus.on('direct:senate', (msg) => {
            if (msg.type === 'VOTE_REQUEST' && msg.payload.verdict) {
                this.recordVote(msg.payload.sessionId, msg.payload.verdict);
            }
        });
    }
    /**
     * requestApproval: Blocks until consensus is reached or timeout.
     */
    async requestApproval(changeId, quorum = 2) {
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
                }
                else if (attempts++ > 10) { // Safety timeout
                    clearInterval(interval);
                    this.activeVotingSessions.delete(changeId); // LEAK FIX: Clear session
                    console.log(`[SenateGate] TIMEOUT for ${changeId}. Quorum failed.`);
                    resolve(false);
                }
            }, 500);
        });
    }
    recordVote(sessionId, verdict) {
        const session = this.activeVotingSessions.get(sessionId) || [];
        session.push(verdict);
        this.activeVotingSessions.set(sessionId, session);
    }
}
exports.SenateGate = SenateGate;
//# sourceMappingURL=SenateGate.js.map