-- PROPOSAL ONLY: reviewed additive source; production copy is byte-verified.
-- Restorable inbox deletion. No customer records, credentials or historical seeds.
CREATE TABLE lead_inbox_trash (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
  organization_id TEXT NOT NULL CHECK(organization_id='org-opwp'),
  prior_status TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  purge_after TEXT NOT NULL DEFAULT (datetime('now','+30 days')),
  command_id TEXT NOT NULL UNIQUE,
  restore_command_id TEXT
);
CREATE INDEX lead_inbox_trash_expiry ON lead_inbox_trash(organization_id,purge_after);

-- Provider callbacks and sync jobs must not resurrect a trashed inbox record.
CREATE TRIGGER lead_inbox_trash_status_guard BEFORE UPDATE OF status ON submissions
WHEN OLD.status='trashed' AND NEW.status NOT IN ('trashed','deleted')
  AND EXISTS(SELECT 1 FROM lead_inbox_trash t WHERE t.submission_id=OLD.id AND t.restore_command_id IS NULL)
BEGIN SELECT RAISE(IGNORE); END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_quote_follow_ups_insert AFTER INSERT ON quote_follow_ups
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE quote_follow_ups SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_quote_follow_ups_update AFTER UPDATE OF status ON quote_follow_ups
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE quote_follow_ups SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_quote_follow_up_deliveries_insert AFTER INSERT ON quote_follow_up_deliveries
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_quote_follow_up_deliveries_update AFTER UPDATE OF status ON quote_follow_up_deliveries
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_lead_follow_up_jobs_insert AFTER INSERT ON lead_follow_up_jobs
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_lead_follow_up_jobs_update AFTER UPDATE OF status ON lead_follow_up_jobs
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_meta_sms_jobs_insert AFTER INSERT ON meta_sms_jobs
WHEN NEW.status IN ('queued','blocked','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE meta_sms_jobs SET status='cancelled',block_reason='lead_trashed',updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_meta_sms_jobs_update AFTER UPDATE OF status ON meta_sms_jobs
WHEN NEW.status IN ('queued','blocked','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE meta_sms_jobs SET status='cancelled',block_reason='lead_trashed',updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_submission_notifications_insert AFTER INSERT ON submission_notifications
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE submission_notifications SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- Cancel even a late queue writer while this lead is in Trash. Sent history stays intact.
CREATE TRIGGER lead_trash_submission_notifications_update AFTER UPDATE OF status ON submission_notifications
WHEN NEW.status IN ('queued','failed','sending') AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.status IN ('trashed','deleted'))
BEGIN
  UPDATE submission_notifications SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;
