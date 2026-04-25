CREATE TABLE IF NOT EXISTS account_quota_token_events (
  id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_quota_request_events (
  id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_quota_reservations (
  reservation_id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  lease_expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quota_token_events_account_created_at
ON account_quota_token_events(account_key, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_quota_request_events_account_created_at
ON account_quota_request_events(account_key, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_quota_reservations_account_lease
ON account_quota_reservations(account_key, lease_expires_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_quota_reservations_session
ON account_quota_reservations(session_id);
