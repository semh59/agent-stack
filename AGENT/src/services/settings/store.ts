/**
 * Sovereign settings store — SQLite-backed persistence.
 *
 * Two tables:
 *   settings          — a single row JSON blob (non-secret fields)
 *   settings_secrets  — one row per secret path, AES-GCM envelope columns
 *
 * We keep the non-secret settings as a single JSON row rather than a
 * normalized shape because (a) the schema evolves rapidly and (b) the
 * single source of truth is the Zod schema, not the DB. The DB is a
 * durable mirror of what the schema validates.
 *
 * Reads go through `getSettings()` which:
 *   1. Reads the JSON row (or returns defaults on first boot)
 *   2. Reads all `settings_secrets` rows
 *   3. Re-hydrates secret fields into the object (for internal use) OR
 *      returns a "redacted" view (for HTTP responses)
 *
 * Writes go through `setSettings()` which:
 *   1. Runs the Zod schema validator (throws on invalid)
 *   2. Splits secret vs non-secret fields via `SECRET_PATHS`
 *   3. Transactionally writes JSON blob + upserts each secret envelope
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { xdgConfig } from "xdg-basedir";

import {
  SECRET_PATHS,
  type SecretPath,
  type Settings,
  type SettingsInput,
  settingsSchema,
} from "./schema.js";
import {
  decryptSecret,
  encryptSecret,
  type SecretEnvelope,
} from "./encryption.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SettingsStoreOptions {
  dbPath?: string;
  /** If true, throws on corruption instead of auto-recovering. Tests use this. */
  strict?: boolean;
  /** Env override — used by tests to supply a deterministic master key. */
  env?: NodeJS.ProcessEnv;
}

/**
 * A "redacted" settings view — secret fields are replaced with
 * `{ set: boolean, updated_at?: number }`. Safe to send to the UI.
 */
