import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import pkg from 'node-machine-id';
const { machineIdSync } = pkg;

export interface KeyMeta {
  keyId: string;
  algorithm: string;
  createdAt: string;
  rotatedAt: string | null;
  machineId: string;
}

export interface EncryptedPayload {
  version: number;
  keyMeta: KeyMeta;
  iv: string;
  tag: string;
  payload: string;
}

export class KeyManager {
  private masterKey: Buffer;
  private currentMachineId: string;

  constructor() {
    this.currentMachineId = this.deriveMachineId();
    const appSalt = process.env.ANTIGRAVITY_SALT ?? 'ag-default-salt-v3';
    
    // Support CI environment or manual master key override
    if (process.env.ANTIGRAVITY_MASTER_KEY) {
      this.masterKey = Buffer.from(process.env.ANTIGRAVITY_MASTER_KEY, 'hex');
    } else {
      this.masterKey = scryptSync(this.currentMachineId, appSalt, 32);
    }
  }

  private deriveMachineId(): string {
    try {
      return machineIdSync(true);
    } catch {
      return `fallback-${require('node:os').hostname()}-${process.pid}`;
    }
  }

  /**
   * Encrypt an object using the key hierarchy.
   */
  encrypt(data: object): EncryptedPayload {
    const iv = randomBytes(12);
    const json = JSON.stringify(data);
    
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      version: 3,
      keyMeta: {
        keyId: `kg_${Date.now()}_${randomBytes(6).toString('hex')}`,
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
  decrypt(encrypted: EncryptedPayload): object {
    const iv = Buffer.from(encrypted.iv, 'base64');
    const tag = Buffer.from(encrypted.tag, 'base64');
    const payload = Buffer.from(encrypted.payload, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv, {
      // @ts-ignore
      authTagLength: 16
    });
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Helper to check if a content is the new v3 encrypted format.
   */
  static isV3Encrypted(content: string): boolean {
    if (!content) return false;
    try {
      const parsed = JSON.parse(content);
      return parsed.version === 3 && parsed.keyMeta !== undefined && parsed.payload !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * ROTATE: Re-encrypt data with a new key and update metadata.
   */
  rotate(encrypted: EncryptedPayload): EncryptedPayload {
    const data = this.decrypt(encrypted);
    const rotated = this.encrypt(data);
    rotated.keyMeta.rotatedAt = new Date().toISOString();
    return rotated;
  }

  /**
   * EXPORT: Create an encrypted bundle using a passphrase for migration.
   */
  async exportBundle(data: object, passphrase: string): Promise<string> {
    if (passphrase.length < 12) {
      throw new Error("Passphrase must be at least 12 characters long for export security.");
    }
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(passphrase, salt, 32);
    
    const json = JSON.stringify(data);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const bundle = {
      type: 'antigravity-export-bundle',
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
  async importBundle(bundleJson: string, passphrase: string): Promise<object> {
    const bundle = JSON.parse(bundleJson);
    if (bundle.type !== 'antigravity-export-bundle') {
      throw new Error('Invalid export bundle type');
    }

    const salt = Buffer.from(bundle.salt, 'base64');
    const iv = Buffer.from(bundle.iv, 'base64');
    const tag = Buffer.from(bundle.tag, 'base64');
    const payload = Buffer.from(bundle.payload, 'base64');

    const key = scryptSync(passphrase, salt, 32);
    // @ts-ignore - explicitly set authTagLength to 16 bytes (128 bits) to avoid deprecation warning
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }
}
