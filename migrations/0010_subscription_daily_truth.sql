CREATE TABLE IF NOT EXISTS subscription_client_baseline (
  client_key TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  address TEXT,
  core_subscription_count INTEGER NOT NULL DEFAULT 0,
  addon_subscription_count INTEGER NOT NULL DEFAULT 0,
  core_mrr REAL NOT NULL DEFAULT 0,
  addon_mrr REAL NOT NULL DEFAULT 0,
  total_mrr REAL NOT NULL DEFAULT 0,
  source_file TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_daily_snapshots (
  snapshot_date TEXT PRIMARY KEY,
  active_core_customers INTEGER NOT NULL DEFAULT 0,
  active_subscription_lines INTEGER NOT NULL DEFAULT 0,
  core_mrr REAL NOT NULL DEFAULT 0,
  addon_mrr REAL NOT NULL DEFAULT 0,
  total_mrr REAL NOT NULL DEFAULT 0,
  churned_customers INTEGER NOT NULL DEFAULT 0,
  lost_mrr REAL NOT NULL DEFAULT 0,
  reactivated_customers INTEGER NOT NULL DEFAULT 0,
  unmatched_live_clients INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'sng_daily_api',
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_client_daily (
  snapshot_date TEXT NOT NULL,
  client_key TEXT NOT NULL,
  sng_client_ref TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  core_mrr REAL NOT NULL DEFAULT 0,
  total_mrr REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_date, client_key)
);

CREATE INDEX IF NOT EXISTS idx_subscription_client_daily_active
  ON subscription_client_daily(snapshot_date, active);
