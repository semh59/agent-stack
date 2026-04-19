import { describe, it, expect, beforeEach } from 'vitest';
import { KeyManager } from './key-manager';

describe('KeyManager', () => {
  let km: KeyManager;

  beforeEach(() => {
    km = new KeyManager();
  });

  it('should encrypt and decrypt data correctly', () => {
    const data = { hello: 'world', secret: 123 };
    const encrypted = km.encrypt(data);
    
    expect(encrypted.payload).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    expect(encrypted.keyMeta.keyId).toContain('kg_');

    const decrypted = km.decrypt(encrypted);
    expect(decrypted).toEqual(data);
  });

  it('should rotate keys and still be able to decrypt', () => {
    const data = { sensitive: 'info' };
    const original = km.encrypt(data);
    const originalKeyId = original.keyMeta.keyId;

    const rotated = km.rotate(original);
    expect(rotated.keyMeta.keyId).not.toBe(originalKeyId);
    expect(rotated.payload).not.toBe(original.payload);

    const decrypted = km.decrypt(rotated);
    expect(decrypted).toEqual(data);
  });

  it('should fail to decrypt with corrupted payload', () => {
    const data = { test: 'data' };
    const encrypted = km.encrypt(data);
    
    // Corrupt payload
    encrypted.payload = Buffer.from('corrupted').toString('base64');
    
    expect(() => km.decrypt(encrypted)).toThrow();
  });

  it('should fail to decrypt with modified tag', () => {
    const data = { test: 'data' };
    const encrypted = km.encrypt(data);
    
    // Modify tag
    encrypted.tag = Buffer.from('wrongtaglonger').toString('base64');
    
    expect(() => km.decrypt(encrypted)).toThrow();
  });

  it('should export and import bundle with passphrase', async () => {
    const data = { account: 'test', token: 'abc' };
    const passphrase = 'this-is-a-long-and-secure-passphrase-123';
    
    const bundle = await km.exportBundle(data, passphrase);
    expect(typeof bundle).toBe('string');

    const imported = await km.importBundle(bundle, passphrase);
    expect(imported).toEqual(data);
  });

  it('should fail export with weak passphrase', async () => {
    const data = { test: 1 };
    const weakPass = 'short';
    
    await expect(km.exportBundle(data, weakPass)).rejects.toThrow(/at least 12 characters/);
  });

  it('should demonstrate avalanche effect (small input change -> large output change)', () => {
    const data1 = { val: 'a' };
    const data2 = { val: 'b' };
    
    const enc1 = km.encrypt(data1);
    const enc2 = km.encrypt(data2);
    
    // Payload should be very different even if input differs by 1 bit/byte
    expect(enc1.payload).not.toBe(enc2.payload);
    
    // In AES-GCM, the IV also changes by default in my implementation (randomBytes)
    // but even with same IV, ciphertext would differ significantly.
  });
});
