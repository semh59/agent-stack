import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { xdgConfig } from "xdg-basedir";

export interface MissionDatabaseOptions {
  dbPath?: string;
}

type SqliteDatabase = Database.Database;

const MIGRATIONS = [
  { version: 1, fileName: "001_initial.sql" },
  { version: 2, fileName: "002_indexes.sql" },
  { version: 3, fileName: "003_quota_runtime.sql" },
] as const;

export const LATEST_MISSION_DB_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

const databaseInstances = new Map<string, MissionDatabase>();
let shutdownHooksInstalled = false;

function readMigration(fileName: string): string {
  const migrationPath = new URL(`./migrations/${fileName}`, import.meta.url);
  return fs.readFileSync(migrationPath, "utf8");
}

export function resolveMissionDatabasePath(override?: string): string {
  if (override) {
    return path.resolve(override);
  }

  const configRoot = xdgConfig ?? path.join(os.homedir(), ".config");
  return path.join(configRoot, "lojinext", "missions.db");
}

function ensureParentDirectory(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function timestampSuffix(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function moveCorruptFile(filePath: string, suffix: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const corruptPath = `${filePath}.corrupt.${suffix}`;
  fs.renameSync(filePath, corruptPath);
}

function installShutdownHooks(): void {
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

export class MissionDatabase {
  private db: SqliteDatabase;
  public readonly dbPath: string;
  public lastCorruptionNotice: string | null = null;

  constructor(options: MissionDatabaseOptions = {}) {
    this.dbPath = resolveMissionDatabasePath(options.dbPath);
    ensureParentDirectory(this.dbPath);
    this.db = this.openHealthyDatabase();
    installShutdownHooks();
  }

  public get connection(): SqliteDatabase {
    return this.db;
  }

  public get journalMode(): string {
    return String(this.db.pragma("journal_mode", { simple: true }));
  }

  public get userVersion(): number {
    return Number(this.db.pragma("user_version", { simple: true }));
  }

  public get isOpen(): boolean {
    return this.db.open;
  }

  public close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  public refresh(): void {
    this.close();
    this.db = this.openHealthyDatabase();
  }

  private openHealthyDatabase(): SqliteDatabase {
    let database: SqliteDatabase | undefined;
    try {
      database = this.openDatabaseFile();
      this.assertIntegrity(database);
    } catch (error) {
      try {
        database?.close();
      } catch {
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

  private openDatabaseFile(): SqliteDatabase {
    const database = new Database(this.dbPath);
    try {
      database.pragma("journal_mode = WAL");
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      return database;
    } catch (error) {
      try {
        database.close();
      } catch {
        // ignore close failure during initialization
      }
      throw error;
    }
  }

  private assertIntegrity(database: SqliteDatabase): void {
    try {
      const integrity = String(database.pragma("integrity_check", { simple: true }));
      if (integrity.toLowerCase() !== "ok") {
        throw new Error(`SQLite integrity_check failed: ${integrity}`);
      }
    } catch (error) {
      throw new Error("SQLite integrity check failed", {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  private runMigrations(database: SqliteDatabase): void {
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

export function getMissionDatabase(options: MissionDatabaseOptions = {}): MissionDatabase {
  const dbPath = resolveMissionDatabasePath(options.dbPath);
  const existing = databaseInstances.get(dbPath);
  if (existing) {
    return existing;
  }

  const database = new MissionDatabase({ dbPath });
  databaseInstances.set(dbPath, database);
  return database;
}

export function resetMissionDatabase(dbPath?: string): void {
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
