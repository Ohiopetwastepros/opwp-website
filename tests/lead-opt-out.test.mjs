import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { suppressLeadPhone, processTextStatusOutbox } from "../lib/lead-opt-out.mjs";

const phone = "+14192620424", at = "2026-11-23T23:45:00.000Z", ORG = "org-opwp";
const successfulSync = async () => ({ verified: true, partial: false });
const snapshot = (db) => { const row = db.sqlite.prepare("SELECT * FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'text_status:org-opwp:%'").get(); return row ? { ...row, value: JSON.parse(row.payload) } : null; };

function addLead(db, id, { org = ORG, value = phone, status = "new", conversation = true } = {}) {
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES (?,'question','facebook',?,?,'{}')").run(id, status, value);
  if (conversation) db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,automation_mode,owner) VALUES (?,?,?,'approved','backend')").run(`conversation-${id}`, id, org);
  return id;
}

function addQueues(db, id, org = ORG) {
  const conversation = `conversation-${id}`;
  db.sqlite.prepare("INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at,status) VALUES (?,?,?,'fixture','fixture',?,?,'queued')").run(`quote-${id}`, id, phone, at, at);
  db.sqlite.prepare("INSERT INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,status) VALUES (?,?,?,'customer_sms','sending')").run(`delivery-${id}`, `quote-${id}`, id);
  db.sqlite.prepare("INSERT INTO meta_lead_intakes(submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,review_reason) VALUES (?,?,?,'fixture-form','fixture-page','https://example.test','fixture')").run(id, org, `meta-${id}`);
  for (const [i, state] of ["queued", "sent", "unknown"].entries()) db.sqlite.prepare("INSERT INTO meta_sms_jobs(id,purpose,trigger_id,submission_id,organization_id,conversation_id,message_body,status,provider_message_id) VALUES (?,'confirmation',?,?,?,?, 'Fixture text',?,?)").run(`meta-job-${id}-${i}`, `trigger-${id}-${i}`, id, org, conversation, state, i ? `receipt-${id}-${i}` : null);
  for (const [i, state] of ["queued", "sent", "failed"].entries()) db.sqlite.prepare("INSERT INTO lead_follow_up_jobs(id,submission_id,conversation_id,organization_id,sequence_step,due_at,message_body,status,provider_message_id) VALUES (?,?,?,?,?,?,'Fixture text',?,?)").run(`follow-${id}-${i}`, id, conversation, org, i + 1, at, state, state === "sent" ? `follow-receipt-${id}` : null);
  for (const [i, state] of ["pending", "sent", "sending"].entries()) db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,organization_id,intent,confidence,body,policy_version,status,provider_message_id) VALUES (?,?,?,?,'fixture',1,'Fixture text','fixture',?,?)").run(`draft-${id}-${i}`, conversation, id, org, state, state === "sent" ? `draft-receipt-${id}` : null);
}

test("STOP suppresses every same-phone OPWP lead and queue while preserving receipts and other orgs", async () => {
  const db = leadTestDatabase();
  addQueues(db, addLead(db, "first"));
  addQueues(db, addLead(db, "converted", { value: "(419) 262-0424", status: "converted" }));
  addQueues(db, addLead(db, "foreign", { org: "org-other" }), "org-other");
  addLead(db, "unmatched", { value: "unrecognized-phone" });
  let calls = 0;
  const syncTextStatus = async (_env, command) => {
    calls++; assert.equal(command.phone, phone); assert.equal(command.doNotText, true);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM lead_suppressions WHERE organization_id=?").get(ORG).n, 1);
    assert.equal(db.sqlite.prepare("SELECT status FROM quote_follow_ups WHERE id='quote-first'").get().status, "cancelled");
    return { verified: true };
  };
  const result = await suppressLeadPhone(db, {}, { phone, eventId: "mock-stop-1", at }, { syncTextStatus });
  assert.equal(result.suppressed, true); assert.equal(result.verified, true); assert.equal(calls, 1);
  for (const id of ["first", "converted"]) {
    const sub = db.sqlite.prepare("SELECT status,payload FROM submissions WHERE id=?").get(id);
    assert.equal(sub.status, id === "converted" ? "converted" : "new"); assert.equal(JSON.parse(sub.payload).do_not_text, true);
    assert.equal(JSON.parse(sub.payload).follow_up_consent, false);
    assert.equal(db.sqlite.prepare("SELECT automation_mode FROM lead_conversations WHERE submission_id=?").get(id).automation_mode, "paused");
    for (const [table, key] of [["quote_follow_ups", `quote-${id}`], ["quote_follow_up_deliveries", `delivery-${id}`], ["meta_sms_jobs", `meta-job-${id}-0`], ["lead_follow_up_jobs", `follow-${id}-0`], ["lead_follow_up_jobs", `follow-${id}-2`]]) assert.equal(db.sqlite.prepare(`SELECT status FROM ${table} WHERE id=?`).get(key).status, "cancelled");
    assert.equal(db.sqlite.prepare("SELECT status FROM lead_reply_drafts WHERE id=?").get(`draft-${id}-0`).status, "superseded");
    assert.equal(db.sqlite.prepare("SELECT status FROM lead_reply_drafts WHERE id=?").get(`draft-${id}-2`).status, "superseded");
    for (const i of [1, 2]) { const receipt = db.sqlite.prepare("SELECT status,provider_message_id FROM meta_sms_jobs WHERE id=?").get(`meta-job-${id}-${i}`); assert.equal(receipt.status, i === 1 ? "sent" : "unknown"); assert.equal(receipt.provider_message_id, `receipt-${id}-${i}`); }
    assert.equal(db.sqlite.prepare("SELECT status FROM lead_reply_drafts WHERE id=?").get(`draft-${id}-1`).status, "sent");
  }
  assert.equal(db.sqlite.prepare("SELECT automation_mode FROM lead_conversations WHERE submission_id='foreign'").get().automation_mode, "approved");
  assert.equal(db.sqlite.prepare("SELECT status FROM quote_follow_ups WHERE id='quote-foreign'").get().status, "queued");
  assert.equal(db.sqlite.prepare("SELECT status FROM meta_sms_jobs WHERE id='meta-job-foreign-0'").get().status, "queued");
  assert.equal(db.sqlite.prepare("SELECT payload FROM submissions WHERE id='foreign'").get().payload, "{}");
  assert.equal(db.sqlite.prepare("SELECT payload FROM submissions WHERE id='unmatched'").get().payload, "{}");
  assert.equal(snapshot(db).status, "synced"); db.sqlite.close();
});

