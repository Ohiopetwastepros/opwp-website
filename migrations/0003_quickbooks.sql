CREATE TABLE IF NOT EXISTS quickbooks_oauth_states (
  state TEXT PRIMARY KEY,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id TEXT PRIMARY KEY,
  realm_id TEXT NOT NULL,
  company_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  access_token_expires_at TEXT NOT NULL,
  refresh_token_expires_at TEXT,
  scope TEXT,
  connected_by TEXT,
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_qb_oauth_states_expiry ON quickbooks_oauth_states(expires_at);
