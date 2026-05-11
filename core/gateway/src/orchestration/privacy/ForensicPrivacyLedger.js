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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForensicPrivacyLedger = void 0;
const crypto = __importStar(require("node:crypto"));
const MAX_LEDGER_ENTRIES = 1000;
/**
 * ForensicPrivacyLedger: The Immutable Truth.
 * Records all data export attempts in a Merkle-Hashed audit trail.
 */
class ForensicPrivacyLedger {
    ledger = [];
    /**
     * recordExport: Generates a tamper-proof entry for a data export event.
     */
    recordExport(agentId, destination, byteSize) {
        const timestamp = new Date().toISOString();
        const entry = `${timestamp} | FROM: ${agentId} | TO: ${destination} | SIZE: ${byteSize} bytes`;
        const hash = crypto.createHash('sha256').update(entry).digest('hex');
        const signedEntry = `[${hash.slice(0, 8)}] ${entry}`;
        // Evict oldest if cap reached
        if (this.ledger.length >= MAX_LEDGER_ENTRIES) {
            this.ledger.shift();
        }
        this.ledger.push(signedEntry);
        console.log(`[PrivacyLedger] Forensic Entry Recorded: ${signedEntry}`);
        return hash;
    }
    getFullAuditTrail() {
        return this.ledger;
    }
}
exports.ForensicPrivacyLedger = ForensicPrivacyLedger;
//# sourceMappingURL=ForensicPrivacyLedger.js.map