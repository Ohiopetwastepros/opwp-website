ALTER TABLE subscription_cancellations ADD COLUMN client_ref TEXT;
ALTER TABLE subscription_cancellations ADD COLUMN reason_category TEXT;
ALTER TABLE subscription_cancellations ADD COLUMN review_status TEXT NOT NULL DEFAULT 'Complete';
ALTER TABLE subscription_cancellations ADD COLUMN replacement_subscription_id TEXT;
ALTER TABLE subscription_cancellations ADD COLUMN reactivated_at TEXT;
ALTER TABLE subscription_cancellations ADD COLUMN lost_mrr REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_client_ref
  ON subscription_cancellations(client_ref, canceled_at);
