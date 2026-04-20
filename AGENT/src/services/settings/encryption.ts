/**
 * Sovereign secret encryption â€” AES-256-GCM envelope.
 *
 * Every value we persist in the `settings_secrets` table is encrypted with
 * AES-256-GCM using a master key that lives outside the database, in the
 * `SOVEREIGN_MASTER_KEY` environment variable.
 *
 *   master_key (32 bytes, base64)  â†  SOVEREIGN_MASTER_KEY env var
 *   iv         (12 bytes)           â†  fresh random per encrypt
 *   auth_tag   (16 bytes)           â†  GCM authenticator
 *   ciphertext (n bytes)            â†  AES-256-GCM(master_key, iv, plaintext)
 *
 * We ship NO default key. Booting the gateway without `SOVEREIGN_MASTER_KEY`
 * in staging/production aborts with a helpful error; in development we
 * generate an ephemeral key and log a warning so secrets written during a
 * dev session don't survive a restart (this is intentional â€” developers
 * should not be building workflows against "lasting" dev secrets).
 *
 * Rotation strategy: the envelope carries a `version` field so we can
 * introduce a new master key without losing access to old rows. Re-encrypt
 * on read; a future migration can force-rewrap everything.
 */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const KEY_LEN = 32; // AES-256 â†’ 256-bit key
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;
const ALGO = "aes-256-gcm" as const;

const ENV_VAR = "SOVEREIGN_MASTER_KEY";

/**
 * Envelope persisted for each secret.
 *
 * Stored as separate columns in `settings_secrets` (version, iv, auth_tag,
 * ciphertext) rather than a single JSON blob, so we can index and rotate
 * cleanly. Values are base64-encoded.
 */
export interface SecretEnvelope {
  version: number;
  iv: string; // base64, 12 bytes
  auth_tag: string; // base64, 16 bytes
  ciphertext: string; // base64
}

export class SecretEncryptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SecretEncryptionError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export class MasterKeyMissingError extends Error {
  constructor() {
    super(
      `${ENV_VAR} is not set. Generate one with:\n` +
        `  openssl rand -base64 32\n` +
        `and export it before starting the gateway. In staging/production this is required.`,
    );
    this.name = "MasterKeyMissingError";
  }
}

function decodeMasterKey(raw: string): Buffer {
  // Accept base64 (standard or url-safe). Some operators paste hex by habit,
  // so we detect that and accept it too â€” we're optimizing for "don't lose a
  // dev to a key-format papercut".
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_LEN * 2) {
    return Buffer.from(trimmed, "hex");
  }

  let candidate: Buffer;
  try {
    candidate = Buffer.from(trimmed, "base64");
  } catch (err) {
    throw new SecretEncryptionError(`${ENV_VAR} is not valid base64 or hex`, err);
  }

  if (candidate.length !== KEY_LEN) {
    throw new SecretEncryptionError(
      `${ENV_VAR} must decode to exactly ${KEY_LEN} bytes (got ${candidate.length}). ` +
        `Generate with: openssl rand -base64 32`,
    );
  }
  return candidate;
}

/**
 * Resolve the master key.
 *
 * - Reads from `SOVEREIGN_MASTER_KEY`.
 * - In `APP_ENV=development` (default) with no key set, generates a
 *   per-process ephemeral key and logs a warning. Secrets written against
 *   the ephemeral key are unreadable after restart â€” this is intentional.
 * - In `staging` or `production`, throws `MasterKeyMissingError`.
 */
export function resolveMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env[ENV_VAR];
  if (raw && raw.length > 0) {
    return decodeMasterKey(raw);
  }

  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? "development").toLowerCase();
  if (appEnv === "staging" || appEnv === "production") {
    throw new MasterKeyMissingError();
  }

  // Development fallback â€” ephemeral key, process-local only.
  if (!ephemeralKeyWarned) {
    // eslint-disable-next-line no-console
    console.warn(
      `[settings] ${ENV_VAR} not set; generating an ephemeral key for this process. ` +
        `Secrets you write will NOT survive a restart. ` +
        `To persist secrets, run: export ${ENV_VAR}=$(openssl rand -base64 32)`,
    );
    ephemeralKeyWarned = true;
  }
  if (!cachedEphemeralKey) {
    cachedEphemeralKey = randomBytes(KEY_LEN);
  }
  return cachedEphemeralKey;
}

let cachedEphemeralKey: Buffer | null = null;
let ephemeralKeyWarned = false;

/** For tests only â€” resets the process-local ephemeral-key cache. */
export function __resetEphemeralKeyForTests(): void {
  cachedEphemeralKey = null;
  ephemeralKeyWarned = false;
}

/**
 * Encrypt a secret. The master key is looked up from env on every call so
 * callers never hold it in a closure. Throws if the plaintext is empty.
 */
export function encryptSecret(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): SecretEnvelope {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new SecretEncryptionError("cannot encrypt empty secret");
  }

  const key = resolveMasterKey(env);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== TAG_LEN) {
    // should be impossible with GCM + default 16-byte tag, but be loud if it happens
    throw new SecretEncryptionError(`unexpected auth tag length ${authTag.length}`);
  }

  return {
    version: 1,
    iv: iv.toString("base64"),
    auth_tag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/**
 * Decrypt a secret envelope. Any tampering (ciphertext, iv, or auth tag)
 * raises `SecretEncryptionError` â€” the GCM auth tag guarantees integrity.
 */
export function decryptSecret(
  envelope: SecretEnvelope,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (envelope.version !== 1) {
    throw new SecretEncryptionError(
      `unsupported secret envelope version: ${envelope.version}`,
    );
  }

  const key = resolveMasterKey(env);
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.auth_tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  if (iv.length !== IV_LEN) {
    throw new SecretEncryptionError(`invalid iv length ${iv.length}`);
  }
  if (authTag.length !== TAG_LEN) {
    throw new SecretEncryptionError(`invalid auth tag length ${authTag.length}`);
  }

  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    // Hide the underlying OpenSSL error â€” it leaks implementation detail.
    throw new SecretEncryptionError(
      "failed to decrypt secret (wrong master key or corrupted envelope)",
      err,
    );
  }
}

/**
 * Cheap, allocation-free preview for logs / UIs â€” never returns the value.
 * Returns `{ set: true }` when a secret is present, `{ set: false }` when not.
 */
export function maskSecret(present: boolean): { set: boolean } {
  return { set: present };
}
