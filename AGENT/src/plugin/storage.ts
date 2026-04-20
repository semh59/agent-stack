import { promises as fs } from "node:fs";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from "node:crypto";
import lockfile from "proper-lockfile";
import pkg from "node-machine-id";
const { machineIdSync } = pkg;
import { KeyManager, type EncryptedPayload } from "./key-manager";
import type { HeaderStyle } from "../constants";
import { createLogger } from "./logger";

const log = createLogger("storage");
const keyManager = new KeyManager();

/**
 * Files/directories that should be gitignored in the config directory.
 * These contain sensitive data or machine-specific state.
 */
export const GITIGNORE_ENTRIES = [
  ".gitignore",
  "Sovereign-accounts.json",
  "Sovereign-accounts.json.*.tmp",
  "Sovereign-signature-cache.json",
  "Sovereign-logs/",
];

/**
 * Ensures a .gitignore file exists in the config directory with entries
 * for sensitive files. Creates the file if missing, or appends missing
 * entries if it already exists.
 */
export async function ensureGitignore(configDir: string): Promise<void> {
  const gitignorePath = join(configDir, ".gitignore");

  try {
    let content: string;
    let existingLines: string[] = [];

    try {
      content = await fs.readFile(gitignorePath, "utf-8");
      existingLines = content.split("\n").map((line) => line.trim());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return;
      }
      content = "";
    }

    const missingEntries = GITIGNORE_ENTRIES.filter(
      (entry) => !existingLines.includes(entry),
    );

    if (missingEntries.length === 0) {
      return;
    }

    if (content === "") {
      await fs.writeFile(
        gitignorePath,
        missingEntries.join("\n") + "\n",
        "utf-8",
      );
      log.info("Created .gitignore in config directory");
    } else {
      const suffix = content.endsWith("\n") ? "" : "\n";
      await fs.appendFile(
        gitignorePath,
        suffix + missingEntries.join("\n") + "\n",
        "utf-8",
      );
      log.info("Updated .gitignore with missing entries", {
        added: missingEntries,
      });
    }
  } catch (error) {
    log.error("Failed to ensure .gitignore exists", { error: String(error) });
  }
}

/**
 * Synchronous version of ensureGitignore for use in sync code paths.
 */
export function ensureGitignoreSync(configDir: string): void {
  const gitignorePath = join(configDir, ".gitignore");

  try {
    let content: string;
    let existingLines: string[] = [];

    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, "utf-8");
      existingLines = content.split("\n").map((line) => line.trim());
    } else {
      content = "";
    }

    const missingEntries = GITIGNORE_ENTRIES.filter(
      (entry) => !existingLines.includes(entry),
    );

    if (missingEntries.length === 0) {
      return;
    }

    if (content === "") {
      writeFileSync(gitignorePath, missingEntries.join("\n") + "\n", "utf-8");
      log.info("Created .gitignore in config directory");
    } else {
      const suffix = content.endsWith("\n") ? "" : "\n";
      appendFileSync(
        gitignorePath,
        suffix + missingEntries.join("\n") + "\n",
        "utf-8",
      );
      log.info("Updated .gitignore with missing entries", {
        added: missingEntries,
      });
    }
  } catch (error) {
    log.error("Failed to ensure .gitignore exists (sync)", { error: String(error) });
  }
}

export type ModelFamily = "claude" | "gemini";
export type { HeaderStyle };

export interface RateLimitState {
  claude?: number;
  gemini?: number;
}

export interface RateLimitStateV3 {
  claude?: number;
  "gemini-Sovereign"?: number;
  "gemini-cli"?: number;
  [key: string]: number | undefined;
}

export interface AccountMetadataV1 {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  isRateLimited?: boolean;
  rateLimitResetTime?: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
}

export interface AccountStorageV1 {
  version: 1;
  accounts: AccountMetadataV1[];
  activeIndex: number;
}

export interface AccountMetadata {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitState;
}

export interface AccountStorage {
  version: 2;
  accounts: AccountMetadata[];
  activeIndex: number;
}

export type CooldownReason = "auth-failure" | "network-error" | "project-error";

