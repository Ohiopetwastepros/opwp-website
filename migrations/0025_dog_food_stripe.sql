PRAGMA foreign_keys = ON;

ALTER TABLE dog_food_customers ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE dog_food_customers ADD COLUMN stripe_payment_method_id TEXT;
ALTER TABLE dog_food_customers ADD COLUMN card_brand TEXT;
ALTER TABLE dog_food_customers ADD COLUMN card_last_four TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dog_food_customers_stripe_customer
  ON dog_food_customers(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE dog_food_orders ADD COLUMN subscription_id TEXT REFERENCES dog_food_subscriptions(id);
ALTER TABLE dog_food_orders ADD COLUMN billing_cycle_key TEXT;
ALTER TABLE dog_food_orders ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE dog_food_orders ADD COLUMN checkout_expires_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dog_food_orders_stripe_checkout
  ON dog_food_orders(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dog_food_orders_subscription_cycle
  ON dog_food_orders(subscription_id, billing_cycle_key)
  WHERE subscription_id IS NOT NULL AND billing_cycle_key IS NOT NULL;

ALTER TABLE dog_food_subscriptions ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'external';
ALTER TABLE dog_food_subscriptions ADD COLUMN billing_interval_months INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dog_food_subscriptions ADD COLUMN billing_anchor_day INTEGER;
ALTER TABLE dog_food_subscriptions ADD COLUMN charge_lead_days INTEGER NOT NULL DEFAULT 2;
ALTER TABLE dog_food_subscriptions ADD COLUMN consent_at TEXT;
ALTER TABLE dog_food_subscriptions ADD COLUMN last_payment_at TEXT;

UPDATE dog_food_subscriptions
SET payment_provider='sng'
WHERE payment_method_token LIKE 'external:sng:%';

CREATE TABLE IF NOT EXISTS dog_food_payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_object_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_payment_events_status
  ON dog_food_payment_events(provider, status, received_at);
