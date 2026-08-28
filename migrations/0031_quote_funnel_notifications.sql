ALTER TABLE submissions ADD COLUMN funnel_id TEXT;
ALTER TABLE submissions ADD COLUMN lifecycle_stage TEXT;
ALTER TABLE submissions ADD COLUMN sng_sync_state TEXT NOT NULL DEFAULT 'not_attempted';
ALTER TABLE submissions ADD COLUMN sng_entity_id TEXT;
ALTER TABLE submissions ADD COLUMN last_activity_at TEXT;

UPDATE submissions
SET last_activity_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE last_activity_at IS NULL;

CREATE UNIQUE INDEX idx_submissions_partial_funnel
  ON submissions(funnel_id)
  WHERE kind = 'partial_quote' AND funnel_id IS NOT NULL;

CREATE UNIQUE INDEX idx_submissions_onboarding_funnel
  ON submissions(funnel_id)
  WHERE kind = 'onboarding' AND funnel_id IS NOT NULL;

CREATE INDEX idx_submissions_funnel_activity
  ON submissions(kind, lifecycle_stage, last_activity_at DESC);

CREATE TABLE submission_notifications (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('partial_quote', 'question', 'waitlist', 'onboarding_succeeded', 'onboarding_failed')),
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sending_at TEXT,
  sent_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (submission_id, notification_type, recipient)
);

CREATE INDEX idx_submission_notifications_delivery
  ON submission_notifications(status, next_attempt_at, created_at);
