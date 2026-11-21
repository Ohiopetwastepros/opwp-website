import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runPrivateInNewContext } from "./helpers/private-vm.mjs";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { validateLeadInput } from "../lib/public-input.js";
import { PARTIAL_QUOTE_FOLLOW_UP_DELAY_MINUTES } from "../lib/quote-funnel.mjs";
import { metaFollowUpDrafts } from "../lib/meta-conversation.mjs";
import { metaCadenceQuietHours } from "../lib/meta-lead-policy.mjs";
import { listLeadTrash, restoreLead } from "../lib/lead-trash.mjs";
import { controlledLeadRecipientAllowed } from "../lib/lead-rollout-policy.mjs";
import { websiteQuestionHoldStatements, normalizedQuestionPhone, questionPhoneSql, WebsiteQuestionIdentityConflict } from "../lib/website-question-hold.mjs";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

function fixture() {
  const db = leadTestDatabase();
  const providerCalls = []; const waits = []; const runs = []; const logs = [];
  let rejection = null;
  let acceptance = null;
  const accept = async () => { const callback = acceptance; acceptance = null; if (callback) await callback(); };
  const reject = (channel) => {
    if (rejection?.channel !== channel) return;
    const value = rejection; rejection = null;
    throw Object.assign(new Error("Fixture provider failure"), value);
  };
  const env = { DB: db, EMAIL_PROVIDER: "resend", SMS_PROVIDER: "quo", QUO_API_KEY: "fixture-only", QUO_FROM_NUMBER: "+14195550199" };
  const console = { log: (value) => logs.push(JSON.parse(value)), error: (value) => logs.push(JSON.parse(value)) };
  const run = runPrivateInNewContext(`${source("lib/quote-follow-up-delivery.js")}\nrunScheduledQuoteFollowUps;`, {
    URL, console, Error,
    controlledLeadRecipientAllowed,
    normalizeFrequency: (value) => value,
    normalizeLastCleaned: (value) => value,
    transactionalEmailConfig: (env) => ({ configured: true, provider: env.EMAIL_PROVIDER }),
    buildCustomerQuoteFollowUpSms: () => "Fixture body\n\nText STOP to unsubscribe.",
    buildCustomerQuoteFollowUpEmail: () => ({ subject: "Fixture", text: "Fixture", html: "Fixture" }),
    outboundFetch: async (url, options, context) => {
      const channel = context.operation === "partial_quote_lead" ? "sng_lead" : "customer_sms";
      providerCalls.push({ channel, url: String(url), options });
      if (rejection?.channel === channel && rejection.classification === "provider_rejected") {
        const status = rejection.status; rejection = null;
        return Response.json({}, { status });
      }
      reject(channel);
      await accept();
      return Response.json({ data: { id: `mock-${providerCalls.length}` } });
    },
    sendTransactionalEmail: async (_env, options) => {
      providerCalls.push({ channel: "customer_email", options }); reject("customer_email"); await accept(); return `mock-${providerCalls.length}`;
    },
    queueSubmissionNotificationSafe: async () => ({ status: "queued" }),
  });
  const store = runPrivateInNewContext(`${source("lib/db.js")}\n({queuePartialQuoteFollowUp,upsertPartialQuoteSubmission,saveSubmission});`, {
    crypto, getRuntimeEnv: () => env, PARTIAL_QUOTE_FOLLOW_UP_DELAY_MINUTES,
    websiteQuestionHoldStatements, normalizedQuestionPhone, questionPhoneSql, WebsiteQuestionIdentityConflict,
    queueLeadSync: async () => {},
  });
  let contextAvailable = true;
  let ownerGate = null;
  const api = runPrivateInNewContext(`${source("app/api/lead/route.js")}\n({POST});`, {
    Response, console, validateLeadInput, ...store,
    protectJsonRequest: async (request) => ({ body: await request.json() }),
    verifyTurnstile: async () => ({ ok: true }),
    queueSubmissionNotificationSafe: async () => { await ownerGate; return { status: "queued" }; },
    getCloudflareContext: () => {
      if (!contextAvailable) throw new Error("Fixture context unavailable");
      return { env, ctx: { waitUntil: (promise) => waits.push(promise) } };
    },
    runScheduledQuoteFollowUps: (...args) => { runs.push(args); return run(...args); },
  });
  const seed = (id) => db.sqlite.prepare(`INSERT INTO submissions (id,kind,source,status,email,phone,zip,payload)
    VALUES (?,'partial_quote','website','follow_up_pending','fixture@example.test','4195550100','43604','{}')`).run(id);
  const queue = (id, options = {}) => store.queuePartialQuoteFollowUp({ submissionId: id, phone: "4195550100", consentAt: new Date().toISOString(), ...options });
  const submit = (extra = {}) => api.POST(new Request("https://example.test/api/lead", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "partial_quote", funnel_id: "fixture_funnel_0001", email: "fixture@example.test", phone: "4195550100", zip: "43604", dogs: 2, frequency: "once_a_week", follow_up_consent: true, ...extra }),
  }));
  const rows = () => db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries ORDER BY channel").all();
  return { db, env, providerCalls, waits, runs, logs, run, queue, seed, submit, rows,
    rejectNext(channel, status, classification = "provider_rejected") { rejection = { channel, status, classification }; },
    duringAcceptance(callback) { acceptance = callback; },
    delayOwnerNotification() { let release; ownerGate = new Promise((resolve) => { release = resolve; }); return release; },
    withoutContext() { contextAvailable = false; } };
}

