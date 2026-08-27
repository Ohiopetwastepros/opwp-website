CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope TEXT NOT NULL,
  client_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, client_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry
  ON api_rate_limits(expires_at);
