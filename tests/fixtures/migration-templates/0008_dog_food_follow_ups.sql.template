CREATE TABLE IF NOT EXISTS dog_food_follow_ups (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'cancelled', 'failed')),
  message_key TEXT NOT NULL DEFAULT 'dog_food_quote_reminder',
  consent_text TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  provider_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_follow_ups_queue
  ON dog_food_follow_ups(status, scheduled_at);