test("website zero-delay queues all three channels immediately without changing the default delay", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("immediate"); f.seed("default");
  const queued = await f.queue("immediate", { delayMinutes: 0 });
  const now = f.db.sqlite.prepare("SELECT CURRENT_TIMESTAMP now").get().now;
  assert.ok(queued.scheduledAt <= now);
  assert.equal(f.db.sqlite.prepare("SELECT scheduled_at>=datetime('now','-2 seconds') expected FROM quote_follow_ups WHERE submission_id='immediate'").get().expected, 1);
  assert.equal(f.rows().length, 3);
  for (const row of f.rows()) { assert.equal(row.status, "queued"); assert.ok(row.next_attempt_at <= now); assert.ok(row.next_attempt_at >= queued.scheduledAt); }
  await f.queue("default");
  assert.equal(f.db.sqlite.prepare("SELECT (strftime('%s',scheduled_at)-strftime('%s','now')) BETWEEN 598 AND 600 expected FROM quote_follow_ups WHERE submission_id='default'").get().expected, 1);
  assert.equal(f.providerCalls.length, 0);
});

test("simulated website handler starts its own three mocked deliveries through waitUntil and retries never duplicate sent rows", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("unrelated"); await f.queue("unrelated", { delayMinutes: 0 });
  const response = await f.submit();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.smsFollowup, "queued");
  assert.equal(f.waits.length, 1);
  assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0][0], f.env);
  assert.equal(f.runs[0][1], 3);
  assert.equal(f.runs[0][2].submissionId, result.id);
  await Promise.all(f.waits);
  assert.deepEqual(f.providerCalls.map((row) => row.channel).sort(), ["customer_email", "customer_sms", "sng_lead"]);
  assert.ok(f.rows().filter((row) => row.submission_id === result.id).every((row) => row.status === "sent" && row.attempt_count === 1));
  assert.ok(f.rows().filter((row) => row.submission_id === "unrelated").every((row) => row.status === "queued"));
  await f.submit(); await Promise.all(f.waits);
  assert.equal(f.providerCalls.length, 3, "repeated form requests preserve sent delivery claims");
});

test("cron drains the immediate queue when request context is unavailable", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.withoutContext();
  assert.equal((await f.submit()).status, 200);
  assert.equal(f.waits.length, 0);
  assert.equal(f.providerCalls.length, 0);
  assert.ok(f.rows().every((row) => row.status === "queued"));
  assert.equal((await f.run(f.env)).sent, 3);
  assert.equal(f.providerCalls.length, 3);
  assert.equal((await f.run(f.env)).sent, 0);
});

test("a slow owner notification cannot delay scheduling the customer waitUntil deliveries", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  const release = f.delayOwnerNotification();
  let responded = false;
  const responseTask = f.submit().then((response) => { responded = true; return response; });
  await new Promise(setImmediate);
  assert.equal(responded, false);
  assert.equal(f.waits.length, 1);
  assert.equal(f.runs.length, 1);
  await Promise.all(f.waits);
  assert.equal(f.providerCalls.length, 3);
  release(); assert.equal((await responseTask).status, 200);
});

