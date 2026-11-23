import {verifiedTextSafety, createAirtableContactFixture} from "./helpers/airtable-text-safety-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";
import { beginMfaLogin, finishMfaLogin } from "../lib/admin-mfa.mjs";
import { TOTP, Secret } from "otpauth";
import { createRequire } from "node:module";
async function fixtureAdminSession(email) {
  const env = globalThis.__metaTestEnv;
  env.ADMIN_USERNAME = email;
  env.ADMIN_PASSWORD = "fixture-only-password";
  env.ADMIN_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  env.__recoveryCodes ||= {};
  const challenge = await beginMfaLogin(env, { username: email, password: env.ADMIN_PASSWORD });
  const code = challenge.secret ? new TOTP({ secret: Secret.fromBase32(challenge.secret) }).generate() : env.__recoveryCodes[email].shift();
  const result = await finishMfaLogin(env, challenge.challengeToken, { code });
  if (result.recoveryCodes.length) env.__recoveryCodes[email] = result.recoveryCodes;
  return result.sessionToken;
}
import { storeMetaLead, processMetaConfirmations as processMetaConfirmationsWithDirectory, refreshPendingMetaConfirmations, queueMetaCadence, recordMetaReply, recordQuoDelivery, metaReleaseApproved, markMetaNoResponse } from "../lib/meta-lead-workflow.mjs";
import { exactDogs, mapMetaAnswers, metaCadenceQuietHours, metaConsentEvidence, buildMetaConfirmation, formatMetaSms } from "../lib/meta-lead-policy.mjs";
import { nextMetaResponse, metaWebsiteQuote, metaCleanupSummary, META_RESPONSES } from "../lib/meta-conversation.mjs";
import { auditMetaRoute, routeGuidanceFromSnapshot } from "../lib/meta-route-guidance.mjs";
import { readBoundedBytes } from "../lib/bounded-body.mjs";
import { recordVerifiedMetaPayment, reconcileMetaConversions } from "../lib/meta-conversion.mjs";
import { buildMetaOwnerNotification } from "../lib/meta-owner-notifications.mjs";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(new URL("../tmp/test-migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../tmp/test-migrations/${name}`, import.meta.url), "utf8"));
  const wrap = (sql, values = []) => ({
    bind: (...args) => wrap(sql, args),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
    execute: () => { const query = sqlite.prepare(sql); return query.columns().length ? { results: query.all(...values) } : { results: [], meta: { changes: Number(query.run(...values).changes) } }; },
  });
  return { sqlite, prepare: (sql) => wrap(sql), batch: async (statements) => {
    sqlite.exec("BEGIN");
    try { const result = statements.map((statement) => statement.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

const form = (id = "lead-1", extra = {}) => ({ id, form_id: "form-1", created_time: new Date().toISOString(), field_data: Object.entries({ full_name: "ExampleLead Example", phone_number: "+14195550100", zip_code: "43615", number_of_dogs: "2 dogs", service_frequency: "weekly", contact_preference: "text", sms_consent: "I agree", ...extra }).map(([name, value]) => ({ name, values: [value] })) });
const event = (id = "lead-1") => ({ leadId: id, formId: "form-1", pageId: "page-1" });
function environment(db, enabled = true) {
  return { DB: db, META_AUTOMATION_ENABLED: enabled ? "true" : "false", META_AUTOMATION_APPROVAL_ID: "test-release", META_CADENCE_APPROVAL_ID: "test-cadence", META_CADENCE_ENABLED: "true", META_ALLOWED_PAGE_IDS: "page-1", META_APP_SECRET: "test-meta-secret", META_GRAPH_API_VERSION: "v26.0", META_PAGE_ACCESS_TOKEN: "test-meta-token", QUO_WEBHOOK_SIGNING_KEY: Buffer.from("test-quo-secret").toString("base64"),
    QUO_API_KEY: "test-quo-key", QUO_FROM_NUMBER: "+14192622371", AIRTABLE_API_KEY: "test-airtable-key", ADMIN_SESSION_SECRET: "fixture-admin-signing-key", OWNER_NOTIFICATION_EMAIL: "craig@ohiopetwastepros.com",
    META_APPROVED_SMS_FORMS: JSON.stringify({ "form-1": { pageId: "page-1", consentField: "sms_consent", version: "test-disclosure-v1", disclosure: "Test disclosure: automated OPWP quote texts; STOP to opt out." } }) };
}
function approve(db) {
  db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('test-release','org-opwp','meta-confirmation-v2','test-owner','simulated tests only',datetime('now','-1 minute'),NULL);
    UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0;
    INSERT INTO meta_automation_releases VALUES ('test-cadence','org-opwp','meta-nurture-1-3-7-v1','test-owner','simulated tests only',datetime('now','-1 minute'),NULL);`);
}
const noon = new Date("2026-09-17T16:00:00Z");
const processMetaConfirmations = (env, options = {}) => processMetaConfirmationsWithDirectory(env, {textSafety: verifiedTextSafety, loadCustomerDirectory: async () => ({ok: true, complete: true, rows: []}), ...options});
const select = (db, table) => db.sqlite.prepare(`SELECT * FROM ${table}`).all();

test("Meta mapping preserves ambiguity, conflicts and separate consent", () => {
  for (const value of ["4+", "four or more dogs", "2 dogs and 3 puppies", "2-3 dogs", "about 2", "0"]) assert.equal(exactDogs(value), null, value);
  assert.equal(exactDogs("4 dogs"), 4);
  const mapped = mapMetaAnswers({ "how_many_dogs_do_you_have?": "2 dogs", "how would you like to be contacted?": "email", "zip code": "43615", "service frequency": "every other week" });
  assert.equal(mapped.number_of_dogs, 2); assert.equal(mapped.clean_up_frequency, "Biweekly"); assert.equal(mapped.preferred_channel, "email");
  assert.equal(mapMetaAnswers({ dog_count: "2", number_of_dogs: "3" }).number_of_dogs, null);
  assert.equal(metaConsentEvidence({ meta_form_id: "f", original_fields: { contact_preference: "text" } }, { f: { consentField: "contact_preference" } }).valid, false);
  const message = buildMetaConfirmation({ name: "ExampleLead", number_of_dogs: null, zip: "", clean_up_frequency: "" });
  assert.match(message, /how many dogs total/); assert.doesNotMatch(message, /I have 0|I have 4|undefined/); assert.match(message, /\n\nReply STOP to opt out$/);
});

test("storage is transactional and retries resolve to one lead, one Airtable record key and one confirmation", async () => {
  const db = database(), env = environment(db, false);
  const first = await storeMetaLead(db, env, form(), event());
  const again = await storeMetaLead(db, env, form(), event());
  assert.equal(first.id, again.id);
  for (const table of ["submissions", "lead_conversations", "growth_leads", "lead_airtable_sync", "meta_sms_jobs"]) assert.equal(select(db, table).length, 1, table);
  const lead = JSON.parse(select(db, "submissions")[0].payload);
  assert.equal(lead.number_of_dogs, 2); assert.equal(lead.original_form.field_data.length, 7);
  assert.equal(select(db, "meta_lead_intakes")[0].source_url, "https://business.facebook.com/latest/leads_center?asset_id=page-1");
  await storeMetaLead(db, env, form("lead-2"), event("lead-2"));
  assert.equal(select(db, "meta_sms_jobs")[1].block_reason, "duplicate_contact");
  let calls = 0;
  await processMetaConfirmations(env, { now: noon, fetcher: async () => { calls++; } });
  assert.equal(calls, 0);
  const broken = { ...db, batch: async (statements) => db.batch([...statements, db.prepare("INSERT INTO missing_table VALUES (1)")]) };
  await assert.rejects(storeMetaLead(broken, env, form("broken"), event("broken")));
  assert.equal(select(db, "submissions").length, 2);
});

test("confirmation storage, mocked Quo delivery and message history preserve the exact copy and newlines", async () => {
  const db = database(); approve(db); const env = environment(db);
  await storeMetaLead(db, env, form("lead-1", { full_name: "Jason Example", zip_code: "43551" }), event());
  const expected = buildMetaConfirmation({ name: "Jason Example", number_of_dogs: 2, zip: "43551", clean_up_frequency: "Weekly" });
  const queued = select(db, "meta_sms_jobs").find((job) => job.purpose === "confirmation");
  assert.equal(queued.message_body, expected);
  assert.match(expected, /\n\nReply STOP to opt out$/);
  assert.ok(expected.length <= 1000);
  const sent = [];
  const result = await processMetaConfirmations(env, { now: noon, fetcher: async (url, request) => {
    assert.equal(url, "https://api.openphone.com/v1/messages");
    sent.push(JSON.parse(request.body).content);
    return Response.json({ data: { id: "copy-preserved-sms" } });
  } });
  assert.equal(result.sent, 1);
  assert.deepEqual(sent, [expected]);
  assert.equal(select(db, "meta_sms_jobs").find((job) => job.id === queued.id).message_body, expected);
  assert.equal(select(db, "lead_messages").find((message) => message.provider_message_id === "copy-preserved-sms").body, expected);
});

test("pending confirmation copy refresh never sends, releases, or rewrites attempted and sent history", async () => {
  const db = database(), env = environment(db, false);
  const statuses = ["queued", "blocked", "sending", "sent", "delivered", "failed", "unknown", "cancelled"];
  for (let index = 0; index < statuses.length; index++) {
    const id = `copy-${index}`;
    await storeMetaLead(db, env, form(id, { phone_number: `+141955501${String(index).padStart(2, "0")}` }), event(id));
    const status = statuses[index];
    db.sqlite.prepare("UPDATE meta_sms_jobs SET status=?,message_body='Legacy confirmation. This is an automated confirmation. Reply STOP to opt out.' WHERE trigger_id=?").run(status, id);
  }
  // A queued job which was already attempted is deliberately not safe to rewrite.
  await storeMetaLead(db, env, form("attempted", { phone_number: "+14195550120" }), event("attempted"));
  db.sqlite.exec("UPDATE meta_sms_jobs SET message_body='Attempted legacy text',attempted_at=CURRENT_TIMESTAMP WHERE trigger_id='attempted'");
  const before = select(db, "meta_sms_jobs");
  assert.deepEqual(await refreshPendingMetaConfirmations(db), { reviewed: 2, updated: 2 });
  for (const job of select(db, "meta_sms_jobs")) {
    const prior = before.find((item) => item.id === job.id);
    assert.equal(job.status, prior.status);
    assert.equal(job.attempted_at, prior.attempted_at);
    assert.equal(job.sent_at, prior.sent_at);
    assert.equal(job.provider_message_id, prior.provider_message_id);
    if (["queued", "blocked"].includes(job.status) && !job.attempted_at) {
      assert.match(job.message_body, /^Hi ExampleLead, this is Craig with Ohio Pet Waste Pros\. Just to make sure I have it right,/);
      assert.match(job.message_body, /\n\nReply STOP to opt out$/);
      assert.doesNotMatch(job.message_body, /automated confirmation|[\u2013\u2014]/);
    } else assert.equal(job.message_body, prior.message_body);
  }
  assert.equal(select(db, "lead_messages").length, 0);
  assert.deepEqual(await refreshPendingMetaConfirmations(db), { reviewed: 2, updated: 0 });
});

test("paused restored leads and trashed leads cannot acquire missing Meta cadence jobs",async()=>{
  const db=database();approve(db);const env=environment(db);
  const lead=await storeMetaLead(db,env,form(),event());
  db.sqlite.prepare("UPDATE meta_sms_jobs SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE submission_id=?").run(lead.id);
  db.sqlite.prepare("UPDATE lead_conversations SET automation_mode='paused' WHERE submission_id=?").run(lead.id);
  assert.equal(await queueMetaCadence(db,env,lead.id),false);
  assert.equal(select(db,'meta_sms_jobs').filter(row=>row.purpose==='follow_up').length,0);
  db.sqlite.prepare("UPDATE lead_conversations SET automation_mode='approved' WHERE submission_id=?").run(lead.id);
  db.sqlite.prepare("UPDATE submissions SET status='trashed' WHERE id=?").run(lead.id);
  assert.equal(await queueMetaCadence(db,env,lead.id),false);
  assert.equal(select(db,'meta_sms_jobs').filter(row=>row.purpose==='follow_up').length,0);
});

test("Meta cadence uses 8 AM through 9 PM New York time across standard, daylight and transition dates", () => {
  for (const [timestamp, quiet] of [
    ["2026-01-15T12:59:00Z", true], ["2026-01-15T13:00:00Z", false],
    ["2026-01-16T01:59:00Z", false], ["2026-01-16T02:00:00Z", true],
    ["2026-07-15T11:59:00Z", true], ["2026-07-15T12:00:00Z", false],
    ["2026-07-16T00:59:00Z", false], ["2026-07-16T01:00:00Z", true],
    ["2026-03-08T06:59:00Z", true], ["2026-03-08T07:00:00Z", true],
    ["2026-11-01T05:59:00Z", true], ["2026-11-01T06:00:00Z", true],
  ]) assert.equal(metaCadenceQuietHours(new Date(timestamp)), quiet, timestamp);
  assert.equal(metaCadenceQuietHours(new Date(NaN)), true);
});

test("complete first confirmations send overnight in winter and summer regardless of shared quiet settings", async () => {
  for (const timestamp of ["2026-01-15T06:00:00Z", "2026-01-16T02:00:00Z", "2026-07-15T05:00:00Z", "2026-07-16T01:00:00Z"]) {
    const db = database(); approve(db); const env = { ...environment(db), META_CADENCE_APPROVAL_ID: "" };
    db.sqlite.exec("UPDATE lead_automation_settings SET quiet_hours_enabled=1,quiet_hours_start='20:00',quiet_hours_end='08:00'");
    await storeMetaLead(db, env, form(), event());
    const queued = select(db, "meta_sms_jobs")[0];
    const content = [];
    const result = await processMetaConfirmations(env, { now: new Date(timestamp), fetcher: async (_url, request) => {
      content.push(JSON.parse(request.body).content); return Response.json({ data: { id: "overnight-first" } });
    } });
    assert.equal(result.sent, 1, timestamp); assert.deepEqual(content, [queued.message_body]);
    assert.match(content[0], /Just to make sure I have it right, you have 2 dogs in ZIP 43615 and are looking for weekly service\. Did I get that right\?\n\nReply STOP to opt out$/);
    assert.equal(select(db, "lead_messages")[0].body, queued.message_body);
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "follow_up").length, 0);
  }
});

test("only cadence waits overnight and the legacy shared 8 PM setting does not shorten its window", async () => {
  for (const [timestamp, expectedSent] of [
    ["2026-01-15T12:59:00Z", 0], ["2026-01-15T13:00:00Z", 1],
    ["2026-01-16T01:59:00Z", 1], ["2026-01-16T02:00:00Z", 0],
    ["2026-07-15T11:59:00Z", 0], ["2026-07-15T12:00:00Z", 1],
    ["2026-07-16T00:59:00Z", 1], ["2026-07-16T01:00:00Z", 0],
  ]) {
    const db = database(); approve(db); const env = environment(db);
    db.sqlite.exec("UPDATE lead_automation_settings SET quiet_hours_enabled=1,quiet_hours_start='20:00',quiet_hours_end='08:00'");
    await storeMetaLead(db, env, form(), event());
    await processMetaConfirmations(env, { now: noon, fetcher: async () => Response.json({ data: { id: "initial" } }) });
    db.sqlite.exec("UPDATE meta_sms_jobs SET due_at=datetime('now','-1 minute') WHERE purpose='follow_up' AND sequence_step=1");
    const content = [];
    const result = await processMetaConfirmations(env, { now: new Date(timestamp), fetcher: async (_url, request) => {
      content.push(JSON.parse(request.body).content); return Response.json({ data: { id: "cadence-window" } });
    } });
    assert.equal(result.sent, expectedSent, timestamp);
    assert.equal(content.length, expectedSent, timestamp);
    assert.equal(select(db, "meta_sms_jobs").find((job) => job.purpose === "follow_up" && job.sequence_step === 1).status, expectedSent ? "sent" : "queued", timestamp);
    assert.equal(select(db, "lead_automation_settings")[0].quiet_hours_start, "20:00");
  }
});

async function queueInboundReply(db, saved, text, trigger = "night-inbound") {
  const conversation = select(db, "lead_conversations").find((row) => row.submission_id === saved.id);
  db.sqlite.prepare(`INSERT INTO lead_messages (id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by)
    VALUES (?,?,'org-opwp','inbound','quo_sms',?,?,'recorded',0,'quo-webhook')`).run(trigger, conversation.id, trigger, text);
  db.sqlite.prepare("UPDATE lead_conversations SET last_inbound_at=CURRENT_TIMESTAMP WHERE id=?").run(conversation.id);
  await recordMetaReply(db, saved.id, { providerMessageId: trigger, text, from: "+14195550100" });
}

test("identity, assistant, handoff, correction and pricing replies send at night without an opt-out footer", async () => {
  for (const [text, response] of [
    ["are you a real person?", META_RESPONSES.human_help],
    ["yes", META_RESPONSES.yard],
    ["I have lots of poop buildup", META_RESPONSES.buildup],
    ["actually 3 dogs", "Thanks for clarifying."],
    ["what is the price?", "$105.00 per month"],
  ]) {
    const db = database(); approve(db); const env = { ...environment(db), META_CADENCE_APPROVAL_ID: "" };
    db.sqlite.exec("UPDATE lead_automation_settings SET quiet_hours_enabled=1,quiet_hours_start='20:00',quiet_hours_end='08:00'");
    const saved = await storeMetaLead(db, env, form(), event());
    await processMetaConfirmations(env, { now: noon, fetcher: async () => Response.json({ data: { id: "initial" } }) });
    if (text.includes("price")) db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(JSON.stringify({ details: { number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly", yard_size_tier: "tiny", last_cleaned: "one_month" }, details_confirmed: true }), saved.id);
    await queueInboundReply(db, saved, text);
    const queued = select(db, "meta_sms_jobs").find((job) => job.purpose === "reply");
    assert.ok(queued, text); assert.ok(queued.message_body.includes(response), text);
    assert.doesNotMatch(queued.message_body, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.equal((queued.message_body.match(/Reply STOP/g) || []).length, 0);
    assert.doesNotMatch(queued.message_body, /[\u2013\u2014]/);
    const sent = [];
    const result = await processMetaConfirmations(env, { now: new Date("2026-11-19T06:00:00Z"), fetcher: async (_url, request) => {
      sent.push(JSON.parse(request.body).content); return Response.json({ data: { id: "night-reply" } });
    } });
    assert.equal(result.sent, 1, text); assert.deepEqual(sent, [queued.message_body]);
    assert.equal(select(db, "lead_messages").find((row) => row.provider_message_id === "night-reply").body, queued.message_body);
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "follow_up").length, 0);
  }
});

test("deferred cadence jobs cannot consume the night batch ahead of a customer reply", async () => {
  const db = database(); approve(db); const env = environment(db);
  await storeMetaLead(db, env, form(), event());
  await processMetaConfirmations(env, { now: noon, fetcher: async () => Response.json({ data: { id: "first-initial" } }) });
  const second = await storeMetaLead(db, env, form("second", { phone_number: "+14195550101" }), event("second"));
  await processMetaConfirmations(env, { submissionId: second.id, now: noon, fetcher: async () => Response.json({ data: { id: "second-initial" } }) });
  await queueInboundReply(db, second, "are you a bot?", "second-inbound");
  db.sqlite.exec("UPDATE meta_sms_jobs SET due_at=datetime('now','-1 minute'),created_at=datetime('now','-1 hour') WHERE purpose='follow_up' AND status='queued'");
  const sent = [];
  const result = await processMetaConfirmations(env, { limit: 1, now: new Date("2026-11-19T06:00:00Z"), fetcher: async (_url, request) => {
    sent.push(JSON.parse(request.body).content); return Response.json({ data: { id: "night-priority" } });
  } });
  assert.equal(result.sent, 1);
  assert.deepEqual(sent, [`${META_RESPONSES.human_help}`]);
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "follow_up" && job.status === "queued").length, 3);
});

test("disabled cadence neither queues new touches nor sends existing queued touches during permitted hours", async () => {
  const db = database(); approve(db); const env = environment(db);
  const first = await storeMetaLead(db, env, form(), event());
  await processMetaConfirmations(env, { submissionId: first.id, now: noon, fetcher: async () => Response.json({ data: { id: "first-initial" } }) });
  db.sqlite.exec("UPDATE meta_sms_jobs SET due_at=datetime('now','-1 minute') WHERE purpose='follow_up'");
  const disabled = { ...env, META_CADENCE_APPROVAL_ID: "" };
  const second = await storeMetaLead(db, disabled, form("second", { phone_number: "+14195550101" }), event("second"));
  const content = [];
  await processMetaConfirmations(disabled, { now: noon, fetcher: async (_url, request) => {
    content.push(JSON.parse(request.body).content); return Response.json({ data: { id: "second-initial" } });
  } });
  assert.equal(content.length, 1); assert.match(content[0], /Just to make sure I have it right,/);
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.submission_id === second.id && job.purpose === "follow_up").length, 0);
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "follow_up" && job.status === "queued").length, 3);
  assert.equal((await markMetaNoResponse(disabled)).marked, 0);
});

test("Meta static answers normalize dashes and an existing inline STOP footer before storage and night delivery", async () => {
  const db = database(); approve(db); const env = { ...environment(db), META_CADENCE_APPROVAL_ID: "" };
  const saved = await storeMetaLead(db, env, form(), event());
  await processMetaConfirmations(env, { now: noon, fetcher: async () => Response.json({ data: { id: "initial" } }) });
  db.sqlite.prepare(`INSERT INTO lead_answer_library (answer_key,organization_id,category,question,answer_template,keywords,approval_status,auto_send_allowed,response_mode,updated_by)
    VALUES ('static-night','org-opwp','access','Gate question',?,?,'approved',1,'static','test-owner')`).run("Gate access\u2014please unlock it\u2013thank you. Reply STOP to opt out.", JSON.stringify(["sandboxzxpolicy"]));
  await queueInboundReply(db, saved, "What about sandboxzxpolicy?");
  const expected = "Gate access-please unlock it-thank you.";
  assert.equal(select(db, "meta_sms_jobs").find((job) => job.purpose === "reply").message_body, expected);
  const result = await processMetaConfirmations(env, { now: new Date("2026-11-19T06:00:00Z"), fetcher: async (_url, request) => {
    assert.equal(JSON.parse(request.body).content, expected); return Response.json({ data: { id: "static-night" } });
  } });
  assert.equal(result.sent, 1);
  assert.equal(select(db, "lead_messages").find((row) => row.provider_message_id === "static-night").body, expected);
  const bounded = formatMetaSms(`${"x".repeat(1100)} Reply STOP to opt out.`);
  assert.equal(bounded.length, 1000); assert.doesNotMatch(bounded, /Reply STOP to opt out|Text STOP to unsubscribe/i);
  assert.equal(formatMetaSms(expected), expected);
});

test("a route-audited signup invitation sends at night without an opt-out footer", async () => {
  const db = database(); approve(db); const env = { ...environment(db), META_CADENCE_APPROVAL_ID: "" };
  const saved = await storeMetaLead(db, env, form(), event());
  await processMetaConfirmations(env, { now: noon, fetcher: async () => Response.json({ data: { id: "initial" } }) });
  const snapshotAt = new Date().toISOString();
  db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES ('business_cockpit',?,'success',?)").run(JSON.stringify({ opwp: { customers: [{ fields: { Status: "Active", ZIP: "43615", "Service Day": "Tuesday" } }] } }), snapshotAt);
  db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(JSON.stringify({ details: { zip: "43615", clean_up_frequency: "Weekly", address: "123 Maple Street, Toledo" }, ready_for_route_audit: true }), saved.id);
  const lead = { id: saved.id, source: "facebook", conversation_id: select(db, "lead_conversations")[0].id, payload: select(db, "submissions")[0].payload };
  await auditMetaRoute(db, lead, { days: ["Tuesday"], snapshotAt }, "test-owner");
  const expected = "Craig has reviewed Tuesday as your service day. You can complete signup at https://www.ohiopetwastepros.com/free-quote/ . Your start date is confirmed during setup.";
  assert.equal(select(db, "meta_sms_jobs").find((job) => job.purpose === "signup").message_body, expected);
  const result = await processMetaConfirmations(env, { now: new Date("2026-11-19T06:00:00Z"), fetcher: async (_url, request) => {
    assert.equal(JSON.parse(request.body).content, expected); return Response.json({ data: { id: "night-signup" } });
  } });
  assert.equal(result.sent, 1);
  assert.equal(select(db, "lead_messages").find((row) => row.provider_message_id === "night-signup").body, expected);
});

test("release and consent gates stay closed while incomplete confirmations can send after hours", async () => {
  for (const [name, extra, change] of [
    ["no consent", { sms_consent: "" }, {}], ["email preference", { contact_preference: "email" }, {}],
    ["unknown disclosure", {}, { META_APPROVED_SMS_FORMS: "{}" }], ["unknown page", {}, { META_APPROVED_SMS_FORMS: "null" }],
    ["outside area", { zip_code: "90210" }, {}], ["bad phone", { phone_number: "123" }, {}],
  ]) {
    const db = database(); approve(db); const env = { ...environment(db), ...change };
    await storeMetaLead(db, env, form("lead-1", extra), event());
    let calls = 0; await processMetaConfirmations(env, { now: noon, fetcher: async () => { calls++; } });
    assert.equal(calls, 0, name); assert.equal(select(db, "meta_sms_jobs")[0].status, "blocked", name);
  }
  const db = database(); approve(db); const env = environment(db);
  await storeMetaLead(db, env, form("lead-1", { number_of_dogs: "4 or more", zip_code: "", service_frequency: "" }), event());
  let calls = 0;
  await processMetaConfirmations(env, { now: new Date("2026-09-17T05:00:00Z"), fetcher: async () => { calls++; return Response.json({ data: { id: "night-confirmation" } }); } });
  assert.equal(calls, 1); assert.match(select(db, "meta_sms_jobs")[0].message_body, /how many dogs total/);
  db.sqlite.exec("UPDATE meta_automation_releases SET revoked_at=CURRENT_TIMESTAMP");
  assert.equal(await metaReleaseApproved(db, env), false);
  assert.equal(metaCadenceQuietHours(new Date(NaN)), true);
});

test("concurrent dispatch sends once; delivery receipts can arrive before acceptance is persisted", async () => {
  const db = database(); approve(db); const env = environment(db); await storeMetaLead(db, env, form(), event());
  let calls = 0;
  const fetcher = async () => { calls++; await recordQuoDelivery(db, { type: "message.delivered", data: { object: { id: "sms-1", direction: "outgoing" } } }); return Response.json({ data: { id: "sms-1" } }); };
  await Promise.all([processMetaConfirmations(env, { now: noon, fetcher }), processMetaConfirmations(env, { now: noon, fetcher })]);
  assert.equal(calls, 1); assert.equal(select(db, "meta_sms_jobs").find((job) => job.purpose === "confirmation").status, "delivered");
  assert.equal(select(db, "lead_messages")[0].delivery_status, "delivered");
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "follow_up").length, 3);
});

test("provider failure and timeouts remain visible and are never retried automatically", async () => {
  for (const [fetcher, expected] of [[async () => new Response("rejected", { status: 400 }), "failed"], [async () => { throw new Error("timeout"); }, "unknown"], [async () => Response.json({ accepted: true }), "unknown"]]) {
    const db = database(); approve(db); const env = environment(db); await storeMetaLead(db, env, form(), event());
    let calls = 0; const send = async () => { calls++; return fetcher(); };
    await processMetaConfirmations(env, { now: noon, fetcher: send }); await processMetaConfirmations(env, { now: noon, fetcher: send });
    assert.equal(calls, 1); assert.equal(select(db, "meta_sms_jobs")[0].status, expected); assert.ok(select(db, "meta_sms_jobs")[0].error_message);
  }
});

test("overlapping replies preserve committed facts and hand off instead of answering unsent prompts", async () => {
  for (const concurrent of [true, false]) {
    const db = database(), env = environment(db);
    const saved = await storeMetaLead(db, env, form(), event());
    db.sqlite.exec("UPDATE meta_sms_jobs SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE purpose='confirmation'");
    const first = { providerMessageId: "overlap-1", text: "yes", from: "+14195550100" };
    const second = { ...first, providerMessageId: "overlap-2", text: "A" };
    if (concurrent) await Promise.all([recordMetaReply(db, saved.id, first), recordMetaReply(db, saved.id, second)]);
    else { await recordMetaReply(db, saved.id, first); await recordMetaReply(db, saved.id, second); }
    assert.equal(select(db, "meta_reply_decisions").length, 2);
    const state = JSON.parse(select(db, "meta_lead_intakes")[0].response_state);
    assert.equal(state.handoff, true); assert.equal(state.ready_for_route_audit, false);
    assert.equal(state.details.yard_size_tier, undefined);
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.status === "queued").length, 0);
    assert.match(select(db, "growth_leads")[0].next_action, /overlapping replies/);
  }
  const db = database(), env = environment(db), saved = await storeMetaLead(db, env, form(), event());
  const reply = { providerMessageId: "duplicate-inbound", text: "actually 3 dogs", from: "+14195550100" };
  await Promise.all([recordMetaReply(db, saved.id, reply), recordMetaReply(db, saved.id, reply)]);
  assert.equal(select(db, "meta_reply_decisions").length, 1);
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "reply").length, 1);
});

test("Meta personal-text requests queue one owner email and pause the thread without sending", async () => {
  const db = database(), env = environment(db), saved = await storeMetaLead(db, env, form(), event());
  db.sqlite.exec("UPDATE meta_sms_jobs SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE purpose='confirmation'");
  const oldFetch = globalThis.fetch;
  let externalRequests = 0;
  globalThis.fetch = async () => { externalRequests++; throw new Error("This queue test must not send email or SMS"); };
  try {
    await recordMetaReply(db, saved.id, { providerMessageId: "identity-question", text: "are you a real person?", from: "+14195550100" }, { env });
    const disclosure = select(db, "meta_sms_jobs").find((job) => job.purpose === "reply");
    assert.equal(disclosure.message_body, "These texts use AI with my approved replies. If you'd prefer a personal reply, I'll pause the automated messages and follow up myself.");
    assert.equal((disclosure.message_body.match(/Reply STOP/g) || []).length, 0);
    assert.equal(select(db, "submission_notifications").length, 0);
    const yes = { providerMessageId: "identity-yes", text: "yes please", from: "+14195550100" };
    // Even a reply overlapping the pending disclosure must honor the human request.
    await recordMetaReply(db, saved.id, yes, { env });
    await recordMetaReply(db, saved.id, yes, { env });
    assert.equal(select(db, "lead_conversations")[0].automation_mode, "paused");
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.status === "queued").length, 0);
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.trigger_id === yes.providerMessageId).length, 0);
    const growth = select(db, "growth_leads")[0];
    assert.equal(growth.priority, "high");
    assert.equal(growth.next_action, "Craig: customer asked you to text personally. Reply personally; automated texts are paused.");
    const emails = select(db, "submission_notifications");
    assert.equal(emails.length, 1);
    assert.equal(emails[0].recipient, env.OWNER_NOTIFICATION_EMAIL);
    assert.equal(emails[0].status, "queued");
    assert.equal(emails[0].notification_type, "question");
    assert.equal(emails[0].subject, "Facebook lead requests a personal text from Craig");
    assert.match(emails[0].text_body, /Name: ExampleLead Example\nPhone: \+14195550100/);
    assert.match(emails[0].text_body, /Automated texts are paused/);
    await recordMetaReply(db, saved.id, { ...yes, providerMessageId: "later-reply", text: "43615" }, { env });
    assert.equal(select(db, "submission_notifications").length, 1);
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.status === "queued").length, 0);
    assert.equal(externalRequests, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("an accepted Meta quote and address atomically queue a deduplicated owner audit email", async () => {
  const db = database(), env = environment(db), saved = await storeMetaLead(db, env, form(), event());
  const details = { number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly", yard_size_tier: "tiny", last_cleaned: "one_month" };
  const state = { details, details_confirmed: true, quote: metaWebsiteQuote(details), quote_accepted: true, expected: "address" };
  db.sqlite.exec("UPDATE meta_sms_jobs SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE purpose='confirmation'");
  db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(JSON.stringify(state), saved.id);
  const address = { providerMessageId: "accepted-address", text: "123 Maple Street, Toledo", from: "+14195550100" };
  const oldFetch = globalThis.fetch;
  let externalRequests = 0;
  globalThis.fetch = async () => { externalRequests++; throw new Error("This queue test must not send email or SMS"); };
  try {
    const broken = { ...db, batch: async (statements) => db.batch([...statements, db.prepare("INSERT INTO missing_table VALUES (1)")]) };
    await assert.rejects(recordMetaReply(broken, saved.id, address, { env }));
    assert.equal(select(db, "submission_notifications").length, 0);
    assert.equal(JSON.parse(select(db, "meta_lead_intakes")[0].response_state).ready_for_route_audit, undefined);
    await recordMetaReply(db, saved.id, address, { env });
    await recordMetaReply(db, saved.id, address, { env });
    const finalState = JSON.parse(select(db, "meta_lead_intakes")[0].response_state);
    assert.equal(finalState.ready_for_route_audit, true);
    assert.equal(select(db, "growth_leads")[0].priority, "high");
    assert.equal(select(db, "growth_leads")[0].next_action, "Craig: quote accepted and address received. Create the account and audit the route/service day before confirming a start date.");
    const email = select(db, "submission_notifications")[0];
    assert.equal(select(db, "submission_notifications").length, 1);
    assert.equal(email.recipient, env.OWNER_NOTIFICATION_EMAIL);
    assert.equal(email.status, "queued");
    assert.equal(email.notification_type, "partial_quote");
    const rendered = buildMetaOwnerNotification({ submissionId: saved.id, lead: { name: "ExampleLead Example", phone: "+14195550100" }, state: finalState });
    assert.equal(email.subject, "Facebook lead ready for signup and route audit");
    assert.equal(email.text_body, rendered.content.text);
    assert.equal(email.text_body, `Craig,\n\nThis Facebook lead accepted the quote and provided a service address. Create the account and audit the route/service day before confirming a start date.\n\nName: ExampleLead Example\nPhone: +14195550100\nAddress: 123 Maple Street, Toledo\nZIP: 43615\nDogs: 2\nFrequency: Weekly\nQuoted price: $105.00 per month\nInitial cleanup estimate: $58 to $70\nSubmission ID: ${saved.id}\n\nGrowth Desk: https://www.ohiopetwastepros.com/admin/quote-funnel/`);
    assert.equal(externalRequests, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("Meta owner email renderer only alerts on actionable states and escapes lead content", () => {
  assert.equal(buildMetaOwnerNotification({ submissionId: "fixture", lead: {}, state: { quote_accepted: true } }), null);
  assert.equal(buildMetaOwnerNotification({ submissionId: "fixture", lead: {}, state: { ready_for_route_audit: true, details: { address: "123 Example Street" } } }), null);
  const email = buildMetaOwnerNotification({ submissionId: "fixture", lead: { name: "<script>bad</script>", phone: "+14195550100" }, state: { human_requested: true } });
  assert.match(email.content.text, /Name: <script>bad<\/script>/);
  assert.doesNotMatch(email.content.html, /<script>/);
  assert.match(email.content.html, /&lt;script&gt;/);
});

test("reply branches and exact website pricing progress to audited signup without inventing a price or day", () => {
  const lead = { name: "ExampleLead", number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly" };
  let step = nextMetaResponse({ lead, text: "yes", confirmationSent: true });
  assert.equal(step.state.expected, "yard");
  step = nextMetaResponse({ lead, state: step.state, text: "A", confirmationSent: true }); assert.equal(step.state.expected, "cleaned");
  step = nextMetaResponse({ lead, state: step.state, text: "D", confirmationSent: true }); assert.equal(step.state.expected, "quote_acceptance"); assert.equal(step.state.quote.monthly, 105);
  step = nextMetaResponse({ lead, state: step.state, text: "yes", confirmationSent: true }); assert.equal(step.state.expected, "address");
  step = nextMetaResponse({ lead, state: step.state, text: "123 Maple Street, Toledo", confirmationSent: true }); assert.equal(step.state.ready_for_route_audit, true); assert.match(step.response, /No day is booked/);
  assert.equal(metaWebsiteQuote({ ...lead, yard_size_tier: "tiny", last_cleaned: "one_month", number_of_dogs: 20 }), null);
  assert.equal(metaWebsiteQuote({ ...lead, yard_size_tier: "unsure", last_cleaned: "one_month" }), null);
  for (const [text, branch] of [["wrong number", "wrong_number"], ["STOP", "opted_out"], ["email me instead", "channel_change"], ["next month, puppies", "delayed_start"], ["lots of poop buildup", "buildup"]]) {
    assert.equal(nextMetaResponse({ lead, text }).branch, branch);
  }
  const correction = nextMetaResponse({ lead, text: "actually 3 dogs", confirmationSent: true });
  assert.equal(correction.state.details.number_of_dogs, 3); assert.equal(correction.state.expected, "confirm");
  assert.equal(correction.response, "Thanks for clarifying. Just to make sure I have it right, you have 3 dogs in ZIP 43615 and are looking for weekly service. Did I get that right?");
  assert.doesNotMatch(correction.response, /automated confirmation|[\u2013\u2014]/i);
});

test("streamed webhook size is bounded before buffering the whole body", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); controller.enqueue(new Uint8Array(9)); controller.close(); } });
  await assert.rejects(readBoundedBytes(new Response(stream), 10), RangeError);
});

// Run the actual route handlers and Airtable writer with only runtime bindings and network replaced.
let routes;
async function handlers() {
  if (routes) return routes;
  const output = await build({ stdin: { contents: 'export { POST as metaPost } from "./app/api/webhooks/meta-leads/route.js"; export { POST as quoPost } from "./app/api/webhooks/quo-messages/route.js"; export { PATCH as adminPatch } from "./app/api/admin/growth-desk/[submissionId]/route.js"; export { runScheduledYardOps, getLeadRecord, deleteLead, processAirtableQueue, queueLeadSync } from "./lib/lead-assistant.js";', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "node", packages: "external", plugins: [{ name: "test-runtime", setup(builder) {
    builder.onResolve({ filter: /^otpauth$/ }, () => ({ path: createRequire(import.meta.url).resolve("otpauth").replace(".cjs", ".mjs"), external: false }));
    builder.onResolve({ filter: /^next\/headers$/ }, () => ({ path: "test-headers", namespace: "fixture-headers" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture-headers" }, () => ({ contents: "export async function headers() { return globalThis.__metaTestHeaders; }", loader: "js" }));
    builder.onResolve({ filter: /(?:^|\/)cloudflare(?:\.js)?$/ }, () => ({ path: "test-runtime", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function getRuntimeEnv() { return globalThis.__metaTestEnv; } export function getCloudflareContext() { return {ctx:{waitUntil(promise){globalThis.__metaBackground ||= [];globalThis.__metaBackground.push(promise);}}}; }", loader: "js" }));
  } }] });
  routes = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
  return routes;
}
function signedMeta(body) { const raw = JSON.stringify(body); return new Request("https://opwp.test/api/webhooks/meta-leads", { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "test-meta-secret").update(raw).digest("hex")}` }, body: raw }); }
function signedQuo(text, id = "reply-1") {
  const raw = JSON.stringify({ id: `event-${id}`, type: "message.received", data: { object: { id, direction: "incoming", text, from: "+14195550100", to: ["+14192622371"], createdAt: new Date().toISOString() } } });
  const timestamp = Date.now(); const digest = createHmac("sha256", "test-quo-secret").update(`${timestamp}.${raw}`).digest("base64");
  return new Request("https://opwp.test/api/webhooks/quo-messages", { method: "POST", headers: { "openphone-signature": `hmac;1;${timestamp};${digest}` }, body: raw });
}

test("signed Meta → YardOps → Airtable → Quo → reply integration, retries, STOP and conversion", async () => {
  const db = database(); approve(db); const env = environment(db); globalThis.__metaTestEnv = env;
  const api = await handlers(); const originalFetch = globalThis.fetch;
  const sends = [], airtable = createAirtableContactFixture(), mirrors = airtable.writes;
  globalThis.fetch = async (url, options) => {
    const safety = airtable.fetcher(url, options);
    if (safety) return safety;
    if (String(url).startsWith("https://graph.facebook.com/")) return Response.json(form());
    if (String(url) === "https://api.openphone.com/v1/messages") { sends.push(JSON.parse(options.body)); return Response.json({ data: { id: `sent-${sends.length}` } }); }
    throw new Error(`Unexpected external request: ${url}`);
  };
  try {
    const body = { entry: [{ id: "page-1", changes: [{ field: "leadgen", value: { leadgen_id: "lead-1", form_id: "form-1" } }] }] };
    assert.equal((await api.metaPost(signedMeta(body))).status, 200);
    assert.equal((await api.metaPost(signedMeta(body))).status, 200);
    await processMetaConfirmations(env, { now: noon });
    await api.runScheduledYardOps(env);
    assert.equal(sends.length, 1); assert.ok(mirrors.length >= 1);
    assert.equal(new Set(mirrors.map((request) => request.fields["Meta Lead ID"])).size, 1);
    assert.equal(mirrors[0].tableId, "tblxniDSLBZdba6Z7");
    assert.equal(mirrors[0].fields["Meta Lead ID"], "lead-1");
    assert.equal(mirrors[0].fields.Phone, "+14195550100");
    assert.equal(mirrors[0].fields.ZIP, "43615");
    assert.equal(JSON.parse(select(db, "submissions")[0].payload).number_of_dogs, 2);
    assert.equal((await api.quoPost(signedQuo("yes"))).status, 200);
    assert.equal((await api.quoPost(signedQuo("yes"))).status, 200);
    await processMetaConfirmations(env, { now: noon });
    assert.equal(sends.length, 2); assert.match(sends[1].content, /About how big/);
    assert.equal(select(db, "meta_reply_decisions").length, 1);
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "follow_up" && job.status === "queued").length, 0);
    const snapshotAt = new Date().toISOString();
    db.sqlite.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES ('business_cockpit',?,'success',?)`).run(JSON.stringify({ opwp: { customers: [{ fields: { Status: "Active", ZIP: "43615", "Service Day": "Tuesday" } }] } }), snapshotAt);
    for (const [text, id, pattern] of [["A", "yard", /last thoroughly cleaned up/], ["about 1 month", "cleaned", /\$105\.00 per month/], ["yes", "accept", /address for the service/], ["123 Maple Street, Toledo", "address", /check the route and confirm/]]) {
      assert.equal((await api.quoPost(signedQuo(text, id))).status, 200);
      await processMetaConfirmations(env, { now: noon });
      assert.match(sends.at(-1).content, pattern);
    }
    await api.processAirtableQueue(env, 10);
    const savedContext = JSON.parse(select(db, "submissions")[0].payload);
    assert.equal(savedContext.meta_response_state.details.last_cleaned_answer, "about 1 month");
    assert.match(JSON.stringify(savedContext.meta_response_state.quote), /\$58 to \$70/);
    assert.equal(mirrors.at(-1).fields["Meta Lead ID"], "lead-1");
    const id = select(db, "submissions")[0].id;
    const token = await fixtureAdminSession("craig@ohiopetwastepros.com");
    const auditRequest = new Request(`https://opwp.test/api/admin/growth-desk/${id}`, { method: "PATCH", headers: { origin: "https://opwp.test", "content-type": "application/json", cookie: `__Host-opwp_admin_mfa=${token}` }, body: JSON.stringify({ action: "audit_meta_route", days: ["Tuesday"], snapshotAt }) });
    globalThis.__metaTestHeaders = auditRequest.headers;
    assert.equal((await api.adminPatch(auditRequest, { params: Promise.resolve({ submissionId: id }) })).status, 200);
    await processMetaConfirmations(env, { now: noon });
    assert.equal(sends.length, 7); assert.match(sends.at(-1).content, /reviewed Tuesday/); assert.match(sends.at(-1).content, /free-quote/);
    assert.equal((await api.quoPost(signedQuo("wrong number", "wrong"))).status, 200);
    await processMetaConfirmations(env, { now: noon }); assert.equal(sends.length, 7);
    assert.equal(select(db, "growth_leads")[0].outcome_reason, "wrong_number"); assert.equal(select(db, "lead_suppressions").length, 1);
    const noSignature = new Request("https://opwp.test/api/webhooks/meta-leads", { method: "POST", body: JSON.stringify(body) });
    assert.equal((await api.metaPost(noSignature)).status, 401);
    const otherPage = { entry: [{ id: "other-page", changes: body.entry[0].changes }] };
    assert.equal((await api.metaPost(signedMeta(otherPage))).status, 403);
    const lead = await api.getLeadRecord(db, select(db, "submissions")[0].id);
    await api.deleteLead(db, lead, "fixture deletion", "test-owner");
    assert.equal(select(db, "meta_reply_decisions")[0].state_json, "{}");
    assert.ok(select(db, "meta_reply_decisions").every((decision) => decision.prior_state_json === "{}"));
  } finally { globalThis.fetch = originalFetch; delete globalThis.__metaTestEnv; delete globalThis.__metaTestHeaders; }
});

test("conversion cancels confirmation; Meta labels never establish paying-customer state", async () => {
  const db = database(); approve(db); const env = environment(db);
  const saved = await storeMetaLead(db, env, { ...form(), status: "Converted" }, event());
  assert.equal(select(db, "growth_leads")[0].stage, "new");
  db.sqlite.prepare("UPDATE submissions SET lifecycle_stage='converted' WHERE id=?").run(saved.id);
  assert.equal(select(db, "meta_sms_jobs")[0].status, "cancelled");
});

test("no response closes only after the approved cadence is fully delivered plus 48 hours", async () => {
  const db = database(); approve(db); const env = environment(db); await storeMetaLead(db, env, form(), event());
  await processMetaConfirmations(env, { now: noon, fetcher: async () => Response.json({ data: { id: "initial" } }) });
  assert.equal((await markMetaNoResponse(env)).marked, 0);
  db.sqlite.exec("UPDATE meta_sms_jobs SET status='delivered',delivered_at=datetime('now','-49 hours') WHERE purpose='follow_up'");
  assert.equal((await markMetaNoResponse({ ...env, META_CADENCE_APPROVAL_ID: "" })).marked, 0);
  assert.equal((await markMetaNoResponse(env)).marked, 1);
  assert.equal(select(db, "growth_leads")[0].outcome_reason, "no_response");
});

test("route guidance uses fresh active Airtable customers and requires a scoped human audit", async () => {
  const db = database(); const env = environment(db, false); const saved = await storeMetaLead(db, env, form(), event());
  const capturedAt = new Date().toISOString();
  const payload = JSON.stringify({ opwp: { customers: [{ fields: { Status: "Active", ZIP: "43615", "Service Day": "Tuesday" } }, { fields: { Status: "Inactive", ZIP: "43615", "Service Day": "Friday" } }] } });
  const details = { zip: "43615", clean_up_frequency: "Weekly", address: "123 Maple Street, Toledo" };
  assert.deepEqual(routeGuidanceFromSnapshot({ captured_at: capturedAt, status: "success", payload }, details).candidates.map((row) => row.day), ["Tuesday"]);
  assert.equal(routeGuidanceFromSnapshot({ captured_at: "2020-01-01", status: "success", payload }, details).candidates.length, 0);
  db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES ('business_cockpit',?,'success',?)").run(payload, capturedAt);
  db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(JSON.stringify({ details, ready_for_route_audit: true }), saved.id);
  const lead = { id: saved.id, source: "facebook", conversation_id: select(db, "lead_conversations")[0].id, payload: select(db, "submissions")[0].payload };
  await assert.rejects(auditMetaRoute(db, lead, { days: ["Friday"], snapshotAt: capturedAt }, "test-owner"));
  const stateBeforeRace = select(db, "meta_lead_intakes")[0].response_state;
  const racingDb = { ...db, batch: async (statements) => {
    db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(JSON.stringify({ details, ready_for_route_audit: false, handoff: true }), saved.id);
    return db.batch(statements);
  } };
  await assert.rejects(auditMetaRoute(racingDb, lead, { days: ["Tuesday"], snapshotAt: capturedAt }, "test-owner"));
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "signup").length, 0);
  assert.equal(select(db, "meta_lead_intakes")[0].route_audited_at, null);
  db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(stateBeforeRace, saved.id);
  await auditMetaRoute(db, lead, { days: ["Tuesday"], snapshotAt: capturedAt }, "test-owner");
  assert.ok(select(db, "meta_lead_intakes")[0].route_audited_by); assert.equal(select(db, "meta_sms_jobs").find((job) => job.purpose === "signup").status, "queued");
  assert.equal(await metaReleaseApproved(db, env), false);
});

test("a cleanup correction cancels signup, invalidates its audit and clears the authoritative quote before mirroring", async () => {
  const db = database(), env = environment(db, false), api = await handlers();
  const saved = await storeMetaLead(db, env, form(), event());
  const details = { number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly", yard_size_tier: "tiny", last_cleaned: "one_month", address: "123 Maple Street, Toledo" };
  const state = { details, details_confirmed: true, quote: metaWebsiteQuote(details), quote_accepted: true, handoff: true, ready_for_route_audit: true };
  db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(JSON.stringify(state), saved.id);
  const snapshotAt = new Date().toISOString();
  db.sqlite.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES ('business_cockpit',?,'success',?)`).run(JSON.stringify({ opwp: { customers: [{ fields: { Status: "Active", ZIP: "43615", "Service Day": "Tuesday" } }] } }), snapshotAt);
  const lead = { id: saved.id, source: "facebook", conversation_id: select(db, "lead_conversations")[0].id, payload: select(db, "submissions")[0].payload };
  await auditMetaRoute(db, lead, { days: ["Tuesday"], snapshotAt }, "test-owner");
  await recordMetaReply(db, saved.id, { providerMessageId: "cleanup-correction", text: "actually 6 months ago", from: "+14195550100" });
  assert.equal(select(db, "meta_lead_intakes")[0].route_audited_at, null);
  assert.equal(select(db, "meta_sms_jobs").find((job) => job.purpose === "signup").status, "cancelled");
  assert.equal(JSON.parse(select(db, "submissions")[0].payload).quoted_monthly_total, undefined);
  const oldFetch = globalThis.fetch;
  const airtable = createAirtableContactFixture();
  try {
    globalThis.fetch = async (url, init) => airtable.fetcher(url, init);
    await api.processAirtableQueue(env, 1);
  } finally { globalThis.fetch = oldFetch; }
  assert.equal(select(db, "lead_airtable_sync")[0].status, "synced");
  assert.equal(airtable.writes.at(-1).fields["Meta Lead ID"], "lead-1");
  assert.equal(Object.hasOwn(airtable.writes.at(-1).fields, "Monthly Quote"), false, "The Meta Leads schema does not accept website-only quote fields");
  const summary = metaCleanupSummary(JSON.parse(select(db, "submissions")[0].payload).meta_response_state);
  assert.match(summary, /actually 6 months ago/);
  assert.match(summary, /Custom quote/);
  assert.doesNotMatch(summary, /\$/);
  // A newly confirmed scope can receive a fresh audit without reviving the cancelled job.
  db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=? WHERE submission_id=?").run(JSON.stringify(state), saved.id);
  await auditMetaRoute(db, lead, { days: ["Tuesday"], snapshotAt }, "test-owner");
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "signup" && job.status === "queued").length, 1);
  assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "signup" && job.status === "cancelled").length, 1);
});

test("signup stops outreach, but Won requires verified payment and a unique service invoice", async () => {
  const db = database(), env = environment(db, false);
  const saved = await storeMetaLead(db, env, form("lead-1", { email: "examplelead@example.com" }), event());
  db.sqlite.prepare(`INSERT INTO submissions (id,kind,email,phone,payload,sng_sync_state,sng_entity_id) VALUES ('onboarded','onboarding','examplelead@example.com','4195550100','{}','succeeded','client-123')`).run();
  assert.equal((await reconcileMetaConversions(db)).signups, 1);
  assert.equal(select(db, "meta_sms_jobs")[0].status, "cancelled");
  assert.notEqual(select(db, "growth_leads")[0].stage, "won");
  const payment = { eventId: "payment-1", body: { data: { client: "client-123", reference_number: "receipt-1", amount: 100 } } };
  assert.equal(await recordVerifiedMetaPayment(db, payment), false);
  assert.equal((await reconcileMetaConversions(db)).wins, 0);
  await recordVerifiedMetaPayment(db, { ...payment, verified: true });
  assert.equal((await reconcileMetaConversions(db)).wins, 0);
  db.sqlite.prepare(`INSERT INTO sng_events (id,event_type,external_id,payload,status) VALUES ('invoice-1','client:invoice_finalized','invoice-1',?,'processed')`).run(JSON.stringify({ data: { client: "client-123", total: 100, items: [{ description: "Weekly poop scooping" }] } }));
  assert.equal((await reconcileMetaConversions(db)).wins, 1);
  assert.equal((await reconcileMetaConversions(db)).wins, 0);
  assert.equal(select(db, "growth_leads")[0].stage, "won");
  assert.ok(select(db, "meta_lead_intakes")[0].paid_at);
  assert.equal(select(db, "submissions").find((row) => row.id === saved.id).lifecycle_stage, "converted");
});

test("conversion reconciliation rotates past its batch limit instead of starving older leads", async () => {
  const db = database(), env = environment(db, false);
  for (let index = 0; index < 101; index++) {
    const id = `batch-${index}`;
    await storeMetaLead(db, env, form(id, { phone_number: `+1419555${String(index).padStart(4, "0")}` }), event(id));
  }
  await reconcileMetaConversions(db);
  assert.equal(select(db, "meta_lead_intakes").filter((lead) => lead.conversion_checked_at).length, 100);
  await reconcileMetaConversions(db);
  assert.equal(select(db, "meta_lead_intakes").filter((lead) => lead.conversion_checked_at).length, 101);
});

test("test sending needs its own approval and exact tester phone and form allowlists", async () => {
  const db = database(); approve(db);
  db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('test-only','org-opwp','meta-confirmation-v2-test','test-owner','test plan only',datetime('now','-1 minute'),NULL)`);
  const env = { ...environment(db, false), META_TEST_MODE: "true", META_TEST_APPROVAL_ID: "test-only", META_TEST_RECIPIENTS: "+14195550100", META_TEST_FORM_IDS: "form-1" };
  assert.equal(await metaReleaseApproved(db, env), true);
  assert.equal(await metaReleaseApproved(db, { ...env, META_AUTOMATION_ENABLED: "true" }), false);
  await storeMetaLead(db, env, form(), event());
  await storeMetaLead(db, env, form("lead-2", { phone_number: "+14195550101" }), event("lead-2"));
  let sent = 0;
  await processMetaConfirmations(env, { now: noon, fetcher: async () => { sent++; return Response.json({ data: { id: "allowed-test" } }); } });
  assert.equal(sent, 1);
  assert.equal(select(db, "meta_sms_jobs").find((job) => job.block_reason === "not_an_approved_test_lead").status, "cancelled");
});

test("test release approval does not override disabled assistant or required human review", async () => {
  for (const [assistantEnabled, humanReviewRequired] of [[0, 1], [0, 0], [1, 1]]) {
    const db = database();
    db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('test-only','org-opwp','meta-confirmation-v2-test','test-owner','test plan only',datetime('now','-1 minute'),NULL)`);
    db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=?,human_review_required=?").run(assistantEnabled, humanReviewRequired);
    const env = { ...environment(db, false), META_TEST_MODE: "true", META_TEST_APPROVAL_ID: "test-only", META_TEST_RECIPIENTS: "+14195550100", META_TEST_FORM_IDS: "form-1" };
    await storeMetaLead(db, env, form(), event());
    let calls = 0;
    const result = await processMetaConfirmations(env, { now: noon, fetcher: async () => { calls++; throw new Error("Review-gated job must not contact Quo"); } });
    assert.deepEqual(result, { enabled: true, deferred: "review_required", sent: 0 });
    assert.equal(calls, 0);
    assert.equal(select(db, "meta_sms_jobs")[0].status, "queued");
  }
});

test("Airtable failures retry by stable ID and concurrent changes cannot be lost", async () => {
  const db = database(), env = environment(db, false), api = await handlers();
  const saved = await storeMetaLead(db, env, form(), event());
  const airtable = createAirtableContactFixture();
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { message: "fixture unavailable" } }, { status: 400 });
    await api.processAirtableQueue(env, 1);
    assert.equal(select(db, "lead_airtable_sync")[0].status, "failed");
    await api.queueLeadSync(db, saved.id, "facebook_lead");
    let changedDuringWrite = false;
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === "PATCH" && !changedDuringWrite) {
        changedDuringWrite = true;
        await api.queueLeadSync(db, saved.id, "facebook_lead");
      }
      return airtable.fetcher(url, options);
    };
    await api.processAirtableQueue(env, 1);
    assert.equal(select(db, "lead_airtable_sync")[0].status, "queued");
    globalThis.fetch = async (url, options) => airtable.fetcher(url, options);
    await api.processAirtableQueue(env, 1);
    assert.equal(select(db, "lead_airtable_sync")[0].status, "synced");
    assert.equal(airtable.records.get("tblxniDSLBZdba6Z7").length, 1, "Retry preserves the Meta source key");
  } finally { globalThis.fetch = oldFetch; }
});

test("route-audit API enforces session, same origin, relief technician identity and organization scope", async () => {
  const db = database(), env = environment(db, false), api = await handlers(); globalThis.__metaTestEnv = env;
  const saved = await storeMetaLead(db, env, form(), event());
  const body = { action: "audit_meta_route", days: ["Tuesday"], snapshotAt: new Date().toISOString() };
  async function request({ email, origin = "https://opwp.test", id = saved.id, token } = {}) {
    const cookie = token || (email ? await fixtureAdminSession(email) : "");
    const request = new Request(`https://opwp.test/api/admin/growth-desk/${id}`, { method: "PATCH", headers: { origin, "content-type": "application/json", cookie: `__Host-opwp_admin_mfa=${cookie}` }, body: JSON.stringify(body) });
    globalThis.__metaTestHeaders = request.headers;
    return api.adminPatch(request, { params: Promise.resolve({ submissionId: id }) });
  }
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request({ token: "invalid.signature" })).status, 401);
    const claims = Buffer.from(JSON.stringify({ aud: "opwp-admin", sub: "craig@ohiopetwastepros.com", exp: 1 })).toString("base64url");
    const signature = createHmac("sha256", env.ADMIN_SESSION_SECRET).update(claims).digest("base64url");
    assert.equal((await request({ token: `${claims}.${signature}` })).status, 401);
    assert.equal((await request({ email: "craig@ohiopetwastepros.com", origin: "https://attacker.test" })).status, 403);
    assert.equal((await request({ email: "office@example.com" })).status, 403);
    db.sqlite.exec("UPDATE lead_conversations SET organization_id='org-other'");
    assert.equal((await request({ email: "craig@ohiopetwastepros.com" })).status, 404);
  } finally { delete globalThis.__metaTestEnv; delete globalThis.__metaTestHeaders; }
});
