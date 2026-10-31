CREATE TABLE IF NOT EXISTS quote_follow_up_deliveries (
  id TEXT PRIMARY KEY,
  follow_up_id TEXT NOT NULL REFERENCES quote_follow_ups(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sng_lead','customer_email','customer_sms')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sending_at TEXT,
  sent_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  provider_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (follow_up_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_quote_follow_up_deliveries_due
  ON quote_follow_up_deliveries(status, next_attempt_at, channel);

INSERT OR IGNORE INTO quote_follow_up_deliveries
  (id, follow_up_id, submission_id, channel, status, provider_message_id, error_message, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, submission_id, 'customer_sms', status,
       provider_message_id, error_message, created_at, updated_at
FROM quote_follow_ups;
