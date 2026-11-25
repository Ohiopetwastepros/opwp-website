-- PROPOSAL ONLY. Apply only after separate production schema approval.
-- Contact profiles and invitation intents do not create portal credentials or charges.
CREATE TABLE dog_food_customer_profiles (
  customer_id TEXT PRIMARY KEY REFERENCES dog_food_customers(id),
  dog_count INTEGER NOT NULL CHECK(dog_count BETWEEN 1 AND 99),
  service_frequency TEXT NOT NULL CHECK(service_frequency IN('as_needed','weekly','biweekly','monthly')),
  preferred_fulfillment TEXT NOT NULL CHECK(preferred_fulfillment IN('pickup','delivery')),
  notes TEXT NOT NULL DEFAULT '', sms_consent_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_customer_commands (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dog_food_customer_messages (
  id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES dog_food_customer_commands(id),
  customer_id TEXT NOT NULL REFERENCES dog_food_customers(id),
  channel TEXT NOT NULL CHECK(channel IN('email','sms')), recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','accepted','suppressed','failed','uncertain','cancelled')),
  provider_message_id TEXT, detail TEXT, attempted_at TEXT, completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(command_id,channel)
);
CREATE INDEX idx_food_customer_messages_pending ON dog_food_customer_messages(status,created_at);
CREATE INDEX idx_food_customer_messages_customer ON dog_food_customer_messages(customer_id,created_at);
