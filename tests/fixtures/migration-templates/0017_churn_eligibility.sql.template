ALTER TABLE subscription_cancellations ADD COLUMN eligibility_status TEXT NOT NULL DEFAULT 'Needs Validation';
ALTER TABLE subscription_cancellations ADD COLUMN eligibility_evidence TEXT;

CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_eligibility
  ON subscription_cancellations(eligibility_status, business_line, canceled_at);
