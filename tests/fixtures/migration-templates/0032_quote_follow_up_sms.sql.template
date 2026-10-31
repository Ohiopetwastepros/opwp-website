CREATE TABLE IF NOT EXISTS quote_follow_ups (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel = 'sms'),
  recipient TEXT NOT NULL,
  template_key TEXT NOT NULL DEFAULT 'partial_quote_followup',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  consent_text TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  sending_at TEXT,
  sent_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  provider_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_follow_ups_delivery
  ON quote_follow_ups(status, scheduled_at);
