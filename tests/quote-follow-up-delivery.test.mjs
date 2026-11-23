import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runPrivateInNewContext } from "./helpers/private-vm.mjs";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { controlledLeadRecipientAllowed } from "../lib/lead-rollout-policy.mjs";

const source = readFileSync(new URL("../lib/quote-follow-up-delivery.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const now = "2026-10-01 12:00:00";

function fixture() {
  const db = leadTestDatabase();
  db.sqlite.function("current_timestamp", () => now);
  const logs = []; const requests = [];
  const run = runPrivateInNewContext(`${source}\nrunScheduledQuoteFollowUps;`, {
    URL,
    controlledLeadRecipientAllowed,
    console: { log: (value) => logs.push(JSON.parse(value)), error: (value) => logs.push(JSON.parse(value)) },
    outboundFetch: async (...args) => { requests.push(args); return Response.json({ data: { id: "provider-example" } }); },
    normalizeFrequency: (value) => value,
    normalizeLastCleaned: (value) => value,
    transactionalEmailConfig: () => ({ configured: true }),
    buildCustomerQuoteFollowUpSms: () => "Example quote follow-up",
    buildCustomerQuoteFollowUpEmail: () => ({ subject: "Example", text: "Example", html: "Example" }),
    sendTransactionalEmail: async (...args) => { requests.push(args); return "email-example"; },
    queueSubmissionNotificationSafe: async () => {},
  });
  const seed = (id, { status = "sending", age = "-16 minutes", attempts = 1, sendingAt = true, parent = id } = {}) => {
    db.sqlite.prepare(`INSERT OR IGNORE INTO submissions(id,kind,status,email,phone,zip,payload)
      VALUES (?,'partial_quote','follow_up_pending','example@example.test','4195550100','43604','{}')`).run(parent);
    db.sqlite.prepare(`INSERT OR IGNORE INTO quote_follow_ups
      (id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at)
      VALUES (?,?,?,'Example consent','example-v1',CURRENT_TIMESTAMP,datetime(CURRENT_TIMESTAMP,'-20 minutes'))`)
      .run(parent, parent, "+14195550100");
    db.sqlite.prepare(`INSERT INTO quote_follow_up_deliveries
      (id,follow_up_id,submission_id,channel,status,attempt_count,sending_at,updated_at,provider_message_id)
      VALUES (?,?,?,'customer_sms',?,?,CASE WHEN ? THEN datetime(CURRENT_TIMESTAMP,?) END,datetime(CURRENT_TIMESTAMP,?),?)`)
      .run(id, parent, parent, status, attempts, Number(sendingAt), age, age, status === "queued" ? null : "existing-provider-evidence");
  };
  const row = (id) => db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries WHERE id=?").get(id);
  const parent = (id) => db.sqlite.prepare("SELECT * FROM quote_follow_ups WHERE id=?").get(id);
  const env = { DB: db, SMS_PROVIDER: "quo", QUO_API_KEY: "fixture-key", QUO_FROM_NUMBER: "+14195550199" };
  return { db, logs, requests, run, seed, row, parent, env };
}

test("interrupted deliveries older than 15 minutes become terminal failures without resending", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("stale");
  const before = f.row("stale");
  const result = await f.run(f.env);
  const row = f.row("stale");
  assert.equal(row.status, "failed");
  assert.equal(row.failed_at, now);
  assert.equal(row.updated_at, now);
  assert.match(row.error_message, /Verify provider before any retry/);
  assert.equal(row.attempt_count, 5);
  assert.ok(row.next_attempt_at > now);
  assert.equal(row.sending_at, before.sending_at);
  assert.equal(row.provider_message_id, before.provider_message_id);
  assert.equal(f.parent("stale").status, "failed");
  assert.equal(result.recovered, 1);
  assert.equal(result.attempted, 0);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.logs, [{ event: "quote_follow_up_run", configured: true, attempted: 0, sent: 0, failed: 0, pending: 0, recovered: 1 }]);
  assert.equal((await f.run(f.env)).recovered, 0);
  assert.equal(f.requests.length, 0);
});

test("recovery respects the strict 15-minute cutoff and leaves terminal delivery states unchanged", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("fresh", { age: "-14 minutes" });
  f.seed("boundary", { age: "-15 minutes" });
  f.seed("expired", { age: "-901 seconds" });
  f.seed("cancelled", { status: "cancelled", age: "-30 days" });
  f.seed("sent", { status: "sent", age: "-30 days" });
  f.seed("failed", { status: "failed", attempts: 5, age: "-30 days" });
  const unchanged = ["fresh", "boundary", "cancelled", "sent", "failed"].map((id) => f.row(id));
  assert.equal((await f.run(f.env)).recovered, 1);
  assert.equal(f.row("expired").status, "failed");
  assert.deepEqual(["fresh", "boundary", "cancelled", "sent", "failed"].map((id) => f.row(id)), unchanged);
  assert.equal(f.requests.length, 0);
});

test("legacy sends without sending_at recover by updated_at and exhausted attempts never reset", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("legacy", { sendingAt: false, attempts: 7 });
  assert.equal((await f.run(f.env)).recovered, 1);
  assert.equal(f.row("legacy").status, "failed");
  assert.equal(f.row("legacy").attempt_count, 7);
  assert.equal(f.row("legacy").sending_at, null);
  assert.equal(f.parent("legacy").status, "failed");
  assert.equal(f.requests.length, 0);
});

test("normal queued work still sends once and scheduler logs counts without customer details", async (t) => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  f.seed("queued", { status: "queued", sendingAt: false, attempts: 0 });
  const result = await f.run(f.env);
  assert.equal(result.attempted, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.recovered, 0);
  assert.equal(f.row("queued").status, "sent");
  assert.equal(f.row("queued").attempt_count, 1);
  assert.equal(f.parent("queued").status, "sent");
  assert.equal(f.requests.length, 1);
  assert.equal((await f.run(f.env)).attempted, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.stringify(f.logs).includes("419555"), false);
  assert.equal(JSON.stringify(f.logs).includes("example@example.test"), false);
});
