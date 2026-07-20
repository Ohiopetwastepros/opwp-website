PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dog_food_payment_setup_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  order_id TEXT REFERENCES dog_food_orders(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'expired', 'cancelled')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dog_food_payment_setup_customer
  ON dog_food_payment_setup_sessions(customer_id, created_at DESC);