test("unknown senders persist suppression and outbox even without optional funnel tables", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE lead_suppressions(organization_id TEXT,phone_hash TEXT,reason TEXT,source TEXT,created_by TEXT,PRIMARY KEY(organization_id,phone_hash)); CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,error TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  const stmt = (sql, args = []) => ({ bind: (...values) => stmt(sql, values), first: async () => sqlite.prepare(sql).get(...args) || null, all: async () => ({ results: sqlite.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }) });
  const db = { sqlite, prepare: (sql) => stmt(sql), batch: async () => { assert.fail("No optional tables should be mutated"); } };
  const result = await suppressLeadPhone(db, {}, { phone, eventId: "unknown-stop", at }, { syncTextStatus: successfulSync });
  assert.equal(result.suppressed, true); assert.equal(result.verified, true); assert.equal(sqlite.prepare("SELECT count(*) n FROM lead_suppressions").get().n, 1); assert.equal(snapshot(db).status, "synced"); sqlite.close();
});

test("duplicate webhook event IDs never create a second outbox event or notes sync", async () => {
  const db = leadTestDatabase(); let calls = 0;
  const syncTextStatus = async () => { calls++; return { verified: true }; };
  await suppressLeadPhone(db, {}, { phone, eventId: "duplicate-stop", at }, { syncTextStatus });
  await suppressLeadPhone(db, {}, { phone, eventId: "duplicate-stop", at: "2026-11-24T23:45:00Z" }, { syncTextStatus });
  const outbox = snapshot(db);
  assert.equal(calls, 1); assert.deepEqual(outbox.value.completedIds, ["duplicate-stop"]); assert.equal(outbox.value.events.length, 0); assert.equal(outbox.status, "synced"); db.sqlite.close();
});

test("missing Meta notes keeps durable STOP pending with backoff, then retries the same event", async () => {
  const db = leadTestDatabase(), commands = [];
  const partial = async (_env, command) => { commands.push(command); return { verified: false, partial: true, reason: "airtable_text_status_notes_missing" }; };
  const first = await suppressLeadPhone(db, {}, { phone, eventId: "notes-missing", at }, { syncTextStatus: partial });
  assert.equal(first.suppressed, true); assert.equal(first.verified, false); assert.equal(first.partial, true); assert.ok(first.reasons.includes("airtable_text_status_notes_missing"));
  assert.equal(snapshot(db).status, "pending"); assert.equal(snapshot(db).value.nextAttemptAt, "2026-11-23T23:50:00.000Z");
  const early = await processTextStatusOutbox({ DB: db }, 10, { syncTextStatus: partial, now: "2026-11-23T23:46:00Z" });
  assert.equal(early.attempted, 0);
  const recovered = await processTextStatusOutbox({ DB: db }, 10, { syncTextStatus: async (_env, command) => { commands.push(command); return { verified: true }; }, now: "2026-11-23T23:51:00Z" });
  assert.equal(recovered.synced, 1); assert.deepEqual(commands.map((command) => command.eventId), ["notes-missing", "notes-missing"]); assert.equal(snapshot(db).status, "synced"); db.sqlite.close();
});

