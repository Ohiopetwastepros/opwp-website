CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  succeeded INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_fingerprint_time
  ON admin_login_attempts (fingerprint, occurred_at DESC);
