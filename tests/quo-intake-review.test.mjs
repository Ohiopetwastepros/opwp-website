import {migrationBindings} from './helpers/migration-bindings.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("review cleanup preserves records, hides only reviewed imports, and cancels follow-ups idempotently", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE submissions (id TEXT PRIMARY KEY,source TEXT,status TEXT,payload TEXT);
    CREATE TABLE growth_leads (submission_id TEXT PRIMARY KEY,organization_id TEXT,stage TEXT,priority TEXT,outcome_reason TEXT,outcome_note TEXT,not_qualified_at TEXT,updated_by TEXT);
    CREATE TABLE lead_conversations (submission_id TEXT,organization_id TEXT,status TEXT,automation_mode TEXT,unread_count INTEGER,updated_at TEXT);
    CREATE TABLE lead_follow_up_jobs (submission_id TEXT,organization_id TEXT,status TEXT,cancelled_at TEXT,updated_at TEXT);
    CREATE TABLE quote_follow_ups (submission_id TEXT,status TEXT,cancelled_at TEXT,updated_at TEXT);
    CREATE TABLE quote_follow_up_deliveries (submission_id TEXT,status TEXT,cancelled_at TEXT,updated_at TEXT);
    CREATE TABLE growth_lead_events (id TEXT PRIMARY KEY,submission_id TEXT,organization_id TEXT,event_type TEXT,summary TEXT,details TEXT,actor_email TEXT);
    CREATE TABLE lead_airtable_sync (submission_id TEXT,organization_id TEXT,status TEXT,attempt_count INTEGER,error_message TEXT,next_attempt_at TEXT,updated_at TEXT);
  `);
  const spam = migrationBindings.B037;
  const manuallyQualified = migrationBindings.B032;
  for (const id of [spam, manuallyQualified, "real-signup"]) {
    db.prepare("INSERT INTO submissions VALUES (?,'quo','new','original message')").run(id);
    db.prepare("INSERT INTO lead_conversations VALUES (?,'org-opwp','open','suggest',1,NULL)").run(id);
    db.prepare("INSERT INTO lead_follow_up_jobs VALUES (?,'org-opwp','queued',NULL,NULL)").run(id);
    db.prepare("INSERT INTO lead_airtable_sync VALUES (?,'org-opwp','synced',1,NULL,NULL,NULL)").run(id);
  }
  db.prepare("INSERT INTO growth_leads (submission_id,organization_id,stage,updated_by) VALUES (?,'org-opwp','qualified','human-admin')").run(manuallyQualified);
  const sql = readFileSync(new URL("../tmp/test-migrations/0039_quo_intake_review.sql", import.meta.url), "utf8");
  db.exec(sql); db.exec(sql);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM submissions WHERE payload='original message'").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM growth_leads WHERE outcome_reason='not_a_lead'").get().n, 1);
  assert.equal(db.prepare("SELECT stage FROM growth_leads WHERE submission_id=?").get(manuallyQualified).stage, "qualified");
  assert.equal(db.prepare("SELECT status FROM lead_follow_up_jobs WHERE submission_id=?").get(spam).status, "cancelled");
  assert.equal(db.prepare("SELECT status FROM lead_follow_up_jobs WHERE submission_id='real-signup'").get().status, "queued");
  assert.equal(db.prepare("SELECT automation_mode FROM lead_conversations WHERE submission_id=?").get(spam).automation_mode, "paused");
  assert.equal(db.prepare("SELECT status FROM lead_airtable_sync WHERE submission_id=?").get(spam).status, "queued");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM growth_lead_events").get().n, 1);
  db.close();
});
