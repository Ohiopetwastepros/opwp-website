-- PROPOSAL ONLY: reviewed additive source; production copy is byte-verified.
-- Additive review-request queue, customer reservation, consent controls and audit.
-- Contains schema only; no customer records, provider secrets or historical seeds.
CREATE TABLE review_request_settings (
  id TEXT PRIMARY KEY CHECK(id='automation'),
  enabled_at TEXT NOT NULL
);
CREATE TABLE review_request_customers (
  customer_key TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  do_not_contact INTEGER NOT NULL DEFAULT 0 CHECK(do_not_contact IN(0,1)),
  claimed_request_id TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE review_request_identities (
  alias_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL REFERENCES review_request_customers(customer_key)
);
CREATE TABLE review_requests (
  id TEXT PRIMARY KEY,
  customer_key TEXT REFERENCES review_request_customers(customer_key),
  customer_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  job_id TEXT NOT NULL UNIQUE,
  job_date TEXT NOT NULL,
  completed_at TEXT,
  job_type TEXT NOT NULL,
  tech TEXT NOT NULL DEFAULT '',
  page_slug TEXT NOT NULL,
  template_version TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE review_request_deliveries (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES review_requests(id),
  channel TEXT NOT NULL CHECK(channel IN('sms','email','none')),
  status TEXT NOT NULL CHECK(status IN('queued','sending','sent','skipped','failed')),
  reason TEXT,
  recipient TEXT NOT NULL DEFAULT '',
  email_hash TEXT,
  unsubscribe_token_hash TEXT UNIQUE,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sending_at TEXT,
  sent_at TEXT,
  skipped_at TEXT,
  failed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id,channel)
);
CREATE INDEX review_request_due ON review_request_deliveries(status,created_at);
CREATE TABLE review_request_unsubscribes (
  email_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE review_request_contact_audit (
  id TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL REFERENCES review_request_customers(customer_key),
  do_not_contact INTEGER NOT NULL CHECK(do_not_contact IN(0,1)),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