test("concurrent STOP events preserve the second event while the first HTTP call completes", async () => {
  const db = leadTestDatabase(), commands = [];
  const firstSync = async (_env, command) => {
    commands.push(command.eventId);
    await suppressLeadPhone(db, {}, { phone, eventId: "concurrent-2", at }, { syncTextStatus: async () => assert.fail("Active lease must prevent a concurrent sync") });
    return { verified: true };
  };
  await suppressLeadPhone(db, {}, { phone, eventId: "concurrent-1", at }, { syncTextStatus: firstSync });
  assert.deepEqual(snapshot(db).value.events.map((event) => event.eventId), ["concurrent-2"]); assert.equal(snapshot(db).status, "pending");
  await processTextStatusOutbox({ DB: db }, 10, { syncTextStatus: async (_env, command) => { commands.push(command.eventId); return { verified: true }; }, now: at });
  assert.deepEqual(commands, ["concurrent-1", "concurrent-2"]); assert.equal(snapshot(db).status, "synced"); db.sqlite.close();
});

test("stale outbox leases recover without discarding the pending opt-out event", async () => {
  const db = leadTestDatabase();
  await suppressLeadPhone(db, {}, { phone, eventId: "stale-lease", at }, { syncTextStatus: async () => ({ verified: false }) });
  const row = snapshot(db), value = row.value;
  value.claimToken = "interrupted-worker"; value.claimAt = at; value.nextAttemptAt = at;
  db.sqlite.prepare("UPDATE airtable_cockpit_snapshots SET status='syncing',payload=? WHERE snapshot_key=?").run(JSON.stringify(value), row.snapshot_key);
  const result = await processTextStatusOutbox({ DB: db }, 10, { syncTextStatus: successfulSync, now: "2026-11-23T23:51:00Z" });
  assert.equal(result.synced, 1); assert.equal(result.pending, 0); assert.equal(snapshot(db).status, "synced"); assert.equal(snapshot(db).value.events.length, 0); db.sqlite.close();
});

test("invalid source payloads and explicit other-org payload ownership remain intact", async () => {
  const db = leadTestDatabase();
  addLead(db, "malformed"); db.sqlite.prepare("UPDATE submissions SET payload='original non-JSON source' WHERE id='malformed'").run();
  addLead(db, "payload-owned", { conversation: false }); db.sqlite.prepare("UPDATE submissions SET payload=? WHERE id='payload-owned'").run(JSON.stringify({ organizationId: "org-other" }));
  await suppressLeadPhone(db, {}, { phone, eventId: "source-preservation", at }, { syncTextStatus: successfulSync });
  assert.equal(db.sqlite.prepare("SELECT payload FROM submissions WHERE id='malformed'").get().payload, "original non-JSON source");
  assert.deepEqual(JSON.parse(db.sqlite.prepare("SELECT payload FROM submissions WHERE id='payload-owned'").get().payload), { organizationId: "org-other" }); db.sqlite.close();
});

test("queue cancellation failure cannot roll back suppression or its durable status outbox", async () => {
  const db = leadTestDatabase(); addLead(db, "batch-failure");
  const failing = { ...db, batch: async () => { throw new Error("mock database failure"); } };
  const result = await suppressLeadPhone(failing, {}, { phone, eventId: "batch-failure", at }, { syncTextStatus: successfulSync });
  assert.equal(result.suppressed, true); assert.equal(result.verified, false); assert.equal(result.cancellationComplete, false);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM lead_suppressions WHERE organization_id=?").get(ORG).n, 1); assert.equal(snapshot(db).status, "synced"); assert.ok(result.reasons.includes("opt_out_queue_cancellation_incomplete")); db.sqlite.close();
});

test("provider errors stay private and retries remain pending without raw exception details", async () => {
  const db = leadTestDatabase(); const secretMarker = "mock-sensitive-token-value";
  const result = await suppressLeadPhone(db, {}, { phone, eventId: "provider-failure", at }, { syncTextStatus: async () => { throw new Error(secretMarker); } });
  assert.equal(result.suppressed, true); assert.equal(result.verified, false); assert.equal(snapshot(db).status, "pending");
  assert.ok(!JSON.stringify(result).includes(secretMarker)); assert.ok(!snapshot(db).payload.includes(secretMarker)); db.sqlite.close();
});

test("outbox processing leaves other organization snapshots and unrelated snapshots untouched", async () => {
  const db = leadTestDatabase();
  for (const key of ["text_status:org-other:fixture", "unrelated-operational-snapshot"]) db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status) VALUES (?,'{}','pending')").run(key);
  const result = await processTextStatusOutbox({ DB: db }, 10, { syncTextStatus: async () => assert.fail("No OPWP status work"), now: at });
  assert.equal(result.attempted, 0); assert.equal(db.sqlite.prepare("SELECT count(*) n FROM airtable_cockpit_snapshots WHERE status='pending'").get().n, 2); db.sqlite.close();
});

test("invalid identities never touch a database or call Airtable", async () => {
  const db = { prepare: () => assert.fail("Invalid identity must not write") };
  for (const command of [{ phone: "invalid", eventId: "event", at }, { phone, eventId: "", at }, { phone, eventId: "event", at: "invalid" }]) {
    const result = await suppressLeadPhone(db, {}, command, { syncTextStatus: async () => assert.fail("No HTTP") });
    assert.equal(result.suppressed, false); assert.equal(result.verified, false);
  }
});
