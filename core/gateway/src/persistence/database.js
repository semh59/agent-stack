"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.database = exports.MissionDatabase = exports.LATEST_MISSION_DB_SCHEMA_VERSION = void 0;
exports.resolveMissionDatabasePath = resolveMissionDatabasePath;
exports.getMissionDatabase = getMissionDatabase;
exports.resetMissionDatabase = resetMissionDatabase;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const xdg_basedir_1 = require("xdg-basedir");
const MIGRATIONS = [
    { version: 1, fileName: "001_initial.sql" },
    { version: 2, fileName: "002_indexes.sql" },
    { version: 3, fileName: "003_quota_runtime.sql" },
    { version: 4, fileName: "004_chat_persistence.sql" },
];
exports.LATEST_MISSION_DB_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
const databaseInstances = new Map();
let shutdownHooksInstalled = false;
function readMigration(fileName) {
    const migrationPath = new URL(`./migrations/${fileName}`, import.meta.url);
    return node_fs_1.default.readFileSync(migrationPath, "utf8");
}
function resolveMissionDatabasePath(override) {
    if (override) {
        return node_path_1.default.resolve(override);
    }
    const configRoot = xdg_basedir_1.xdgConfig ?? node_path_1.default.join(node_os_1.default.homedir(), ".config");
    return node_path_1.default.join(configRoot, "alloy", "missions.db");
}
function ensureParentDirectory(dbPath) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(dbPath), { recursive: true });
}
function timestampSuffix() {
    return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}
function moveCorruptFile(filePath, suffix) {
    if (!node_fs_1.default.existsSync(filePath)) {
        return;
    }
    const corruptPath = `${filePath}.corrupt.${suffix}`;
    node_fs_1.default.renameSync(filePath, corruptPath);
}
function installShutdownHooks() {
    if (shutdownHooksInstalled) {
        return;
    }
    const shutdown = () => {
        for (const database of databaseInstances.values()) {
            database.close();
        }
        databaseInstances.clear();
    };
    process.on("exit", shutdown);
    process.on("SIGINT", () => {
        shutdown();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        shutdown();
        process.exit(0);
    });
    shutdownHooksInstalled = true;
}
class MissionDatabase {
    db;
    dbPath;
    lastCorruptionNotice = null;
    constructor(options = {}) {
        this.dbPath = resolveMissionDatabasePath(options.dbPath);
        ensureParentDirectory(this.dbPath);
        this.db = this.openHealthyDatabase();
        installShutdownHooks();
    }
    get connection() {
        return this.db;
    }
    get journalMode() {
        return String(this.db.pragma("journal_mode", { simple: true }));
    }
    get userVersion() {
        return Number(this.db.pragma("user_version", { simple: true }));
    }
    get isOpen() {
        return this.db.open;
    }
    close() {
        if (this.db.open) {
            this.db.close();
        }
    }
    refresh() {
        this.close();
        this.db = this.openHealthyDatabase();
    }
    openHealthyDatabase() {
        let database;
        try {
            database = this.openDatabaseFile();
            this.assertIntegrity(database);
        }
        catch {
            try {
                database?.close();
            }
            catch {
                // ignore close failure during corruption recovery
            }
            const suffix = timestampSuffix();
            moveCorruptFile(this.dbPath, suffix);
            moveCorruptFile(`${this.dbPath}-wal`, suffix);
            moveCorruptFile(`${this.dbPath}-shm`, suffix);
            this.lastCorruptionNotice =
                "Veritabani bozulmustu, yedek alindi, temiz basliyoruz.";
            database = this.openDatabaseFile();
        }
        if (!database) {
            throw new Error("Mission database failed to initialize");
        }
        this.runMigrations(database);
        return database;
    }
    openDatabaseFile() {
        const database = new better_sqlite3_1.default(this.dbPath);
        try {
            database.pragma("journal_mode = WAL");
            database.pragma("foreign_keys = ON");
            database.pragma("busy_timeout = 5000");
            return database;
        }
        catch (error) {
            try {
                database.close();
            }
            catch {
                // ignore close failure during initialization
            }
            throw error;
        }
    }
    assertIntegrity(database) {
        try {
            const integrity = String(database.pragma("integrity_check", { simple: true }));
            if (integrity.toLowerCase() !== "ok") {
                throw new Error(`SQLite integrity_check failed: ${integrity}`);
            }
        }
        catch (error) {
            throw new Error("SQLite integrity check failed", {
                cause: error instanceof Error ? error : undefined,
            });
        }
    }
    runMigrations(database) {
        const currentVersion = Number(database.pragma("user_version", { simple: true }));
        for (const migration of MIGRATIONS) {
            if (migration.version <= currentVersion) {
                continue;
            }
            const sql = readMigration(migration.fileName);
            database.exec(sql);
            database.pragma(`user_version = ${migration.version}`);
        }
    }
}
exports.MissionDatabase = MissionDatabase;
function getMissionDatabase(options = {}) {
    const dbPath = resolveMissionDatabasePath(options.dbPath);
    const existing = databaseInstances.get(dbPath);
    if (existing) {
        return existing;
    }
    const database = new MissionDatabase({ dbPath });
    databaseInstances.set(dbPath, database);
    return database;
}
function resetMissionDatabase(dbPath) {
    if (dbPath) {
        const resolved = resolveMissionDatabasePath(dbPath);
        const existing = databaseInstances.get(resolved);
        existing?.close();
        databaseInstances.delete(resolved);
        return;
    }
    for (const database of databaseInstances.values()) {
        database.close();
    }
    databaseInstances.clear();
}
exports.database = getMissionDatabase();
//# sourceMappingURL=database.js.map