test("overlapping request and cron runs claim queued and retry-eligible failed rows exactly once", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("overlap"); await f.queue("overlap", { delayMinutes: 0 });
  f.db.sqlite.exec("UPDATE quote_follow_up_deliveries SET status='failed',attempt_count=1 WHERE channel='customer_email'");
  await Promise.all([f.run(f.env, 3, { submissionId: "overlap" }), f.run(f.env)]);
  assert.equal(f.providerCalls.length, 3);
  assert.ok(f.rows().every((row) => row.status === "sent"));
  assert.equal(f.rows().find((row) => row.channel === "customer_email").attempt_count, 2);
  assert.equal(f.rows().find((row) => row.channel === "customer_sms").attempt_count, 1);
  await f.run(f.env); assert.equal(f.providerCalls.length, 3);
});

for (const [channel, status] of [["customer_sms", 429], ["customer_email", 503], ["sng_lead", 429]]) {
  test(`cron retries a due explicit ${channel} HTTP ${status} rejection without repeating successful channels`, async (t) => {
    const f = fixture(); t.after(() => f.db.sqlite.close());
    f.seed("retry"); await f.queue("retry", { delayMinutes: 0 });
    f.rejectNext(channel, status);
    assert.equal((await f.run(f.env, 3, { submissionId: "retry" })).failed, 1);
    const failed = f.rows().find((row) => row.channel === channel);
    assert.equal(failed.status, "failed"); assert.equal(failed.attempt_count, 1);
    assert.equal(f.db.sqlite.prepare("SELECT next_attempt_at>CURRENT_TIMESTAMP expected FROM quote_follow_up_deliveries WHERE id=?").get(failed.id).expected, 1);
    assert.equal((await f.run(f.env)).sent, 0, "backoff applies before cron retry");
    f.db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET next_attempt_at=CURRENT_TIMESTAMP WHERE id=?").run(failed.id);
    assert.equal((await f.run(f.env)).sent, 1);
    assert.equal(f.providerCalls.length, 4);
    if (channel === "customer_email") {
      const keys = f.providerCalls.filter((row) => row.channel === channel).map((row) => row.options.idempotencyKey);
      assert.deepEqual(keys, [`quote-follow-up/${failed.id}`, `quote-follow-up/${failed.id}`]);
    }
    assert.ok(f.rows().every((row) => row.status === "sent"));
    await f.run(f.env); assert.equal(f.providerCalls.length, 4);
  });
}

for (const [channel, status, classification] of [["sng_lead", 403, "provider_rejected"], ["customer_sms", 503, "provider_rejected"], ["sng_lead", 502, "provider_rejected"], ["customer_sms", 0, "timeout"]]) {
  test(`${channel} ${status || classification} stays terminal without an unsafe retry or existing-row reset`, async (t) => {
    const f = fixture(); t.after(() => f.db.sqlite.close());
    f.seed("permanent"); await f.queue("permanent", { delayMinutes: 0 });
    f.rejectNext(channel, status, classification);
    assert.equal((await f.run(f.env, 3, { submissionId: "permanent" })).failed, 1);
    assert.equal(f.rows().find((row) => row.channel === channel).attempt_count, 5);
    await f.queue("permanent", { delayMinutes: 0 });
    await f.run(f.env); assert.equal(f.providerCalls.length, 3);
  });
}

test("email 5xx remains terminal for a provider without Resend idempotency", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.env.EMAIL_PROVIDER = "cloudflare_email_service";
  f.seed("email-unknown"); await f.queue("email-unknown", { delayMinutes: 0 });
  f.rejectNext("customer_email", 503);
  await f.run(f.env, 3, { submissionId: "email-unknown" });
  assert.equal(f.rows().find((row) => row.channel === "customer_email").attempt_count, 5);
  await f.run(f.env); assert.equal(f.providerCalls.length, 3);
});

test("already-claimed, sent, cancelled and trashed work is not automatically sent or requeued", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("terminal"); await f.queue("terminal", { delayMinutes: 0 });
  f.db.sqlite.exec(`UPDATE quote_follow_up_deliveries SET status=CASE channel WHEN 'customer_email' THEN 'sent' WHEN 'customer_sms' THEN 'sending' ELSE 'cancelled' END,
    sending_at=CURRENT_TIMESTAMP,attempt_count=1;
    UPDATE quote_follow_ups SET status='cancelled';`);
  await f.queue("terminal", { delayMinutes: 0 });
  await f.run(f.env); assert.equal(f.providerCalls.length, 0);
  assert.equal(f.rows().length, 3);
  f.seed("trash");
  f.db.sqlite.exec("UPDATE submissions SET status='trashed' WHERE id='trash'");
  assert.equal((await f.queue("trash", { delayMinutes: 0 })).status, "cancelled");
  assert.equal(f.rows().length, 3);
});

