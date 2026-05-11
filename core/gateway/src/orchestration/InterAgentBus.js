"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterAgentBus = void 0;
const node_events_1 = require("node:events");
const node_crypto_1 = require("node:crypto");
/**
 * InterAgentBus: The IAMB Protocol.
 * High-performance event bus for decentralized agent communication.
 */
class InterAgentBus extends node_events_1.EventEmitter {
    static instance;
    messageLog = [];
    constructor() {
        super();
        this.setMaxListeners(100);
    }
    static getInstance() {
        if (!InterAgentBus.instance) {
            InterAgentBus.instance = new InterAgentBus();
        }
        return InterAgentBus.instance;
    }
    /**
     * publish: Broadcasts or targets a message to the agent mesh.
     */
    publish(msg) {
        const message = {
            ...msg,
            id: (0, node_crypto_1.randomUUID)(), // SECURE ID
            timestamp: Date.now()
        };
        this.messageLog.push(message);
        if (this.messageLog.length > 1000)
            this.messageLog.shift();
        // Specific agent or all
        if (message.to === 'all') {
            this.emit('broadcast', message);
        }
        else {
            this.emit(`direct:${message.to}`, message);
        }
        return message.id;
    }
    /**
     * getRecentHistory: Returns limited history to prevent OOM/Performance lag.
     */
    getRecentHistory(limit = 100) {
        return this.messageLog.slice(-limit);
    }
}
exports.InterAgentBus = InterAgentBus;
//# sourceMappingURL=InterAgentBus.js.map