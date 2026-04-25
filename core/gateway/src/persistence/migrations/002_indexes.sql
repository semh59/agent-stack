CREATE INDEX IF NOT EXISTS idx_missions_state_updated_at
ON missions(state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_missions_account_updated_at
ON missions(account, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_missions_review_status_updated_at
ON missions(review_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_timeline_mission_id_created_at
ON mission_timeline(mission_id, created_at);

CREATE INDEX IF NOT EXISTS idx_timeline_created_at
ON mission_timeline(created_at);

CREATE INDEX IF NOT EXISTS idx_budget_mission_id_created_at
ON mission_budget_snapshots(mission_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gate_mission_id_created_at
ON mission_gate_results(mission_id, created_at DESC);
