import path from 'path';

type SqliteOpen = (options: { filename: string; driver: unknown }) => Promise<{
  exec: (sql: string) => Promise<void>;
  run: (sql: string, params?: unknown[]) => Promise<unknown>;
  close: () => Promise<void>;
}>;

async function loadSqliteRuntime(): Promise<{ open: SqliteOpen; driver: unknown }> {
  try {
    const sqliteModuleName = 'sqlite';
    const sqlite3ModuleName = 'sqlite3';
    const sqliteModule = (await import(sqliteModuleName)) as { open?: SqliteOpen };
    const sqlite3Module = (await import(sqlite3ModuleName)) as {
      default?: { Database?: unknown };
      Database?: unknown;
    };

    const open = sqliteModule.open;
    const driver = sqlite3Module.default?.Database ?? sqlite3Module.Database;
    if (!open || !driver) {
      throw new Error('sqlite runtime exports are missing');
    }

    return { open, driver };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SQLite tooling dependencies are optional and missing (${message}). ` +
      'Install them for DB tooling only: npm install sqlite sqlite3 --no-save',
    );
  }
}

async function seed() {
  const { open, driver } = await loadSqliteRuntime();
  const dbPath = path.resolve(process.cwd(), '.agent/team_db.sqlite');
  const db = await open({
    filename: dbPath,
    driver,
  });

  console.log("Seeding database...");

  // Init tables (idempotent)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      role TEXT,
      status TEXT,
      last_report TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      priority INTEGER,
      status TEXT,
      pipeline TEXT,
      initial_specialist TEXT,
      assigned_agent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      from_agent_id INTEGER,
      to_agent_id INTEGER,
      report TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS gate_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      reviewer_id INTEGER,
      status TEXT,
      bfri_score REAL,
      comment TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Clear and add agents
  await db.run('DELETE FROM agents');
  await db.run('INSERT INTO agents (name, role, status) VALUES (?, ?, ?)', ['Ahmet', 'Lead Architect', 'occupied']);
  await db.run('INSERT INTO agents (name, role, status) VALUES (?, ?, ?)', ['Zeynep', 'Backend Expert', 'idle']);
  await db.run('INSERT INTO agents (name, role, status) VALUES (?, ?, ?)', ['Can', 'Frontend Expert', 'idle']);
  await db.run('INSERT INTO agents (name, role, status) VALUES (?, ?, ?)', ['Elif', 'QA Specialist', 'idle']);

  // Add a sample task
  await db.run('DELETE FROM tasks');
  await db.run(
    'INSERT INTO tasks (title, description, priority, status, pipeline, initial_specialist, assigned_agent_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['Upgrade Auth System to OAuth 2.1', 'Implementing secure handoffs and model selection logic.', 1, 'in_progress', 'NEW_FEATURE', 'backend', 1]
  );

  console.log("Database seeded successfully.");
  await db.close();
}

seed().catch(err => console.error(err));
