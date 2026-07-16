CREATE TABLE IF NOT EXISTS airtable_cockpit_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_airtable_cockpit_snapshots_captured
  ON airtable_cockpit_snapshots(captured_at);
