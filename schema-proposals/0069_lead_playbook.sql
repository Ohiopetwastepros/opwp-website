-- PROPOSAL ONLY. Additive schema for disabled-by-default lead playbook.
-- No customer records, credentials, provider identifiers or historical seeds.
ALTER TABLE lead_conversations ADD COLUMN owner TEXT NOT NULL DEFAULT 'sona' CHECK(owner IN ('backend','sona','craig'));
ALTER TABLE lead_conversations ADD COLUMN owner_event_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE lead_conversations ADD COLUMN owner_event_id TEXT NOT NULL DEFAULT '';
ALTER TABLE lead_conversations ADD COLUMN owner_event_priority INTEGER NOT NULL DEFAULT 0 CHECK(owner_event_priority BETWEEN 0 AND 3);
ALTER TABLE lead_messages ADD COLUMN author TEXT CHECK(author IN ('lead','craig','sona','backend'));
ALTER TABLE lead_answer_library ADD COLUMN intent TEXT;
ALTER TABLE lead_answer_library ADD COLUMN stage TEXT;
ALTER TABLE lead_answer_library ADD COLUMN source TEXT NOT NULL DEFAULT 'seed' CHECK(source IN ('seed','mined','approved_edit'));
ALTER TABLE lead_answer_library ADD COLUMN approvals INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lead_answer_library ADD COLUMN edits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lead_answer_library ADD COLUMN rejections INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lead_answer_library ADD COLUMN last_used_at TEXT;
ALTER TABLE lead_airtable_sync ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','matched','mismatch'));
ALTER TABLE lead_airtable_sync ADD COLUMN mismatch_json TEXT;
ALTER TABLE lead_airtable_sync ADD COLUMN verified_at TEXT;
CREATE TRIGGER lead_airtable_verification_reset AFTER UPDATE OF revision ON lead_airtable_sync
WHEN NEW.revision!=OLD.revision
BEGIN
  UPDATE lead_airtable_sync SET verification_status='pending',mismatch_json=NULL,verified_at=NULL WHERE submission_id=NEW.submission_id;
END;

CREATE TABLE lead_playbook_state (
  conversation_id TEXT PRIMARY KEY REFERENCES lead_conversations(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  stage TEXT NOT NULL DEFAULT 'intro_sent' CHECK(stage IN ('intro_sent','collect_details','confirm_details_sent','details_confirmed','details_corrected','quote_sent','objection','discount_offered','ready','access_questions_sent','handoff_signup','closed_won','closed_lost','escalated')),
  state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json)),
  prior_state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(prior_state_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER lead_playbook_state_guard BEFORE UPDATE ON lead_playbook_state
WHEN NEW.prior_state_json != OLD.state_json OR NEW.revision != OLD.revision+1
BEGIN SELECT RAISE(ABORT,'lead_playbook_state_conflict'); END;

CREATE TABLE lead_reply_drafts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES lead_conversations(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  inbound_message_id TEXT,
  intent TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  template_key TEXT,
  answer_key TEXT,
  template_version TEXT,
  answer_version INTEGER,
  slots_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(slots_json)),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  pricing_version TEXT,
  policy_version TEXT NOT NULL,
  reason TEXT,
  prior_state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(prior_state_json)),
  state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','edited_approved','rejected','expired','superseded','sending','sent','failed')),
  approver TEXT,
  approved_at TEXT,
  final_body TEXT,
  edit_distance INTEGER,
  rejection_reason TEXT,
  send_claim TEXT,
  claimed_at TEXT,
  notification_claim TEXT,
  notification_claimed_at TEXT,
  notified_at TEXT,
  notification_message_id TEXT,
  provider_message_id TEXT UNIQUE,
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+12 hours')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX lead_reply_drafts_queue ON lead_reply_drafts(organization_id,status,created_at);
CREATE UNIQUE INDEX lead_reply_drafts_inbound ON lead_reply_drafts(conversation_id,inbound_message_id) WHERE inbound_message_id IS NOT NULL;
CREATE TABLE lead_playbook_links (
  jti TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES lead_reply_drafts(id) ON DELETE CASCADE,
  body_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE playbook_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('quo_2371','quo_7970','meta_leadgen','meta_messenger','meta_instagram','iphone_backup','live_quo')),
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cursor TEXT,
  counts TEXT NOT NULL DEFAULT '{}',
  notes TEXT
);
CREATE TABLE playbook_threads (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES playbook_sources(id),
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  external_ref_hash TEXT NOT NULL,
  channel TEXT NOT NULL,
  first_at TEXT,
  last_at TEXT,
  lead_submission_id TEXT REFERENCES submissions(id),
  is_business INTEGER NOT NULL DEFAULT 0 CHECK(is_business IN (0,1)),
  excluded_reason TEXT,
  outcome TEXT NOT NULL DEFAULT 'unknown' CHECK(outcome IN ('won','lost','no_reply','unknown')),
  outcome_source TEXT,
  UNIQUE(source_id,external_ref_hash)
);
CREATE TABLE playbook_turns (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES playbook_threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','internal')),
  author TEXT NOT NULL CHECK(author IN ('lead','craig','sona','backend')),
  provider_message_id TEXT,
  body_redacted TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  intent TEXT,
  slots_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(slots_json)),
  UNIQUE(thread_id,provider_message_id)
);
CREATE INDEX playbook_turns_timeline ON playbook_turns(thread_id,created_at);
CREATE TABLE playbook_candidates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('qa','objection')),
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  intent TEXT NOT NULL,
  question_redacted TEXT,
  answer_redacted TEXT,
  objection_text TEXT,
  outcome TEXT NOT NULL DEFAULT 'unknown',
  support_count INTEGER NOT NULL DEFAULT 1,
  win_rate REAL,
  example_turn_ids TEXT NOT NULL DEFAULT '[]',
  proposed_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','approved','rejected','merged')),
  source TEXT NOT NULL DEFAULT 'mined' CHECK(source IN ('mined','approved_edit')),
  reviewer TEXT,
  reviewed_at TEXT,
  rejection_reason TEXT,
  answer_key TEXT,
  rule_violations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE playbook_airtable_sync (
  kind TEXT NOT NULL CHECK(kind IN ('draft','library')),
  record_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','syncing','synced','failed','mismatch')),
  airtable_record_id TEXT,
  payload_hash TEXT,
  error_message TEXT,
  mismatch_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(kind,record_id)
);
CREATE TABLE lead_classifier_daily_usage (
  usage_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(usage_date,provider)
);
CREATE TABLE lead_classifier_calls (
  id TEXT PRIMARY KEY,
  usage_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  estimated_input_tokens INTEGER NOT NULL,
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
  actual_tokens INTEGER,
  status TEXT NOT NULL CHECK(status IN ('claimed','completed','failed','invalid')),
  classifier_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE lead_playbook_intent_stats (
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  intent TEXT NOT NULL,
  approvals INTEGER NOT NULL DEFAULT 0,
  edits INTEGER NOT NULL DEFAULT 0,
  rejections INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,intent)
);
-- Owner-only alerts use independent channel claims. A response lost after a
-- provider call stays uncertain and is never blindly retried by the scheduler.
CREATE TABLE lead_playbook_owner_notifications (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'org-opwp',
  kind TEXT NOT NULL CHECK(kind IN ('pending_draft','signup_ready','property_walk','lead_review')),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  conversation_id TEXT NOT NULL REFERENCES lead_conversations(id),
  draft_id TEXT REFERENCES lead_reply_drafts(id),
  channel TEXT NOT NULL CHECK(channel IN ('sms','email')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','uncertain','cancelled')),
  claim_token TEXT,
  provider_message_id TEXT,
  sending_at TEXT,
  accepted_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_key,channel)
);
CREATE INDEX lead_playbook_owner_notifications_queue ON lead_playbook_owner_notifications(organization_id,status,created_at);
-- A new inbound always invalidates pending approvals before any worker can send.
CREATE TRIGGER lead_playbook_supersede_inbound AFTER INSERT ON lead_messages
WHEN NEW.direction='inbound'
BEGIN
  UPDATE lead_reply_drafts SET status='superseded',updated_at=CURRENT_TIMESTAMP
    WHERE conversation_id=NEW.conversation_id AND status IN ('pending','approved','edited_approved');
