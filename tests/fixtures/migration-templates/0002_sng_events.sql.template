CREATE TABLE IF NOT EXISTS sng_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'sweep_and_go',
  external_id TEXT,
  customer_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sng_events_received_at
  ON sng_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sng_events_event_type
  ON sng_events(event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sng_events_external_id
  ON sng_events(external_id);
