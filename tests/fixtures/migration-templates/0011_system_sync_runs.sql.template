CREATE TABLE IF NOT EXISTS system_sync_runs (
  id TEXT PRIMARY KEY,
  sync_name TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot_date TEXT,
  records_processed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_sync_runs_name_started
  ON system_sync_runs(sync_name, started_at DESC);
