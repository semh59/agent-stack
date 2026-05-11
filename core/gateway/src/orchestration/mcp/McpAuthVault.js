"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpAuthVault = void 0;
const InterAgentBus_1 = require("../InterAgentBus");
/**
 * McpAuthVault: The Alloy Credential Manager.
 * Securely stores and authorizes API keys for Group B MCP servers.
 */
class McpAuthVault {
    vault = new Map();
    bus;
    constructor() {
        this.bus = InterAgentBus_1.InterAgentBus.getInstance();
    }
    /**
     * storeCredential: Saves a credential after user/senate validation.
     */
    async storeCredential(serverName, keys, authorizedBy) {
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
    async authorizeInstallation(serverName, _requiredQuorum = 2) {
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
            const voteHandler = (msg) => {
                const m = msg;
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
    getKeys(serverName) {
        const cred = this.vault.get(serverName);
        return cred ? { ...cred.keys } : null;
    }
}
exports.McpAuthVault = McpAuthVault;
//# sourceMappingURL=McpAuthVault.js.map