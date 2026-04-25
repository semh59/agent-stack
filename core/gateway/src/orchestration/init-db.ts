import path from 'path';

type SqliteOpen = (options: { filename: string; driver: unknown }) => Promise<{
  exec: (sql: string) => Promise<void>;
  get: (sql: string, params?: unknown[]) => Promise<unknown>;
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

async function initDB() {
  const { open, driver } = await loadSqliteRuntime();
  const dbPath = path.resolve(process.cwd(), '.agent/team_db.sqlite');
  const db = await open({
    filename: dbPath,
    driver,
  });

  console.log('Initializing database schema...');

  // 1. Agents Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'idle', -- idle, occupied, away
      last_report TEXT,
      metadata TEXT
    )
  `);

  // 2. Tasks Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending', -- pending, in_progress, completed, failed, paused
      pipeline TEXT, -- BUG_FIX, NEW_FEATURE, REFACTOR
      initial_specialist TEXT,
      assigned_agent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assigned_agent_id) REFERENCES agents(id)
    )
  `);

  // 3. Handoffs Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      from_agent_id INTEGER,
      to_agent_id INTEGER,
      report TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (from_agent_id) REFERENCES agents(id),
      FOREIGN KEY (to_agent_id) REFERENCES agents(id)
    )
  `);

  // 4. Checkpoints Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      workflow_step TEXT,
      context_snapshot TEXT, -- JSON snapshot of the state
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  // 5. Gate Reviews (Parallel Consensus)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS gate_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      reviewer_id INTEGER,
      status TEXT, -- 'approved', 'rejected'
      bfri_score INTEGER,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (reviewer_id) REFERENCES agents(id)
    )
  `);

  // 6. Pipeline Runs (execution history)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_task TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- pending, running, paused, completed, failed
      start_order INTEGER DEFAULT 1,
      current_agent TEXT,
      completed_agents TEXT, -- JSON array
      skipped_agents TEXT,   -- JSON array
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      total_duration_ms INTEGER,
      error_message TEXT
    )
  `);
  
  // 7. Vehicle Event Log (GDPR: 90 days limit)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id TEXT,
      event_type TEXT,
      payload TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 7. Populate 18 Pipeline Agents (5 layers)
  const initialAgents = [
    // MANAGEMENT
    { name: 'CEO', role: 'ceo', layer: 'management' },
    { name: 'Project Manager', role: 'pm', layer: 'management' },
    { name: 'Architect', role: 'architect', layer: 'management' },
    // DESIGN
    { name: 'UI/UX Designer', role: 'ui_ux', layer: 'design' },
    { name: 'Database Designer', role: 'database', layer: 'design' },
    { name: 'API Designer', role: 'api_designer', layer: 'design' },
    // DEVELOPMENT
    { name: 'Backend Developer', role: 'backend', layer: 'development' },
    { name: 'Frontend Developer', role: 'frontend', layer: 'development' },
    { name: 'Auth Developer', role: 'auth', layer: 'development' },
    { name: 'Integration Developer', role: 'integration', layer: 'development' },
    // QUALITY
    { name: 'Unit Tester', role: 'unit_test', layer: 'quality' },
    { name: 'Integration Tester', role: 'integration_test', layer: 'quality' },
    { name: 'Security Auditor', role: 'security', layer: 'quality' },
    { name: 'Performance Engineer', role: 'performance', layer: 'quality' },
    { name: 'Code Reviewer', role: 'code_review', layer: 'quality' },
    // OUTPUT
    { name: 'Documentation Writer', role: 'docs', layer: 'output' },
    { name: 'Tech Writer', role: 'tech_writer', layer: 'output' },
    { name: 'DevOps Engineer', role: 'devops', layer: 'output' },
  ];

  for (const agent of initialAgents) {
    const existing = await db.get('SELECT id FROM agents WHERE role = ?', [agent.role]);
    if (!existing) {
      await db.run('INSERT INTO agents (name, role) VALUES (?, ?)', [agent.name, agent.role]);
      console.log(`Agent added: ${agent.name} (${agent.role})`);
    }
  }

  console.log('Database initialization complete.');
  await db.close();
}

initDB().catch(console.error);
