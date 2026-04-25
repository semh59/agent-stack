import { describe, expect, it, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  resolveMasterKey,
  MasterKeyMissingError,
  SecretEncryptionError,
  __resetEphemeralKeyForTests,
  maskSecret,
} from "./encryption";

function makeEnv(key?: string, appEnv?: string): NodeJS.ProcessEnv {
  return {
    ...(key !== undefined ? { ALLOY_MASTER_KEY: key } : {}),
    ...(appEnv !== undefined ? { APP_ENV: appEnv } : {}),
  } as NodeJS.ProcessEnv;
}

function freshKey(): string {
  return randomBytes(32).toString("base64");
}

describe("encryption: resolveMasterKey", () => {
  beforeEach(() => __resetEphemeralKeyForTests());

  it("accepts a 32-byte base64 key", () => {
    const key = freshKey();
    const resolved = resolveMasterKey(makeEnv(key));
    expect(resolved.length).toBe(32);
  });

  it("accepts a 64-char hex key", () => {
    const hex = randomBytes(32).toString("hex");
    const resolved = resolveMasterKey(makeEnv(hex));
    expect(resolved.length).toBe(32);
  });

  it("throws MasterKeyMissingError in production with no key", () => {
    expect(() => resolveMasterKey(makeEnv(undefined, "production"))).toThrow(
      MasterKeyMissingError,
    );
  });

  it("throws MasterKeyMissingError in staging with no key", () => {
    expect(() => resolveMasterKey(makeEnv(undefined, "staging"))).toThrow(
      MasterKeyMissingError,
    );
  });

  it("generates an ephemeral key in development", () => {
    const k1 = resolveMasterKey(makeEnv(undefined, "development"));
    const k2 = resolveMasterKey(makeEnv(undefined, "development"));
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true); // cached per-process
  });

  it("rejects wrong-length keys", () => {
    expect(() => resolveMasterKey(makeEnv("tooShort"))).toThrow(SecretEncryptionError);
  });
});

describe("encryption: encrypt/decrypt round trip", () => {
  it("encrypts and decrypts a simple secret", () => {
    const env = makeEnv(freshKey());
    const plaintext = "sk-super-secret-api-key-12345";
    const envelope = encryptSecret(plaintext, env);
    expect(envelope.version).toBe(1);
    expect(envelope.ciphertext).not.toContain(plaintext);
    expect(decryptSecret(envelope, env)).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (IV randomness)", () => {
    const env = makeEnv(freshKey());
    const a = encryptSecret("same-secret", env);
    const b = encryptSecret("same-secret", env);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("rejects empty plaintext", () => {
    const env = makeEnv(freshKey());
    expect(() => encryptSecret("", env)).toThrow(SecretEncryptionError);
  });

  it("fails to decrypt with a different master key", () => {
    const envA = makeEnv(freshKey());
    const envB = makeEnv(freshKey());
    const envelope = encryptSecret("top-secret", envA);
    expect(() => decryptSecret(envelope, envB)).toThrow(SecretEncryptionError);
  });

  it("detects tampering with ciphertext", () => {
    const env = makeEnv(freshKey());
    const envelope = encryptSecret("top-secret", env);
    const tampered = { ...envelope, ciphertext: Buffer.from("AAAAAA").toString("base64") };
    expect(() => decryptSecret(tampered, env)).toThrow(SecretEncryptionError);
  });

  it("detects tampering with auth tag", () => {
    const env = makeEnv(freshKey());
    const envelope = encryptSecret("top-secret", env);
    const tampered = {
      ...envelope,
      auth_tag: Buffer.alloc(16).toString("base64"),
    };
    expect(() => decryptSecret(tampered, env)).toThrow(SecretEncryptionError);
  });

  it("rejects unsupported envelope version", () => {
    const env = makeEnv(freshKey());
    const envelope = { ...encryptSecret("x", env), version: 99 };
    expect(() => decryptSecret(envelope, env)).toThrow(SecretEncryptionError);
  });

  it("handles unicode plaintext", () => {
    const env = makeEnv(freshKey());
    const plaintext = "ğŸ” gizli ç§˜å¯† Ø³Ø± á²¡á²á²˜á²«á²˜";
    const envelope = encryptSecret(plaintext, env);
    expect(decryptSecret(envelope, env)).toBe(plaintext);
  });
});

describe("encryption: maskSecret", () => {
  it("returns { set: true } when present", () => {
    expect(maskSecret(true)).toEqual({ set: true });
  });
  it("returns { set: false } when absent", () => {
    expect(maskSecret(false)).toEqual({ set: false });
  });
});
