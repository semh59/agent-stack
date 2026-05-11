"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GITIGNORE_ENTRIES = void 0;
exports.ensureGitignore = ensureGitignore;
exports.ensureGitignoreSync = ensureGitignoreSync;
exports.getStoragePath = getStoragePath;
exports.getConfigDir = getConfigDir;
exports.deduplicateAccountsByEmail = deduplicateAccountsByEmail;
exports.migrateV2ToV3 = migrateV2ToV3;
exports.loadAccountsDetailed = loadAccountsDetailed;
exports.loadAccounts = loadAccounts;
exports.deleteAccount = deleteAccount;
exports.saveAccounts = saveAccounts;
exports.clearAccounts = clearAccounts;
const node_fs_1 = require("node:fs");
const node_fs_2 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_crypto_1 = require("node:crypto");
const proper_lockfile_1 = __importDefault(require("proper-lockfile"));
const key_manager_1 = require("./key-manager");
const logger_1 = require("./logger");
const log = (0, logger_1.createLogger)("storage");
const keyManager = new key_manager_1.KeyManager();
/**
 * Files/directories that should be gitignored in the config directory.
 * These contain sensitive data or machine-specific state.
 */
exports.GITIGNORE_ENTRIES = [
    ".gitignore",
    "Alloy-accounts.json",
    "Alloy-accounts.json.*.tmp",
    "Alloy-signature-cache.json",
    "Alloy-logs/",
];
/**
 * Ensures a .gitignore file exists in the config directory with entries
 * for sensitive files. Creates the file if missing, or appends missing
 * entries if it already exists.
 */
async function ensureGitignore(configDir) {
    const gitignorePath = (0, node_path_1.join)(configDir, ".gitignore");
    try {
        let content;
        let existingLines = [];
        try {
            content = await node_fs_1.promises.readFile(gitignorePath, "utf-8");
            existingLines = content.split("\n").map((line) => line.trim());
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                return;
            }
            content = "";
        }
        const missingEntries = exports.GITIGNORE_ENTRIES.filter((entry) => !existingLines.includes(entry));
        if (missingEntries.length === 0) {
            return;
        }
        if (content === "") {
            await node_fs_1.promises.writeFile(gitignorePath, missingEntries.join("\n") + "\n", "utf-8");
            log.info("Created .gitignore in config directory");
        }
        else {
            const suffix = content.endsWith("\n") ? "" : "\n";
            await node_fs_1.promises.appendFile(gitignorePath, suffix + missingEntries.join("\n") + "\n", "utf-8");
            log.info("Updated .gitignore with missing entries", {
                added: missingEntries,
            });
        }
    }
    catch (error) {
        log.error("Failed to ensure .gitignore exists", { error: String(error) });
    }
}
/**
 * Synchronous version of ensureGitignore for use in sync code paths.
 */
function ensureGitignoreSync(configDir) {
    const gitignorePath = (0, node_path_1.join)(configDir, ".gitignore");
    try {
        let content;
        let existingLines = [];
        if ((0, node_fs_2.existsSync)(gitignorePath)) {
            content = (0, node_fs_2.readFileSync)(gitignorePath, "utf-8");
            existingLines = content.split("\n").map((line) => line.trim());
        }
        else {
            content = "";
        }
        const missingEntries = exports.GITIGNORE_ENTRIES.filter((entry) => !existingLines.includes(entry));
        if (missingEntries.length === 0) {
            return;
        }
        if (content === "") {
            (0, node_fs_2.writeFileSync)(gitignorePath, missingEntries.join("\n") + "\n", "utf-8");
            log.info("Created .gitignore in config directory");
        }
        else {
            const suffix = content.endsWith("\n") ? "" : "\n";
            (0, node_fs_2.appendFileSync)(gitignorePath, suffix + missingEntries.join("\n") + "\n", "utf-8");
            log.info("Updated .gitignore with missing entries", {
                added: missingEntries,
            });
        }
    }
    catch (error) {
        log.error("Failed to ensure .gitignore exists (sync)", { error: String(error) });
    }
}
/**
 * Gets the legacy Windows config directory (%APPDATA%\Alloy).
 * Used for migration from older plugin versions.
 */
