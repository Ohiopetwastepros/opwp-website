CREATE TABLE IF NOT EXISTS subscription_pauses (
  pause_id TEXT PRIMARY KEY,
  subscription_id TEXT,
  source_event_id TEXT,
  business_line TEXT NOT NULL,
  client_ref TEXT,
  client_name TEXT,
  plan TEXT,
  reason TEXT,
  comment TEXT,
  paused_at TEXT NOT NULL,
  planned_resume_date TEXT,
  resumed_at TEXT,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'resumed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_pauses_open
  ON subscription_pauses(subscription_id, client_ref, status, paused_at);

CREATE INDEX IF NOT EXISTS idx_subscription_pauses_client
  ON subscription_pauses(client_name, status, paused_at);
