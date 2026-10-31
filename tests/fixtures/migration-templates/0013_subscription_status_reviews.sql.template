ALTER TABLE subscription_daily_snapshots ADD COLUMN pending_status_reviews INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS subscription_status_reviews (
  client_key TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  address TEXT,
  core_mrr REAL NOT NULL DEFAULT 0,
  addon_mrr REAL NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'open',
  first_missing_date TEXT NOT NULL,
  last_missing_date TEXT NOT NULL,
  consecutive_missing_days INTEGER NOT NULL DEFAULT 1,
  evidence TEXT,
  resolution TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_status_reviews_status
  ON subscription_status_reviews(review_status, last_missing_date);
