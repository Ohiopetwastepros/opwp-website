-- Proposed NEW production migration. Not part of the immutable migration archive.
-- Separate database authorization is required before installation anywhere live.
CREATE TABLE winback_settings (
  organization_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  kill_switch INTEGER NOT NULL DEFAULT 1 CHECK(kill_switch IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO winback_settings(organization_id) VALUES('org-opwp');
CREATE TABLE winback_campaigns (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  kill_switch INTEGER NOT NULL DEFAULT 1 CHECK(kill_switch IN (0,1)),
  copy_json TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  review_enabled INTEGER NOT NULL DEFAULT 0 CHECK(review_enabled IN (0,1)),
  card_mode TEXT NOT NULL DEFAULT 'text_only' CHECK(card_mode='text_only'),
  approved_by TEXT,
  approval_evidence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE winback_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES winback_campaigns(id),
  phone_hash TEXT NOT NULL,
  phone TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL CHECK(version IN ('V1','V2')),
  batch INTEGER NOT NULL CHECK(batch>0),
  card_variant TEXT NOT NULL CHECK(card_variant IN ('A','B')),
  card_eligible INTEGER NOT NULL DEFAULT 0 CHECK(card_eligible IN (0,1)),
  card_filename TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed','replied','opted_out','skipped')),
  skip_reason TEXT,
  provider_message_id TEXT,
  submission_id TEXT,
  attempted_at TEXT,
  sent_at TEXT,
  replied_at TEXT,
  positive_at TEXT,
  quote_requested_at TEXT,
  signup_at TEXT,
  opted_out_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campaign_id,phone_hash)
);
CREATE INDEX winback_queue ON winback_recipients(campaign_id,batch,status);
CREATE INDEX winback_phone ON winback_recipients(phone_hash,status);
CREATE TABLE winback_days (
  organization_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES winback_campaigns(id),
  batch INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
  last_attempt_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,local_date)
);
CREATE TABLE winback_deliveries (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES winback_recipients(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('initial','reply')),
  trigger_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','reserved','sending','sent','failed','unknown','cancelled')),
  provider_message_id TEXT,
  error_code TEXT,
  message_body TEXT NOT NULL,
  attempted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recipient_id,purpose,trigger_id)
);
CREATE TABLE winback_replies (
  provider_message_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES winback_recipients(id),
  outcome TEXT NOT NULL,
  body TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE winback_airtable_outbox (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  outcome TEXT NOT NULL,
  do_not_text INTEGER NOT NULL DEFAULT 0 CHECK(do_not_text IN (0,1)),
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','synced','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE winback_owner_notices (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES winback_recipients(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','acknowledged')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
