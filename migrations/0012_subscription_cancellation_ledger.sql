CREATE TABLE IF NOT EXISTS subscription_cancellations (
  subscription_id TEXT PRIMARY KEY,
  source_event_id TEXT,
  business_line TEXT NOT NULL,
  client_name TEXT,
  client_address TEXT,
  plan TEXT,
  reason TEXT,
  comment TEXT,
  is_customer_churn INTEGER NOT NULL DEFAULT 0,
  canceled_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_line_date
  ON subscription_cancellations(business_line, canceled_at);