export interface AccountMetadataV3 {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  enabled?: boolean;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitStateV3;
  coolingDownUntil?: number;
  cooldownReason?: CooldownReason;
  /** Per-account device fingerprint for rate limit mitigation */
  fingerprint?: import("./fingerprint").Fingerprint;
  /** Cached soft quota data */
  cachedQuota?: Record<string, { remainingFraction?: number; resetTime?: string; modelCount: number }>;
  cachedQuotaUpdatedAt?: number;
  /** Persisted health score (0-100) */
  healthScore?: number;
}

export interface AccountStorageV3 {
  version: 3;
  accounts: AccountMetadataV3[];
  activeIndex: number;
  activeIndexByFamily?: {
    claude?: number;
    gemini?: number;
  };
}

type AnyAccountStorage = AccountStorageV1 | AccountStorage | AccountStorageV3;

export type LoadAccountsErrorCode =
  | "ENOENT"
  | "PERMISSION_DENIED"
  | "PARSE_ERROR"
  | "INVALID_FORMAT"
  | "UNKNOWN_VERSION"
  | "DECRYPT_ERROR"
  | "READ_ERROR";

export type LoadAccountsResult =
  | { status: "ok"; storage: AccountStorageV3 }
  | { status: "missing" }
  | { status: "error"; errorCode: LoadAccountsErrorCode; error: string };

/**
 * Gets the legacy Windows config directory (%APPDATA%\opencode).
 * Used for migration from older plugin versions.
 */
function getLegacyWindowsConfigDir(): string {
  return join(
    process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
    "opencode",
  );
}

/**
 * Gets the config directory path, with the following precedence:
 * 1. OPENCODE_CONFIG_DIR env var (if set)
 * 2. ~/.config/opencode (all platforms, including Windows)
 *
 * On Windows, also checks for legacy %APPDATA%\opencode path for migration.
 */
function getConfigDir(): string {
  // 1. Check for explicit override via env var
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  // 2. Use ~/.config/opencode on all platforms (including Windows)
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

/**
 * Migrates config from legacy Windows location to the new path.
 * Moves the file if legacy exists and new doesn't.
 * Returns true if migration was performed.
 */
function migrateLegacyWindowsConfig(): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const newPath = join(getConfigDir(), "Sovereign-accounts.json");
  const legacyPath = join(
    getLegacyWindowsConfigDir(),
    "Sovereign-accounts.json",
  );

  // Only migrate if legacy exists and new doesn't
  if (!existsSync(legacyPath) || existsSync(newPath)) {
    return false;
  }

  try {
    // Ensure new config directory exists
    const newConfigDir = getConfigDir();

    mkdirSync(newConfigDir, { recursive: true });

    // Try rename first (atomic, but fails across filesystems)
    try {
      renameSync(legacyPath, newPath);
      log.info("Migrated Windows config via rename", { from: legacyPath, to: newPath });
    } catch {
      // Fallback: copy then delete (for cross-filesystem moves)
      copyFileSync(legacyPath, newPath);
      unlinkSync(legacyPath);
      log.info("Migrated Windows config via copy+delete", { from: legacyPath, to: newPath });
    }

    return true;
  } catch (error) {
    log.warn("Failed to migrate legacy Windows config, will use legacy path", {
      legacyPath,
      newPath,
      error: String(error),
    });
    return false;
  }
}

/**
 * Gets the storage path, migrating from legacy Windows location if needed.
 * On Windows, attempts to move legacy config to new path for alignment.
 */
function getStoragePathWithMigration(): string {
  const newPath = join(getConfigDir(), "Sovereign-accounts.json");

  // On Windows, attempt to migrate legacy config to new location
  if (process.platform === "win32") {
    migrateLegacyWindowsConfig();

    // If migration failed and legacy still exists, fall back to it
    if (!existsSync(newPath)) {
      const legacyPath = join(
        getLegacyWindowsConfigDir(),
        "Sovereign-accounts.json",
      );
      if (existsSync(legacyPath)) {
        log.info("Using legacy Windows config path (migration failed)", {
          legacyPath,
          newPath,
        });
        return legacyPath;
      }
    }
  }

  return newPath;
}

export function getStoragePath(): string {
  return getStoragePathWithMigration();
}

/**
 * â”€â”€â”€ ENCRYPTION UTILITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Note: Legacy AES-256-GCM (v2) methods removed for strict v3-only standard.
 */