END;
CREATE TRIGGER lead_playbook_cancel_takeover AFTER UPDATE OF owner ON lead_conversations
WHEN NEW.owner!='backend'
BEGIN
  UPDATE lead_reply_drafts SET status='superseded',updated_at=CURRENT_TIMESTAMP
    WHERE conversation_id=NEW.id AND status IN ('pending','approved','edited_approved');
END;

-- Queue the closed loop even when an ownership/expiry/webhook trigger changes a
-- record instead of an admin command. Revision guards protect in-flight mirrors.
CREATE TRIGGER playbook_mirror_draft_insert AFTER INSERT ON lead_reply_drafts
BEGIN
  INSERT INTO playbook_airtable_sync(kind,record_id,organization_id,status) VALUES('draft',NEW.id,NEW.organization_id,'queued')
  ON CONFLICT(kind,record_id) DO UPDATE SET revision=revision+1,status='queued',attempt_count=0,error_message=NULL,mismatch_json=NULL,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER playbook_mirror_draft_update AFTER UPDATE OF status,body,final_body ON lead_reply_drafts
BEGIN
  INSERT INTO playbook_airtable_sync(kind,record_id,organization_id,status) VALUES('draft',NEW.id,NEW.organization_id,'queued')
  ON CONFLICT(kind,record_id) DO UPDATE SET revision=revision+1,status='queued',attempt_count=0,error_message=NULL,mismatch_json=NULL,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER playbook_mirror_library_insert AFTER INSERT ON lead_answer_library
WHEN NEW.approval_status='approved' AND NEW.intent IS NOT NULL
BEGIN
  INSERT INTO playbook_airtable_sync(kind,record_id,organization_id,status) VALUES('library',NEW.answer_key,NEW.organization_id,'queued')
  ON CONFLICT(kind,record_id) DO UPDATE SET revision=revision+1,status='queued',attempt_count=0,error_message=NULL,mismatch_json=NULL,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER playbook_mirror_library_update AFTER UPDATE OF approval_status,answer_template,approvals,edits,rejections,last_used_at ON lead_answer_library
WHEN NEW.intent IS NOT NULL
BEGIN
  INSERT INTO playbook_airtable_sync(kind,record_id,organization_id,status) VALUES('library',NEW.answer_key,NEW.organization_id,'queued')
  ON CONFLICT(kind,record_id) DO UPDATE SET revision=revision+1,status='queued',attempt_count=0,error_message=NULL,mismatch_json=NULL,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;
END;
