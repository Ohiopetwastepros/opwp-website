CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'new',
  name TEXT,
  email TEXT,
  phone TEXT,
  zip TEXT,
  payload TEXT NOT NULL,
  sng_synced INTEGER NOT NULL DEFAULT 0,
  sng_response TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at
  ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_kind_status
  ON submissions(kind, status);