function isEncrypted(content: string): boolean {
  if (!content) return false;
  return KeyManager.isV3Encrypted(content);
}

/**
 * Gets the config directory path. Exported for use by other modules.
 */
export { getConfigDir };

// `stale` is how long before we consider a held lock abandoned. Under load
// (e.g. CI running many vitest workers, or a blocked event loop during a
// GC pause) 10s was too aggressive and we saw "lock broken" races. 30s gives
// real work room to finish, and we still have a 7-attempt exponential
// backoff on top of the in-process serialization above the file lock.
const LOCK_OPTIONS = {
  stale: 30000,
  retries: {
    retries: 7,
    minTimeout: 150,
    maxTimeout: 2000,
    factor: 2,
  },
};

/**
 * Write `content` to `path` with durability guarantees.
 *
 * Uses the write-to-temp + rename atomicity pattern, but with an explicit
 * `fd.sync()` between the write and the rename so that the file contents
 * are actually on disk before the rename commits. Without this, a power
 * loss between the rename and the kernel's writeback flush can leave the
 * file with zero bytes on an xfs/ext4 system — exactly the failure mode
 * BUG_REPORT.md flagged.
 */
async function writeFileAtomicDurable(
  path: string,
  tempPath: string,
  content: string,
): Promise<void> {
  // 1. Write data to the temp file and fsync its contents before rename.
  const fd = await fs.open(tempPath, "w");
  try {
    await fd.writeFile(content, "utf-8");
    await fd.sync();
  } finally {
    await fd.close();
  }

  // 2. Atomic rename — visible to readers only once the new bytes are
  //    durable on disk. rename(2) is atomic within a single filesystem.
  await fs.rename(tempPath, path);

  // 3. fsync the containing directory so the rename metadata is durable
  //    too. On platforms (Windows) where opening a directory fails, this
  //    is a best-effort no-op — the rename itself is still the ordering
  //    boundary and is enough in the common case.
  try {
    const dirFd = await fs.open(dirname(path), "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch {
    // Directory fsync isn't supported everywhere; ignore.
  }
}

/**
 * Sweep orphaned `<storagePath>.<hex>.tmp` files left behind by a crashed
 * writer. Must be called before the first save, and is best-effort: any
 * errors are swallowed because a stale temp file is recoverable (the real
 * storage file is still intact), and a failed cleanup should not block
 * startup.
 */
async function cleanupOrphanedTempFiles(storagePath: string): Promise<void> {
  try {
    const dir = dirname(storagePath);
    const base = storagePath.substring(dir.length + 1);
    const entries = await fs.readdir(dir);
    const prefix = `${base}.`;
    const suffix = ".tmp";
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      // Only remove files older than 60s to avoid racing with a concurrent
      // writer that is mid-rename.
      const full = join(dir, entry);
      try {
        const stat = await fs.stat(full);
        if (Date.now() - stat.mtimeMs > 60_000) {
          await fs.unlink(full);
          log.info("Cleaned up stale storage temp file", { file: entry });
        }
      } catch {
        // mtime/unlink race — ignore.
      }
    }
  } catch {
    // directory missing or unreadable — nothing to clean, keep going.
  }
}

let tempCleanupPromise: Promise<void> | null = null;
function ensureTempCleanup(storagePath: string): Promise<void> {
  if (!tempCleanupPromise) {
    tempCleanupPromise = cleanupOrphanedTempFiles(storagePath);
  }
  return tempCleanupPromise;
}

interface InProcessPathLock {
  locked: boolean;
  waiters: Array<() => void>;
}

const inProcessPathLocks = new Map<string, InProcessPathLock>();