test("trash trigger cancellation after a successful claim prevents provider calls even when changes is one", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("claim-trash"); await f.queue("claim-trash", { delayMinutes: 0 });
  const prepare = f.db.prepare;
  const changes = [];
  f.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!sql.startsWith("UPDATE quote_follow_up_deliveries SET status='sending'")) return statement;
    const decorate = (current) => ({ ...current,
      bind: (...args) => decorate(current.bind(...args)),
      run: async () => {
        const result = await current.run();
        if (result.meta.changes) {
          changes.push(result.meta.changes);
          // Simulate deletion winning after the SELECT but before provider I/O.
          f.db.sqlite.exec("UPDATE submissions SET status='trashed' WHERE id='claim-trash'; UPDATE quote_follow_up_deliveries SET status='sending' WHERE submission_id='claim-trash' AND status='sending'");
        }
        return result;
      },
    });
    return decorate(statement);
  };
  await f.run(f.env, 3, { submissionId: "claim-trash" });
  assert.deepEqual(changes, [1, 1, 1]);
  assert.equal(f.providerCalls.length, 0);
  assert.ok(f.rows().every((row) => row.status === "cancelled"));
});

test("an in-flight provider acceptance is retained as sent history after Trash and restore never resends it", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("accepted-after-trash"); await f.queue("accepted-after-trash", { delayMinutes: 0 });
  f.db.sqlite.exec("DELETE FROM quote_follow_up_deliveries WHERE channel!='customer_sms'");
  f.duringAcceptance(() => f.db.sqlite.exec(`
    INSERT INTO lead_inbox_trash(submission_id,organization_id,prior_status,deleted_by,command_id)
      VALUES ('accepted-after-trash','org-opwp','follow_up_pending','fixture@example.test','fixture-command');
    UPDATE submissions SET status='trashed' WHERE id='accepted-after-trash';
    UPDATE quote_follow_ups SET status='cancelled' WHERE submission_id='accepted-after-trash';
    UPDATE quote_follow_up_deliveries SET status='cancelled' WHERE submission_id='accepted-after-trash';
  `));
  assert.equal((await f.run(f.env, 3, { submissionId: "accepted-after-trash" })).sent, 1);
  assert.equal(f.rows()[0].status, "sent");
  assert.equal(f.rows()[0].provider_message_id, "mock-1");
  const trash = (await listLeadTrash(f.db)).leads[0];
  await restoreLead(f.db, trash.id, { action: "restore", version: trash.recordVersion }, "fixture@example.test");
  await f.queue("accepted-after-trash", { delayMinutes: 0 });
  await f.run(f.env);
  assert.equal(f.providerCalls.length, 1);
  assert.equal(f.rows()[0].provider_message_id, "mock-1");
  assert.equal(f.rows().length, 1, "restore leaves cancelled parent untouched instead of adding channels");
});

test("existing provider receipt evidence prevents an erroneously queued row from being claimed again", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("receipt-present"); await f.queue("receipt-present", { delayMinutes: 0 });
  f.db.sqlite.exec("UPDATE quote_follow_up_deliveries SET provider_message_id='existing-mock-receipt'");
  assert.equal((await f.run(f.env)).sent, 0);
  assert.equal(f.providerCalls.length, 0);
  assert.ok(f.rows().every((row) => row.provider_message_id === "existing-mock-receipt"));
});

test("website immediate sending leaves Meta day 1/3/7 cadence and quiet hours unchanged", () => {
  assert.deepEqual(metaFollowUpDrafts("Fixture").map(({ step, day }) => [step, day]), [[1, 1], [2, 3], [3, 7]]);
  assert.equal(metaCadenceQuietHours(new Date("2026-11-19T12:59:00Z")), true);
  assert.equal(metaCadenceQuietHours(new Date("2026-11-19T13:00:00Z")), false);
  assert.equal(metaCadenceQuietHours(new Date("2026-11-20T02:00:00Z")), true);
});
