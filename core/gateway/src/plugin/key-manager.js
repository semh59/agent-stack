"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyManager = void 0;
const node_crypto_1 = require("node:crypto");
const node_machine_id_1 = __importDefault(require("node-machine-id"));
const node_os_1 = __importDefault(require("node:os"));
const { machineIdSync } = node_machine_id_1.default;
class KeyManager {
    masterKey;
    currentMachineId;
    constructor() {
        this.currentMachineId = this.deriveMachineId();
        const appSalt = process.env.ALLOY_SALT ?? 'ag-default-salt-v3';
        // Support CI environment or manual master key override
        if (process.env.ALLOY_MASTER_KEY) {
            this.masterKey = Buffer.from(process.env.ALLOY_MASTER_KEY, 'hex');
        }
        else {
            this.masterKey = (0, node_crypto_1.scryptSync)(this.currentMachineId, appSalt, 32);
        }
    }
    deriveMachineId() {
        try {
            return machineIdSync(true);
        }
        catch {
            return `fallback-${node_os_1.default.hostname()}-${process.pid}`;
        }
    }
    /**
     * Encrypt an object using the key hierarchy.
     */
    encrypt(data) {
        const iv = (0, node_crypto_1.randomBytes)(12);
        const json = JSON.stringify(data);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', this.masterKey, iv);
        const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
            version: 3,
            keyMeta: {
                keyId: `kg_${Date.now()}_${(0, node_crypto_1.randomBytes)(6).toString('hex')}`,
                algorithm: 'AES-256-GCM',
                createdAt: new Date().toISOString(),
                rotatedAt: null,
                machineId: this.currentMachineId
            },
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            payload: encrypted.toString('base64')
        };
    }
    /**
     * Decrypt an encrypted payload.
     */
    decrypt(encrypted) {
        const iv = Buffer.from(encrypted.iv, 'base64');
        const tag = Buffer.from(encrypted.tag, 'base64');
        const payload = Buffer.from(encrypted.payload, 'base64');
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', this.masterKey, iv, {
            authTagLength: 16
        });
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    }
    /**
     * Helper to check if a content is the new v3 encrypted format.
     */
    static isV3Encrypted(content) {
        if (!content)
            return false;
        try {
            const parsed = JSON.parse(content);
            return parsed.version === 3 && parsed.keyMeta !== undefined && parsed.payload !== undefined;
        }
        catch {
            return false;
        }
    }
    /**
     * ROTATE: Re-encrypt data with a new key and update metadata.
     */
    rotate(encrypted) {
        const data = this.decrypt(encrypted);
        const rotated = this.encrypt(data);
        rotated.keyMeta.rotatedAt = new Date().toISOString();
        return rotated;
    }
    /**
     * EXPORT: Create an encrypted bundle using a passphrase for migration.
     */
    async exportBundle(data, passphrase) {
        if (passphrase.length < 12) {
            throw new Error("Passphrase must be at least 12 characters long for export security.");
        }
        const salt = (0, node_crypto_1.randomBytes)(16);
        const iv = (0, node_crypto_1.randomBytes)(12);
        const key = (0, node_crypto_1.scryptSync)(passphrase, salt, 32);
        const json = JSON.stringify(data);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        const bundle = {
            type: 'Alloy-export-bundle',
            version: 1,
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            payload: encrypted.toString('base64')
        };
        return JSON.stringify(bundle, null, 2);
    }
    /**
     * IMPORT: Restore data from an export bundle using a passphrase.
     */
    async importBundle(bundleJson, passphrase) {
        const bundle = JSON.parse(bundleJson);
        if (bundle.type !== 'Alloy-export-bundle') {
            throw new Error('Invalid export bundle type');
        }
        const salt = Buffer.from(bundle.salt, 'base64');
        const iv = Buffer.from(bundle.iv, 'base64');
        const tag = Buffer.from(bundle.tag, 'base64');
        const payload = Buffer.from(bundle.payload, 'base64');
        const key = (0, node_crypto_1.scryptSync)(passphrase, salt, 32);
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', key, iv, { authTagLength: 16 });
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    }
}
exports.KeyManager = KeyManager;
//# sourceMappingURL=key-manager.js.map