async function acquireInProcessPathLock(path: string): Promise<() => void> {
  const key = resolve(path);
  let lockState = inProcessPathLocks.get(key);
  if (!lockState) {
    lockState = { locked: false, waiters: [] };
    inProcessPathLocks.set(key, lockState);
  }

  if (lockState.locked) {
    await new Promise<void>((resolveWaiter) => {
      lockState!.waiters.push(resolveWaiter);
    });
  }

  lockState.locked = true;

  return () => {
    const activeState = inProcessPathLocks.get(key);
    if (!activeState) {
      return;
    }

    const next = activeState.waiters.shift();
    if (next) {
      next();
      return;
    }

    activeState.locked = false;
    inProcessPathLocks.delete(key);
  };
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await fs.access(path);
  } catch {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(
      path,
      JSON.stringify({ version: 3, accounts: [], activeIndex: 0 }, null, 2),
      "utf-8",
    );
  }
}

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const releaseInProcessLock = await acquireInProcessPathLock(path);
  let release: (() => Promise<void>) | null = null;
  try {
    await ensureFileExists(path);
    release = await lockfile.lock(path, LOCK_OPTIONS);
    return await fn();
  } finally {
    if (release) {
      try {
        await release();
      } catch (unlockError) {
        log.warn("Failed to release lock", { error: String(unlockError) });
      }
    }
    releaseInProcessLock();
  }
}

function mergeAccountStorage(
  existing: AccountStorageV3,
  incoming: AccountStorageV3,
): AccountStorageV3 {
  const accountMap = new Map<string, AccountMetadataV3>();

  for (const acc of existing.accounts) {
    if (acc.refreshToken) {
      accountMap.set(acc.refreshToken, acc);
    }
  }

  for (const acc of incoming.accounts) {
    if (acc.refreshToken) {
      const existingAcc = accountMap.get(acc.refreshToken);
      if (existingAcc) {
        accountMap.set(acc.refreshToken, {
          ...existingAcc,
          ...acc,
          // Preserve manually configured projectId/managedProjectId if not in incoming
          projectId: acc.projectId ?? existingAcc.projectId,
          managedProjectId: acc.managedProjectId ?? existingAcc.managedProjectId,
          rateLimitResetTimes: {
            ...existingAcc.rateLimitResetTimes,
            ...acc.rateLimitResetTimes,
          },
          lastUsed: Math.max(existingAcc.lastUsed || 0, acc.lastUsed || 0),
        });
      } else {
        accountMap.set(acc.refreshToken, acc);
      }
    }
  }

  return {
    version: 3,
    accounts: Array.from(accountMap.values()),
    activeIndex: incoming.activeIndex,
    activeIndexByFamily: incoming.activeIndexByFamily,
  };
}

export function deduplicateAccountsByEmail<
  T extends { email?: string; lastUsed?: number; addedAt?: number },
>(accounts: T[]): T[] {
  const emailToNewestIndex = new Map<string, number>();
  const indicesToKeep = new Set<number>();

  // First pass: find the newest account for each email (by lastUsed, then addedAt)
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (!acc) continue;

    if (!acc.email) {
      // No email - keep this account (can't deduplicate without email)
      indicesToKeep.add(i);
      continue;
    }

    const existingIndex = emailToNewestIndex.get(acc.email);
    if (existingIndex === undefined) {
      emailToNewestIndex.set(acc.email, i);
      continue;
    }

    // Compare to find which is newer
    const existing = accounts[existingIndex];
    if (!existing) {
      emailToNewestIndex.set(acc.email, i);
      continue;
    }

    // Prefer higher lastUsed, then higher addedAt
    // Compare fields separately to avoid integer overflow with large timestamps
    const currLastUsed = acc.lastUsed || 0;
    const existLastUsed = existing.lastUsed || 0;
    const currAddedAt = acc.addedAt || 0;
    const existAddedAt = existing.addedAt || 0;

    const isNewer =
      currLastUsed > existLastUsed ||
      (currLastUsed === existLastUsed && currAddedAt > existAddedAt);

    if (isNewer) {
      emailToNewestIndex.set(acc.email, i);
    }
  }

  // Add all the newest email-based indices to the keep set
  for (const idx of emailToNewestIndex.values()) {
    indicesToKeep.add(idx);
  }

  // Build the deduplicated list, preserving original order for kept items
  const result: T[] = [];
  for (let i = 0; i < accounts.length; i++) {
    if (indicesToKeep.has(i)) {
      const acc = accounts[i];
      if (acc) {
        result.push(acc);
      }
    }
  }

  return result;
}

