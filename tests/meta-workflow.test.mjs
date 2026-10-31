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
import { storeMetaLead, processMetaConfirmations, recordMetaReply, recordQuoDelivery, metaReleaseApproved, markMetaNoResponse } from "../lib/meta-lead-workflow.mjs";
import { exactDogs, mapMetaAnswers, metaQuietHours, metaConsentEvidence, buildMetaConfirmation } from "../lib/meta-lead-policy.mjs";
import { nextMetaResponse, metaWebsiteQuote } from "../lib/meta-conversation.mjs";
import { auditMetaRoute, routeGuidanceFromSnapshot } from "../lib/meta-route-guidance.mjs";
import { readBoundedBytes } from "../lib/bounded-body.mjs";
import { recordVerifiedMetaPayment, reconcileMetaConversions } from "../lib/meta-conversion.mjs";

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
  return { DB: db, META_AUTOMATION_ENABLED: enabled ? "true" : "false", META_AUTOMATION_APPROVAL_ID: "test-release", META_CADENCE_APPROVAL_ID: "test-cadence", META_ALLOWED_PAGE_IDS: "page-1", META_APP_SECRET: "test-meta-secret", META_GRAPH_API_VERSION: "v26.0", META_PAGE_ACCESS_TOKEN: "test-meta-token", QUO_WEBHOOK_SIGNING_KEY: Buffer.from("test-quo-secret").toString("base64"),
    QUO_API_KEY: "test-quo-key", QUO_FROM_NUMBER: "+14192622371", AIRTABLE_API_KEY: "test-airtable-key", ADMIN_SESSION_SECRET: "fixture-admin-signing-key", OWNER_NOTIFICATION_EMAIL: "craig@ohiopetwastepros.com",
    META_APPROVED_SMS_FORMS: JSON.stringify({ "form-1": { pageId: "page-1", consentField: "sms_consent", version: "test-disclosure-v1", disclosure: "Test disclosure: automated OPWP quote texts; STOP to opt out." } }) };
}
function approve(db) {
  db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('test-release','org-opwp','meta-confirmation-v2','test-owner','simulated tests only',datetime('now','-1 minute'),NULL);
    UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0;
    INSERT INTO meta_automation_releases VALUES ('test-cadence','org-opwp','meta-nurture-1-3-7-v1','test-owner','simulated tests only',datetime('now','-1 minute'),NULL);`);
}
const noon = new Date("2026-09-17T16:00:00Z");
const select = (db, table) => db.sqlite.prepare(`SELECT * FROM ${table}`).all();

test("Meta mapping preserves ambiguity, conflicts and separate consent", () => {
  for (const value of ["4+", "four or more dogs", "2 dogs and 3 puppies", "2-3 dogs", "about 2", "0"]) assert.equal(exactDogs(value), null, value);
  assert.equal(exactDogs("4 dogs"), 4);
  const mapped = mapMetaAnswers({ "how_many_dogs_do_you_have?": "2 dogs", "how would you like to be contacted?": "email", "zip code": "43615", "service frequency": "every other week" });
  assert.equal(mapped.number_of_dogs, 2); assert.equal(mapped.clean_up_frequency, "Biweekly"); assert.equal(mapped.preferred_channel, "email");
  assert.equal(mapMetaAnswers({ dog_count: "2", number_of_dogs: "3" }).number_of_dogs, null);
  assert.equal(metaConsentEvidence({ meta_form_id: "f", original_fields: { contact_preference: "text" } }, { f: { consentField: "contact_preference" } }).valid, false);
  const message = buildMetaConfirmation({ name: "ExampleLead", number_of_dogs: null, zip: "", clean_up_frequency: "" });
  assert.match(message, /How many dogs exactly/); assert.doesNotMatch(message, /I have 0|I have 4|undefined/); assert.match(message, /Reply STOP/);
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

test("release gates, no consent, email preference, missing data, quiet hours and suppression fail closed", async () => {
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
  await processMetaConfirmations(env, { now: new Date("2026-09-17T05:00:00Z"), fetcher: async () => { calls++; } });
  assert.equal(calls, 0); assert.match(select(db, "meta_sms_jobs")[0].message_body, /How many dogs exactly/);
  db.sqlite.exec("UPDATE meta_automation_releases SET revoked_at=CURRENT_TIMESTAMP");
  assert.equal(await metaReleaseApproved(db, env), false);
  assert.equal(metaQuietHours(null), true);
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

test("reply branches and exact website pricing progress to audited signup without inventing a price or day", () => {
  const lead = { name: "ExampleLead", number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly" };
  let step = nextMetaResponse({ lead, text: "yes", confirmationSent: true });
  assert.equal(step.state.expected, "yard");
  step = nextMetaResponse({ lead, state: step.state, text: "A", confirmationSent: true }); assert.equal(step.state.expected, "cleaned");
  step = nextMetaResponse({ lead, state: step.state, text: "D", confirmationSent: true }); assert.equal(step.state.expected, "quote_acceptance"); assert.equal(step.state.quote.monthly, 100);
  step = nextMetaResponse({ lead, state: step.state, text: "yes", confirmationSent: true }); assert.equal(step.state.expected, "address");
  step = nextMetaResponse({ lead, state: step.state, text: "123 Maple Street, Toledo", confirmationSent: true }); assert.equal(step.state.ready_for_route_audit, true); assert.match(step.response, /No day is booked/);
  assert.equal(metaWebsiteQuote({ ...lead, yard_size_tier: "tiny", last_cleaned: "one_month", number_of_dogs: 20 }), null);
  assert.equal(metaWebsiteQuote({ ...lead, yard_size_tier: "unsure", last_cleaned: "one_month" }), null);
  for (const [text, branch] of [["wrong number", "wrong_number"], ["STOP", "opted_out"], ["email me instead", "channel_change"], ["next month, puppies", "delayed_start"], ["lots of poop buildup", "buildup"]]) {
    assert.equal(nextMetaResponse({ lead, text }).branch, branch);
  }
  const correction = nextMetaResponse({ lead, text: "actually 3 dogs", confirmationSent: true });
  assert.equal(correction.state.details.number_of_dogs, 3); assert.equal(correction.state.expected, "confirm");
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
  const sends = [], mirrors = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://graph.facebook.com/")) return Response.json(form());
    if (String(url) === "https://api.openphone.com/v1/messages") { sends.push(JSON.parse(options.body)); return Response.json({ data: { id: `sent-${sends.length}` } }); }
    if (String(url).startsWith("https://api.airtable.com/")) { mirrors.push(JSON.parse(options.body)); return Response.json({ records: [{ id: "airtable-1" }] }); }
    throw new Error(`Unexpected external request: ${url}`);
  };
  try {
    const body = { entry: [{ id: "page-1", changes: [{ field: "leadgen", value: { leadgen_id: "lead-1", form_id: "form-1" } }] }] };
    assert.equal((await api.metaPost(signedMeta(body))).status, 200);
    assert.equal((await api.metaPost(signedMeta(body))).status, 200);
    await processMetaConfirmations(env, { now: noon });
    await api.runScheduledYardOps(env);
    assert.equal(sends.length, 1); assert.ok(mirrors.length >= 1);
    assert.equal(new Set(mirrors.map((request) => request.records[0].fields["YardOps Lead ID"])).size, 1);
    assert.equal(mirrors[0].records[0].fields["YardOps Lead ID"], select(db, "submissions")[0].id);
    assert.equal(mirrors[0].records[0].fields.Dogs, 2);
    assert.match(mirrors[0].records[0].fields["Customer Question"], /Meta lead: lead-1/);
    assert.equal((await api.quoPost(signedQuo("yes"))).status, 200);
    assert.equal((await api.quoPost(signedQuo("yes"))).status, 200);
    await processMetaConfirmations(env, { now: noon });
    assert.equal(sends.length, 2); assert.match(sends[1].content, /How large/);
    assert.equal(select(db, "meta_reply_decisions").length, 1);
    assert.equal(select(db, "meta_sms_jobs").filter((job) => job.purpose === "follow_up" && job.status === "queued").length, 0);
    const snapshotAt = new Date().toISOString();
    db.sqlite.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES ('business_cockpit',?,'success',?)`).run(JSON.stringify({ opwp: { customers: [{ fields: { Status: "Active", ZIP: "43615", "Service Day": "Tuesday" } }] } }), snapshotAt);
    for (const [text, id, pattern] of [["A", "yard", /last thoroughly cleared/], ["about 1 month", "cleaned", /\$100.00 per month/], ["yes", "accept", /street address/], ["123 Maple Street, Toledo", "address", /audit the current route/]]) {
      assert.equal((await api.quoPost(signedQuo(text, id))).status, 200);
      await processMetaConfirmations(env, { now: noon });
      assert.match(sends.at(-1).content, pattern);
    }
    await api.processAirtableQueue(env, 10);
    assert.match(mirrors.at(-1).records[0].fields["Customer Question"], /Customer's cleanup answer: about 1 month/);
    assert.match(mirrors.at(-1).records[0].fields["Customer Question"], /\$55.00–\$65.00/);
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

test("a cleanup correction cancels the signup invitation, invalidates its audit and clears the old Airtable price", async () => {
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
  let mirrored;
  try {
    globalThis.fetch = async (_url, init) => { mirrored = JSON.parse(init.body).records[0].fields; return Response.json({ records: [{ id: "fixture-record" }] }); };
    await api.processAirtableQueue(env, 1);
  } finally { globalThis.fetch = oldFetch; }
  assert.equal(mirrored["Monthly Quote"], null);
  assert.match(mirrored["Customer Question"], /actually 6 months ago/);
  assert.match(mirrored["Customer Question"], /Custom quote/);
  assert.doesNotMatch(mirrored["Customer Question"], /\$55/);
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

test("Airtable failures retry by stable ID and concurrent changes cannot be lost", async () => {
  const db = database(), env = environment(db, false), api = await handlers();
  const saved = await storeMetaLead(db, env, form(), event());
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { message: "fixture unavailable" } }, { status: 400 });
    await api.processAirtableQueue(env, 1);
    assert.equal(select(db, "lead_airtable_sync")[0].status, "failed");
    await api.queueLeadSync(db, saved.id, "facebook_lead");
    globalThis.fetch = async () => { await api.queueLeadSync(db, saved.id, "facebook_lead"); return Response.json({ records: [{ id: "same-record" }] }); };
    await api.processAirtableQueue(env, 1);
    assert.equal(select(db, "lead_airtable_sync")[0].status, "queued");
    globalThis.fetch = async () => Response.json({ records: [{ id: "same-record" }] });
    await api.processAirtableQueue(env, 1);
    assert.equal(select(db, "lead_airtable_sync")[0].status, "synced");
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