export type SettingsRedacted = Omit<Settings, "providers"> & {
  providers: {
    [K in keyof Settings["providers"]]: Settings["providers"][K] extends {
      api_key?: unknown;
    }
      ? Omit<Settings["providers"][K], "api_key"> & {
          api_key: { set: boolean; updated_at?: number };
        }
      : Settings["providers"][K];
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Migrations (inline — no file loader here since this is a new service)
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_SCHEMA_VERSION = 1;

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  json            TEXT    NOT NULL,
  updated_at      INTEGER NOT NULL,
  updated_by      TEXT
);

CREATE TABLE IF NOT EXISTS settings_secrets (
  path            TEXT    PRIMARY KEY,
  envelope_version INTEGER NOT NULL,
  iv              TEXT    NOT NULL,
  auth_tag        TEXT    NOT NULL,
  ciphertext      TEXT    NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settings_secrets_updated
  ON settings_secrets(updated_at DESC);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

function resolveSettingsDatabasePath(override?: string): string {
  if (override) return path.resolve(override);
  const root = xdgConfig ?? path.join(os.homedir(), ".config");
  return path.join(root, "sovereign", "settings.db");
}

function ensureParentDirectory(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export class SettingsStore {
  private readonly db: Database.Database;
  public readonly dbPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: SettingsStoreOptions = {}) {
    this.env = options.env ?? process.env;
    this.dbPath = resolveSettingsDatabasePath(options.dbPath);
    ensureParentDirectory(this.dbPath);
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.runMigrations();
  }

  private runMigrations(): void {
    const current = Number(this.db.pragma("user_version", { simple: true }));
    if (current < 1) {
      this.db.exec(MIGRATION_001);
      this.db.pragma(`user_version = ${SETTINGS_SCHEMA_VERSION}`);
    }
  }

  public close(): void {
    if (this.db.open) this.db.close();
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Returns the full hydrated settings object (including decrypted secrets). */
  public getSettings(): Settings {
    const { blob, secrets } = this.readRaw();
    const base = blob ?? {};
    const merged = this.hydrateSecrets(base, secrets, /* plaintext */ true);
    return settingsSchema.parse(merged);
  }

  /** Returns the redacted view — safe to send to the UI. */
  public getSettingsRedacted(): SettingsRedacted {
    const { blob, secrets } = this.readRaw();
    const base = blob ?? settingsSchema.parse({});
    const redacted = this.hydrateSecrets(base, secrets, /* plaintext */ false);
    return redacted as SettingsRedacted;
  }

  /** Returns a single decrypted secret, or null if not set. */
  public getSecret(pathDotted: SecretPath): string | null {
    const row = this.db
      .prepare<[string]>(
        `SELECT envelope_version, iv, auth_tag, ciphertext
         FROM settings_secrets WHERE path = ?`,
      )
      .get(pathDotted) as
      | {
          envelope_version: number;
          iv: string;
          auth_tag: string;
          ciphertext: string;
        }
      | undefined;
    if (!row) return null;
    return decryptSecret(
      {
        version: row.envelope_version,
        iv: row.iv,
        auth_tag: row.auth_tag,
        ciphertext: row.ciphertext,
      },
      this.env,
    );
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Validate + persist. Secret fields are extracted, encrypted, and written
   * to `settings_secrets`; everything else goes into the JSON row.
   *
   * If a secret field is `undefined` in the input we LEAVE the existing
   * secret in place (so partial updates from the UI don't wipe keys). To
   * explicitly clear a secret, pass `null` or an empty string.
   */
  public setSettings(
    input: SettingsInput,
    updatedBy?: string,
  ): SettingsRedacted {
    // Parse → throws ZodError on invalid input. This is the authoritative gate.
    const parsed = settingsSchema.parse(input);

    // Split secret vs non-secret fields.
    const { scrubbed, secrets, clearPaths } = this.extractSecrets(input, parsed);

    const now = Date.now();
    const blobJson = JSON.stringify(scrubbed);

    const upsertBlob = this.db.prepare(
      `INSERT INTO settings (id, json, updated_at, updated_by)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         json = excluded.json,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    );
    const upsertSecret = this.db.prepare(
      `INSERT INTO settings_secrets
         (path, envelope_version, iv, auth_tag, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         envelope_version = excluded.envelope_version,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         ciphertext = excluded.ciphertext,
         updated_at = excluded.updated_at`,
    );
    const deleteSecret = this.db.prepare(
      `DELETE FROM settings_secrets WHERE path = ?`,
    );

    const tx = this.db.transaction(() => {
      upsertBlob.run(blobJson, now, updatedBy ?? null);
      for (const [p, plaintext] of secrets) {
        const env = encryptSecret(plaintext, this.env);
        upsertSecret.run(
          p,
          env.version,
          env.iv,
          env.auth_tag,
          env.ciphertext,
          now,
        );
      }
      for (const p of clearPaths) {
        deleteSecret.run(p);
      }
    });
    tx();

    return this.getSettingsRedacted();
  }

  /**
   * Reset to defaults. Wipes both tables. Irreversible — caller (route)
   * is responsible for confirming with the user.
   */
  public reset(updatedBy?: string): SettingsRedacted {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM settings_secrets").run();
      this.db.prepare("DELETE FROM settings").run();
    });
    tx();
    // Seed defaults by running setSettings with an empty object.
    return this.setSettings({} as SettingsInput, updatedBy);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private readRaw(): {
    blob: Record<string, unknown> | null;
    secrets: Map<string, SecretEnvelope & { updated_at: number }>;
  } {
    const blobRow = this.db
      .prepare(`SELECT json FROM settings WHERE id = 1`)
      .get() as { json: string } | undefined;
    const blob = blobRow ? (JSON.parse(blobRow.json) as Record<string, unknown>) : null;

    const secretRows = this.db
      .prepare(
        `SELECT path, envelope_version, iv, auth_tag, ciphertext, updated_at
         FROM settings_secrets`,
      )
      .all() as Array<{
      path: string;
      envelope_version: number;
      iv: string;
      auth_tag: string;
      ciphertext: string;
      updated_at: number;
    }>;

    const secrets = new Map<string, SecretEnvelope & { updated_at: number }>();
    for (const r of secretRows) {
      secrets.set(r.path, {
        version: r.envelope_version,
        iv: r.iv,
        auth_tag: r.auth_tag,
        ciphertext: r.ciphertext,
        updated_at: r.updated_at,
      });
    }
    return { blob, secrets };
  }

  /**
   * Merge secrets back into the settings object. `plaintext=true` decrypts;
   * `plaintext=false` replaces secret fields with `{ set, updated_at }`.
   */
  private hydrateSecrets(
    base: Record<string, unknown>,
    secrets: Map<string, SecretEnvelope & { updated_at: number }>,
    plaintext: boolean,
  ): Record<string, unknown> {
    const out = structuredClone(base);
    for (const p of SECRET_PATHS) {
      const envelope = secrets.get(p);
      if (plaintext) {
        if (envelope) {
          setAtPath(out, p, decryptSecret(envelope, this.env));
        } else {
          setAtPath(out, p, undefined);
        }
      } else {
        setAtPath(out, p, {
          set: Boolean(envelope),
          updated_at: envelope?.updated_at,
        });
      }
    }
    return out;
  }

  /**
   * Strip secret fields out of the parsed input, returning:
   *   - scrubbed:   the object with secret fields deleted (persisted as JSON)
   *   - secrets:    paths → plaintext values to encrypt (non-empty strings)
   *   - clearPaths: paths the user explicitly set to null/""  (DELETE from DB)
   *
   * `undefined` means "leave as-is" — NOT in secrets and NOT in clearPaths.
   */
  private extractSecrets(
    rawInput: SettingsInput,
    parsed: Settings,
  ): {
    scrubbed: Record<string, unknown>;
    secrets: Array<[SecretPath, string]>;
    clearPaths: SecretPath[];
  } {
    const scrubbed = structuredClone(parsed) as Record<string, unknown>;
    const secrets: Array<[SecretPath, string]> = [];
    const clearPaths: SecretPath[] = [];

    for (const p of SECRET_PATHS) {
      const rawValue = getAtPath(rawInput as Record<string, unknown>, p);
      const parsedValue = getAtPath(scrubbed, p);

      // Strip from scrubbed regardless (we never store plaintext in the blob)
      setAtPath(scrubbed, p, undefined);

      // Decide action based on RAW input (not parsed — parsed drops undefineds)
      if (rawValue === undefined) {
        // "Leave as-is" — no action needed.
        continue;
      }
      if (rawValue === null || rawValue === "") {
        clearPaths.push(p);
        continue;
      }
      if (typeof rawValue === "string" && rawValue.length > 0) {
        secrets.push([p, rawValue]);
        continue;
      }
      // Ignore objects like `{ set: true }` posted back from the redacted view —
      // treat as "leave as-is". The UI is allowed to round-trip these.
      if (
        typeof rawValue === "object" &&
        rawValue !== null &&
        "set" in (rawValue as Record<string, unknown>)
      ) {
        // leave as-is
        continue;
      }
      // Anything else is invalid — but Zod would have caught string-typed
      // violations already. Fall back to leave-as-is for forward compat.
      void parsedValue;
    }

    return { scrubbed, secrets, clearPaths };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers (dotted-path get/set on plain objects)
// ─────────────────────────────────────────────────────────────────────────────

function getAtPath(obj: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setAtPath(
  obj: Record<string, unknown>,
  dotted: string,
  value: unknown,
): void {
  const parts = dotted.split(".");
  const last = parts.pop();
  if (!last) return;
  let cur: Record<string, unknown> = obj;
  for (const part of parts) {
    const next = cur[part];
    if (next === undefined || next === null || typeof next !== "object") {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  if (value === undefined) {
    delete cur[last];
  } else {
    cur[last] = value;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton accessors
// ─────────────────────────────────────────────────────────────────────────────

const storeByPath = new Map<string, SettingsStore>();

export function getSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const key = resolveSettingsDatabasePath(options.dbPath);
  const existing = storeByPath.get(key);
  if (existing) return existing;
  const store = new SettingsStore({ ...options, dbPath: key });
  storeByPath.set(key, store);
  return store;
}

export function resetSettingsStore(dbPath?: string): void {
  if (dbPath) {
    const key = resolveSettingsDatabasePath(dbPath);
    const existing = storeByPath.get(key);
    existing?.close();
    storeByPath.delete(key);
    return;
  }
  for (const s of storeByPath.values()) s.close();
  storeByPath.clear();
}