function migrateV1ToV2(v1: AccountStorageV1): AccountStorage {
  return {
    version: 2,
    accounts: v1.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitState = {};
      if (
        acc.isRateLimited &&
        acc.rateLimitResetTime &&
        acc.rateLimitResetTime > Date.now()
      ) {
        rateLimitResetTimes.claude = acc.rateLimitResetTime;
        rateLimitResetTimes.gemini = acc.rateLimitResetTime;
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes:
          Object.keys(rateLimitResetTimes).length > 0
            ? rateLimitResetTimes
            : undefined,
      };
    }),
    activeIndex: v1.activeIndex,
  };
}

export function migrateV2ToV3(v2: AccountStorage): AccountStorageV3 {
  return {
    version: 3,
    accounts: v2.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitStateV3 = {};
      if (
        acc.rateLimitResetTimes?.claude &&
        acc.rateLimitResetTimes.claude > Date.now()
      ) {
        rateLimitResetTimes.claude = acc.rateLimitResetTimes.claude;
      }
      if (
        acc.rateLimitResetTimes?.gemini &&
        acc.rateLimitResetTimes.gemini > Date.now()
      ) {
        rateLimitResetTimes["gemini-Sovereign"] =
          acc.rateLimitResetTimes.gemini;
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes:
          Object.keys(rateLimitResetTimes).length > 0
            ? rateLimitResetTimes
            : undefined,
      };
    }),
    activeIndex: v2.activeIndex,
  };
}

