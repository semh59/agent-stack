import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_MISSION_DB_SCHEMA_VERSION, MissionDatabase } from "./database";

async function createTempDbPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alloy-db-"));
  return path.join(dir, "missions.db");
}

describe("MissionDatabase", () => {
  const cleanupPaths = new Set<string>();

  afterEach(async () => {
    for (const dbPath of cleanupPaths) {
      try {
        await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
    cleanupPaths.clear();
  });

  it("opens the database, runs migrations idempotently, and enables WAL", async () => {
    const dbPath = await createTempDbPath();
    cleanupPaths.add(dbPath);

    const database = new MissionDatabase({ dbPath });
    expect(database.isOpen).toBe(true);
    expect(database.journalMode.toLowerCase()).toBe("wal");
    expect(database.userVersion).toBe(LATEST_MISSION_DB_SCHEMA_VERSION);

    database.refresh();
    expect(database.userVersion).toBe(LATEST_MISSION_DB_SCHEMA_VERSION);
    database.close();
  });

  it("renames a corrupt DB and recreates a clean file", async () => {
    const dbPath = await createTempDbPath();
    cleanupPaths.add(dbPath);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, "not a sqlite database", "utf8");

    const database = new MissionDatabase({ dbPath });
    expect(database.lastCorruptionNotice).toContain("Veritabani bozulmustu");

    const entries = await fs.readdir(path.dirname(dbPath));
    expect(entries.some((entry) => entry.startsWith("missions.db.corrupt."))).toBe(true);
    expect(entries).toContain("missions.db");
    database.close();
  });

  it("closes the connection cleanly", async () => {
    const dbPath = await createTempDbPath();
    cleanupPaths.add(dbPath);

    const database = new MissionDatabase({ dbPath });
    expect(database.isOpen).toBe(true);
    database.close();
    expect(database.isOpen).toBe(false);
  });
});
