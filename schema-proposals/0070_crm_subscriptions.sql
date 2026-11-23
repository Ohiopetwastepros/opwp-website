-- REVIEW PROPOSAL ONLY. Not registered in production migrations or applied to D1.
-- Local tests execute this schema only in isolated in-memory SQLite databases.
PRAGMA foreign_keys = ON;

CREATE TABLE crm_subscription_customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_by TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id,id)
);
CREATE TABLE crm_subscription_books (
  organization_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version > 0),
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  updated_by TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE crm_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(organization_id,customer_id) REFERENCES crm_subscription_customers(organization_id,id),
  CHECK(json_extract(state_json,'$.id')=id),
  CHECK(json_extract(state_json,'$.customerId')=customer_id),
  CHECK(json_extract(state_json,'$.revision')=revision)
);
CREATE INDEX crm_subscriptions_customer ON crm_subscriptions(organization_id,customer_id,id);
CREATE TABLE crm_subscription_previews (
  token TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE crm_subscription_commands (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL
);
CREATE TABLE crm_subscription_portal_links (
  account_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verification_reason TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  FOREIGN KEY(organization_id,customer_id) REFERENCES crm_subscription_customers(organization_id,id)
);
CREATE INDEX crm_subscription_portal_customer ON crm_subscription_portal_links(organization_id,customer_id);

-- Transient compare-and-swap guards live only inside one atomic db.batch.
-- A failed guard aborts the ENTIRE command, including its receipt and invoice.
CREATE TABLE crm_subscription_write_guards (
  id TEXT PRIMARY KEY,
  expected_revision INTEGER NOT NULL,
  actual_revision INTEGER NOT NULL,
  CONSTRAINT crm_subscription_revision_conflict CHECK(expected_revision=actual_revision)
);
