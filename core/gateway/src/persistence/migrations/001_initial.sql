CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  account TEXT NOT NULL,
  state TEXT NOT NULL,
  current_phase TEXT,
  current_gear TEXT,
  current_model TEXT,
  review_status TEXT NOT NULL DEFAULT 'none',
  review_updated_at TEXT,
  anchor_model TEXT NOT NULL,
  scope_paths_json TEXT NOT NULL DEFAULT '[]',
  strict_mode INTEGER NOT NULL DEFAULT 1,
  plan_json TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  touched_files_json TEXT NOT NULL DEFAULT '[]',
  timeline_json TEXT NOT NULL DEFAULT '[]',
  gate_results_json TEXT NOT NULL DEFAULT '[]',
  budget_json TEXT NOT NULL,
  error TEXT,
  stop_reason TEXT,
  runtime_snapshot_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS mission_gate_results (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  phase TEXT,
  passed INTEGER NOT NULL,
  strict_mode INTEGER NOT NULL,
  impacted_scopes_json TEXT NOT NULL DEFAULT '[]',
  commands_json TEXT NOT NULL DEFAULT '[]',
  blocking_issues_json TEXT NOT NULL DEFAULT '[]',
  audit_summary_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  event_hash TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_timeline (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  event_hash TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_budget_snapshots (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  tpm_used INTEGER NOT NULL DEFAULT 0,
  tpm_limit INTEGER NOT NULL DEFAULT 0,
  rpd_used INTEGER NOT NULL DEFAULT 0,
  rpd_limit INTEGER NOT NULL DEFAULT 0,
  cycles_used INTEGER NOT NULL DEFAULT 0,
  cycles_limit INTEGER NOT NULL DEFAULT 0,
  efficiency REAL NOT NULL DEFAULT 0,
  warning_active INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  event_hash TEXT UNIQUE,
  created_at TEXT NOT NULL
);