function getLegacyWindowsConfigDir() {
    return (0, node_path_1.join)(process.env.APPDATA || (0, node_path_1.join)((0, node_os_1.homedir)(), "AppData", "Roaming"), "Alloy");
}
/**
 * Gets the config directory path, with the following precedence:
 * 1. Alloy_CONFIG_DIR env var (if set)
 * 2. ~/.config/Alloy (all platforms, including Windows)
 *
 * On Windows, also checks for legacy %APPDATA%\Alloy path for migration.
 */
function getConfigDir() {
    // 1. Check for explicit override via env var
    if (process.env.Alloy_CONFIG_DIR) {
        return process.env.Alloy_CONFIG_DIR;
    }
    // 2. Use ~/.config/Alloy on all platforms (including Windows)
    const xdgConfig = process.env.XDG_CONFIG_HOME || (0, node_path_1.join)((0, node_os_1.homedir)(), ".config");
    return (0, node_path_1.join)(xdgConfig, "Alloy");
}
/**
 * Migrates config from legacy Windows location to the new path.
 * Moves the file if legacy exists and new doesn't.
 * Returns true if migration was performed.
 */
function migrateLegacyWindowsConfig() {
    if (process.platform !== "win32") {
        return false;
    }
    const newPath = (0, node_path_1.join)(getConfigDir(), "Alloy-accounts.json");
    const legacyPath = (0, node_path_1.join)(getLegacyWindowsConfigDir(), "Alloy-accounts.json");
    // Only migrate if legacy exists and new doesn't
    if (!(0, node_fs_2.existsSync)(legacyPath) || (0, node_fs_2.existsSync)(newPath)) {
        return false;
    }
    try {
        // Ensure new config directory exists
        const newConfigDir = getConfigDir();
        (0, node_fs_2.mkdirSync)(newConfigDir, { recursive: true });
        // Try rename first (atomic, but fails across filesystems)
        try {
            (0, node_fs_2.renameSync)(legacyPath, newPath);
            log.info("Migrated Windows config via rename", { from: legacyPath, to: newPath });
        }
        catch {
            // Fallback: copy then delete (for cross-filesystem moves)
            (0, node_fs_2.copyFileSync)(legacyPath, newPath);
            (0, node_fs_2.unlinkSync)(legacyPath);
            log.info("Migrated Windows config via copy+delete", { from: legacyPath, to: newPath });
        }
        return true;
    }
    catch (error) {
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
function getStoragePathWithMigration() {
    const newPath = (0, node_path_1.join)(getConfigDir(), "Alloy-accounts.json");
    // On Windows, attempt to migrate legacy config to new location
    if (process.platform === "win32") {
        migrateLegacyWindowsConfig();
        // If migration failed and legacy still exists, fall back to it
        if (!(0, node_fs_2.existsSync)(newPath)) {
            const legacyPath = (0, node_path_1.join)(getLegacyWindowsConfigDir(), "Alloy-accounts.json");
            if ((0, node_fs_2.existsSync)(legacyPath)) {
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
function getStoragePath() {
    return getStoragePathWithMigration();
}
/**
 * â”€â”€â”€ ENCRYPTION UTILITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Note: Legacy AES-256-GCM (v2) methods removed for strict v3-only standard.
 */
function isEncrypted(content) {
    if (!content)
        return false;
    return key_manager_1.KeyManager.isV3Encrypted(content);
}
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
async function writeFileAtomicDurable(path, tempPath, content) {
    // 1. Write data to the temp file and fsync its contents before rename.
    const fd = await node_fs_1.promises.open(tempPath, "w");
    try {
        await fd.writeFile(content, "utf-8");
        await fd.sync();
    }
    finally {
        await fd.close();
    }
    // 2. Atomic rename — visible to readers only once the new bytes are
    //    durable on disk. rename(2) is atomic within a single filesystem.
    await node_fs_1.promises.rename(tempPath, path);
    // 3. fsync the containing directory so the rename metadata is durable
    //    too. On platforms (Windows) where opening a directory fails, this
    //    is a best-effort no-op — the rename itself is still the ordering
    //    boundary and is enough in the common case.
    try {
        const dirFd = await node_fs_1.promises.open((0, node_path_1.dirname)(path), "r");
        try {
            await dirFd.sync();
        }
        finally {
            await dirFd.close();
        }
    }
    catch {
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
async function cleanupOrphanedTempFiles(storagePath) {
    try {
        const dir = (0, node_path_1.dirname)(storagePath);
        const base = storagePath.substring(dir.length + 1);
        const entries = await node_fs_1.promises.readdir(dir);
        const prefix = `${base}.`;
        const suffix = ".tmp";
        for (const entry of entries) {
            if (!entry.startsWith(prefix) || !entry.endsWith(suffix))
                continue;
            // Only remove files older than 60s to avoid racing with a concurrent
            // writer that is mid-rename.
            const full = (0, node_path_1.join)(dir, entry);
            try {
                const stat = await node_fs_1.promises.stat(full);
                if (Date.now() - stat.mtimeMs > 60_000) {
                    await node_fs_1.promises.unlink(full);
                    log.info("Cleaned up stale storage temp file", { file: entry });
                }
            }
            catch {
                // mtime/unlink race — ignore.
            }
        }
    }
    catch {
        // directory missing or unreadable — nothing to clean, keep going.
    }
}
let tempCleanupPromise = null;
function ensureTempCleanup(storagePath) {
    if (!tempCleanupPromise) {
        tempCleanupPromise = cleanupOrphanedTempFiles(storagePath);
    }
    return tempCleanupPromise;
}
const inProcessPathLocks = new Map();
async function acquireInProcessPathLock(path) {
    const key = (0, node_path_1.resolve)(path);
    let lockState = inProcessPathLocks.get(key);
    if (!lockState) {
        lockState = { locked: false, waiters: [] };
        inProcessPathLocks.set(key, lockState);
    }
    if (lockState.locked) {
        await new Promise((resolveWaiter) => {
            lockState.waiters.push(resolveWaiter);
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
async function ensureFileExists(path) {
    try {
        await node_fs_1.promises.access(path);
    }
    catch {
        await node_fs_1.promises.mkdir((0, node_path_1.dirname)(path), { recursive: true });
        await node_fs_1.promises.writeFile(path, JSON.stringify({ version: 3, accounts: [], activeIndex: 0 }, null, 2), "utf-8");
    }
}
async function withFileLock(path, fn) {
    const releaseInProcessLock = await acquireInProcessPathLock(path);
    let release = null;
    try {
        await ensureFileExists(path);
        release = await proper_lockfile_1.default.lock(path, LOCK_OPTIONS);
        return await fn();
    }
    finally {
        if (release) {
            try {
                await release();
            }
            catch (unlockError) {
                log.warn("Failed to release lock", { error: String(unlockError) });
            }
        }
        releaseInProcessLock();
    }
}
function mergeAccountStorage(existing, incoming) {
    const accountMap = new Map();
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
            }
            else {
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
function deduplicateAccountsByEmail(accounts) {
    const emailToNewestIndex = new Map();
    const indicesToKeep = new Set();
    // First pass: find the newest account for each email (by lastUsed, then addedAt)
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        if (!acc)
            continue;
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
        const isNewer = currLastUsed > existLastUsed ||
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
    const result = [];
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
function migrateV1ToV2(v1) {
    return {
        version: 2,
        accounts: v1.accounts.map((acc) => {
            const rateLimitResetTimes = {};
            if (acc.isRateLimited &&
                acc.rateLimitResetTime &&
                acc.rateLimitResetTime > Date.now()) {
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
                rateLimitResetTimes: Object.keys(rateLimitResetTimes).length > 0
                    ? rateLimitResetTimes
                    : undefined,
            };
        }),
        activeIndex: v1.activeIndex,
    };
}
function migrateV2ToV3(v2) {
    return {
        version: 3,
        accounts: v2.accounts.map((acc) => {
            const rateLimitResetTimes = {};
            if (acc.rateLimitResetTimes?.claude &&
                acc.rateLimitResetTimes.claude > Date.now()) {
                rateLimitResetTimes.claude = acc.rateLimitResetTimes.claude;
            }
            if (acc.rateLimitResetTimes?.gemini &&
                acc.rateLimitResetTimes.gemini > Date.now()) {
                rateLimitResetTimes["gemini-Alloy"] =
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
                rateLimitResetTimes: Object.keys(rateLimitResetTimes).length > 0
                    ? rateLimitResetTimes
                    : undefined,
            };
        }),
        activeIndex: v2.activeIndex,
    };
}
async function loadAccountsDetailed() {
    try {
        const path = getStoragePath();
        let content = await node_fs_1.promises.readFile(path, "utf-8");
        // Auto-decrypt if needed
        if (isEncrypted(content)) {
            try {
                // STRICT: Only v3 encryption allowed
                content = JSON.stringify(keyManager.decrypt(JSON.parse(content)));
            }
            catch (err) {
                log.error("Failed to decrypt account storage (v3 required)", { error: String(err) });
                return {
                    status: "error",
                    errorCode: "DECRYPT_ERROR",
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        }
        let data;
        try {
            data = JSON.parse(content);
        }
        catch (err) {
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
        let storage;
        if (data.version === 1) {
            log.info("Migrating account storage from v1 to v3");
            const v2 = migrateV1ToV2(data);
            storage = migrateV2ToV3(v2);
            try {
                await saveAccounts(storage);
                log.info("Migration to v3 complete");
            }
            catch (saveError) {
                log.warn("Failed to persist migrated storage", {
                    error: String(saveError),
                });
            }
        }
        else if (data.version === 2) {
            log.info("Migrating account storage from v2 to v3");
            storage = migrateV2ToV3(data);
            try {
                await saveAccounts(storage);
                log.info("Migration to v3 complete");
            }
            catch (saveError) {
                log.warn("Failed to persist migrated storage", {
                    error: String(saveError),
                });
            }
        }
        else if (data.version === 3) {
            storage = data;
        }
        else {
            log.warn("Unknown storage version, ignoring", {
                version: data.version,
            });
            return {
                status: "error",
                errorCode: "UNKNOWN_VERSION",
                error: `Unsupported storage version: ${String(data.version ?? "unknown")}`,
            };
        }
        // Validate accounts have required fields
        const validAccounts = storage.accounts.filter((a) => {
            return (!!a &&
                typeof a === "object" &&
                typeof a.refreshToken === "string");
        });
        // Deduplicate accounts by email (keeps newest entry for each email)
        const deduplicatedAccounts = deduplicateAccountsByEmail(validAccounts);
        // Clamp activeIndex to valid range after deduplication
        let activeIndex = typeof storage.activeIndex === "number" &&
            Number.isFinite(storage.activeIndex)
            ? storage.activeIndex
            : 0;
        if (deduplicatedAccounts.length > 0) {
            activeIndex = Math.min(activeIndex, deduplicatedAccounts.length - 1);
            activeIndex = Math.max(activeIndex, 0);
        }
        else {
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
    }
    catch (error) {
        const code = error.code;
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
async function loadAccounts() {
    const result = await loadAccountsDetailed();
    if (result.status === "ok") {
        return result.storage;
    }
    return null;
}
async function deleteAccount(refreshToken) {
    const path = getStoragePath();
    await ensureTempCleanup(path);
    await withFileLock(path, async () => {
        const existing = await loadAccountsUnsafe();
        if (!existing)
            return;
        const filtered = existing.accounts.filter(acc => acc.refreshToken !== refreshToken);
        if (filtered.length === existing.accounts.length)
            return; // Not found
        const newStorage = {
            ...existing,
            accounts: filtered,
            activeIndex: Math.min(existing.activeIndex, Math.max(0, filtered.length - 1))
        };
        const tempPath = `${path}.${(0, node_crypto_1.randomBytes)(6).toString("hex")}.tmp`;
        const encrypted = keyManager.encrypt(newStorage);
        const content = JSON.stringify(encrypted, null, 2);
        try {
            await writeFileAtomicDurable(path, tempPath, content);
        }
        catch (error) {
            try {
                await node_fs_1.promises.unlink(tempPath);
            }
            catch { }
            throw error;
        }
    });
}
async function saveAccounts(storage, overwrite = false) {
    const path = getStoragePath();
    const configDir = (0, node_path_1.dirname)(path);
    await node_fs_1.promises.mkdir(configDir, { recursive: true });
    await ensureGitignore(configDir);
    // Best-effort sweep of crashed-writer temp files. Runs at most once per
    // process (memoized) so it never becomes a hot-path cost.
    await ensureTempCleanup(path);
    await withFileLock(path, async () => {
        const existing = await loadAccountsUnsafe();
        const merged = (existing && !overwrite) ? mergeAccountStorage(existing, storage) : storage;
        const tempPath = `${path}.${(0, node_crypto_1.randomBytes)(6).toString("hex")}.tmp`;
        const encrypted = keyManager.encrypt(merged);
        const content = JSON.stringify(encrypted, null, 2);
        try {
            await writeFileAtomicDurable(path, tempPath, content);
        }
        catch (error) {
            // Clean up temp file on failure to prevent accumulation
            try {
                await node_fs_1.promises.unlink(tempPath);
            }
            catch {
                // Ignore cleanup errors (file may not exist)
            }
            throw error;
        }
    });
}
async function loadAccountsUnsafe() {
    try {
        const path = getStoragePath();
        const content = await node_fs_1.promises.readFile(path, "utf-8");
        if (isEncrypted(content)) {
            try {
                // STRICT: Only v3 encryption allowed
                const data = JSON.parse(JSON.stringify(keyManager.decrypt(JSON.parse(content))));
                if (data.version === 3)
                    return data;
                if (data.version === 2)
                    return migrateV2ToV3(data);
                if (data.version === 1)
                    return migrateV2ToV3(migrateV1ToV2(data));
            }
            catch (err) {
                log.error("Failed to decrypt account storage in unsafe path", { error: String(err) });
            }
        }
        else {
            const data = JSON.parse(content);
            if (data.version === 3)
                return data;
            if (data.version === 2)
                return migrateV2ToV3(data);
            if (data.version === 1)
                return migrateV2ToV3(migrateV1ToV2(data));
        }
    }
    catch {
        // Ignore errors in unsafe path
    }
    return null;
}
/**
 * Clears all accounts from storage.
 */
async function clearAccounts() {
    const path = getStoragePath();
    await ensureTempCleanup(path);
    await withFileLock(path, async () => {
        const emptyStorage = {
            version: 3,
            accounts: [],
            activeIndex: 0,
        };
        const tempPath = `${path}.${(0, node_crypto_1.randomBytes)(6).toString("hex")}.tmp`;
        const encrypted = keyManager.encrypt(emptyStorage);
        const content = JSON.stringify(encrypted, null, 2);
        try {
            await writeFileAtomicDurable(path, tempPath, content);
        }
        catch (error) {
            try {
                await node_fs_1.promises.unlink(tempPath);
            }
            catch { }
            throw error;
        }
    });
}
//# sourceMappingURL=storage.js.map