export async function loadAccountsDetailed(): Promise<LoadAccountsResult> {
  try {
    const path = getStoragePath();
    let content = await fs.readFile(path, "utf-8");
    
    // Auto-decrypt if needed
    if (isEncrypted(content)) {
      try {
        // STRICT: Only v3 encryption allowed
        content = JSON.stringify(keyManager.decrypt(JSON.parse(content) as EncryptedPayload));
      } catch (err) {
        log.error("Failed to decrypt account storage (v3 required)", { error: String(err) });
        return {
          status: "error",
          errorCode: "DECRYPT_ERROR",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    let data: AnyAccountStorage;
    try {
      data = JSON.parse(content) as AnyAccountStorage;
    } catch (err) {
      return {
        status: "error",
        errorCode: "PARSE_ERROR",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!Array.isArray(data.accounts)) {
      log.warn("Invalid storage format, ignoring");
      return {
        status: "error",
        errorCode: "INVALID_FORMAT",
        error: "accounts field must be an array",
      };
    }

    let storage: AccountStorageV3;

    if (data.version === 1) {
      log.info("Migrating account storage from v1 to v3");
      const v2 = migrateV1ToV2(data);
      storage = migrateV2ToV3(v2);
      try {
        await saveAccounts(storage);
        log.info("Migration to v3 complete");
      } catch (saveError) {
        log.warn("Failed to persist migrated storage", {
          error: String(saveError),
        });
      }
    } else if (data.version === 2) {
      log.info("Migrating account storage from v2 to v3");
      storage = migrateV2ToV3(data);
      try {
        await saveAccounts(storage);
        log.info("Migration to v3 complete");
      } catch (saveError) {
        log.warn("Failed to persist migrated storage", {
          error: String(saveError),
        });
      }
    } else if (data.version === 3) {
      storage = data;
    } else {
      log.warn("Unknown storage version, ignoring", {
        version: (data as { version?: unknown }).version,
      });
      return {
        status: "error",
        errorCode: "UNKNOWN_VERSION",
        error: `Unsupported storage version: ${String((data as { version?: unknown }).version ?? "unknown")}`,
      };
    }

    // Validate accounts have required fields
    const validAccounts = storage.accounts.filter(
      (a): a is AccountMetadataV3 => {
        return (
          !!a &&
          typeof a === "object" &&
          typeof (a as AccountMetadataV3).refreshToken === "string"
        );
      },
    );

    // Deduplicate accounts by email (keeps newest entry for each email)
    const deduplicatedAccounts = deduplicateAccountsByEmail(validAccounts);

    // Clamp activeIndex to valid range after deduplication
    let activeIndex =
      typeof storage.activeIndex === "number" &&
      Number.isFinite(storage.activeIndex)
        ? storage.activeIndex
        : 0;
    if (deduplicatedAccounts.length > 0) {
      activeIndex = Math.min(activeIndex, deduplicatedAccounts.length - 1);
      activeIndex = Math.max(activeIndex, 0);
    } else {
      activeIndex = 0;
    }

    return {
      status: "ok",
      storage: {
      version: 3,
      accounts: deduplicatedAccounts,
      activeIndex,
      },
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: "missing" };
    }
    if (code === "EACCES" || code === "EPERM") {
      return {
        status: "error",
        errorCode: "PERMISSION_DENIED",
        error: String(error),
      };
    }
    log.error("Failed to load account storage", { error: String(error) });
    return {
      status: "error",
      errorCode: "READ_ERROR",
      error: String(error),
    };
  }
}

export async function loadAccounts(): Promise<AccountStorageV3 | null> {
  const result = await loadAccountsDetailed();
  if (result.status === "ok") {
    return result.storage;
  }
  return null;
}

export async function deleteAccount(refreshToken: string): Promise<void> {
  const path = getStoragePath();
  await ensureTempCleanup(path);
  await withFileLock(path, async () => {
    const existing = await loadAccountsUnsafe();
    if (!existing) return;

    const filtered = existing.accounts.filter(acc => acc.refreshToken !== refreshToken);
    if (filtered.length === existing.accounts.length) return; // Not found

    const newStorage: AccountStorageV3 = {
      ...existing,
      accounts: filtered,
      activeIndex: Math.min(existing.activeIndex, Math.max(0, filtered.length - 1))
    };

    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const encrypted = keyManager.encrypt(newStorage);
    const content = JSON.stringify(encrypted, null, 2);

    try {
      await writeFileAtomicDurable(path, tempPath, content);
    } catch (error) {
      try { await fs.unlink(tempPath); } catch {}
      throw error;
    }
  });
}

export async function saveAccounts(storage: AccountStorageV3, overwrite: boolean = false): Promise<void> {
  const path = getStoragePath();
  const configDir = dirname(path);
  await fs.mkdir(configDir, { recursive: true });
  await ensureGitignore(configDir);
  // Best-effort sweep of crashed-writer temp files. Runs at most once per
  // process (memoized) so it never becomes a hot-path cost.
  await ensureTempCleanup(path);

  await withFileLock(path, async () => {
    const existing = await loadAccountsUnsafe();
    const merged = (existing && !overwrite) ? mergeAccountStorage(existing, storage) : storage;

    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const encrypted = keyManager.encrypt(merged);
    const content = JSON.stringify(encrypted, null, 2);

    try {
      await writeFileAtomicDurable(path, tempPath, content);
    } catch (error) {
      // Clean up temp file on failure to prevent accumulation
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors (file may not exist)
      }
      throw error;
    }
  });
}

async function loadAccountsUnsafe(): Promise<AccountStorageV3 | null> {
  try {
    const path = getStoragePath();
    let content = await fs.readFile(path, "utf-8");

    if (isEncrypted(content)) {
      try {
        // STRICT: Only v3 encryption allowed
        const data = JSON.parse(JSON.stringify(keyManager.decrypt(JSON.parse(content) as EncryptedPayload))) as AnyAccountStorage;
        if (data.version === 3) return data;
        if (data.version === 2) return migrateV2ToV3(data);
        if (data.version === 1) return migrateV2ToV3(migrateV1ToV2(data));
      } catch (err) {
        log.error("Failed to decrypt account storage in unsafe path", { error: String(err) });
      }
    } else {
      const data = JSON.parse(content) as AnyAccountStorage;
      if (data.version === 3) return data;
      if (data.version === 2) return migrateV2ToV3(data);
      if (data.version === 1) return migrateV2ToV3(migrateV1ToV2(data));
    }
  } catch {
    // Ignore errors in unsafe path
  }
  return null;
}

/**
 * Clears all accounts from storage.
 */
export async function clearAccounts(): Promise<void> {
  const path = getStoragePath();
  await ensureTempCleanup(path);
  await withFileLock(path, async () => {
    const emptyStorage: AccountStorageV3 = {
      version: 3,
      accounts: [],
      activeIndex: 0,
    };
    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const encrypted = keyManager.encrypt(emptyStorage);
    const content = JSON.stringify(encrypted, null, 2);
    try {
      await writeFileAtomicDurable(path, tempPath, content);
    } catch (error) {
      try { await fs.unlink(tempPath); } catch {}
      throw error;
    }
  });
}
