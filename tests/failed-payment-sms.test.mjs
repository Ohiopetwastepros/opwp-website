import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from 'node:fs';
import { e164, failedPaymentMessage, listFailedPaymentSms, queueFailedPaymentSms, sendFailedPaymentSmsBatch } from "../lib/failed-payment-sms.js";

test("failed-payment message personalizes the approved wording", () => {
  assert.equal(
    failedPaymentMessage("Marvella Example"),
    "Hello, Marvella. This is Craig with Ohio Pet Waste Pros. We submitted our monthly billing, but the card on file failed. Let me know when we can resubmit the billing or if we need to update the card on file. Thank you!",
  );
  assert.equal(failedPaymentMessage(""), "Hello. This is Craig with Ohio Pet Waste Pros. We submitted our monthly billing, but the card on file failed. Let me know when we can resubmit the billing or if we need to update the card on file. Thank you!");
});

test("phone normalization accepts bounded North American and international numbers", () => {
  assert.equal(e164("(419) 555-0100"), "+14195550100");
  assert.equal(e164("+44 20 7946 0958"), "+442079460958");
  assert.equal(e164("123"), "");
});

test("declined-payment messages require approval and are idempotent by invoice", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
      };
    },
  };
  const result = await queueFailedPaymentSms({
    db,
    eventId: "event-1",
    body: { data: { invoice_id: 42, client: 7, client_name: "Marvella Example", cell_phone: "419-555-0100" } },
  });
  assert.equal(result.awaitingApproval, true);
  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.invoiceId, "42");
  assert.match(calls[0].sql, /ON CONFLICT\(invoice_id\) DO NOTHING/);
  assert.equal(calls[0].values[1], "42");
  assert.equal(calls[0].values[5], "+14195550100");
  assert.equal(calls[0].values[6], "awaiting_approval");
});

test("approved bulk sends remain separate personalized Quo messages", async () => {
  const id = "20000000-0000-1000-1000-000000000004";
  const writes = [];
  const db = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.includes("SELECT COUNT(*) count")) return { count: 1 };
          if (sql.includes("failed_payment_sms_usage")) return { send_count: 1 };
          if (sql.includes("RETURNING id,invoice_id")) return { id, invoice_id: "42", client_name: "Marvella Example", recipient: "+14195550100" };
          return null;
        },
        async run() { writes.push({ sql, values: this.values }); return { meta: { changes: 1 } }; },
      };
      return statement;
    },
  };
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ data: { id: "quo-message-1" } });
  };
  try {
    const result = await sendFailedPaymentSmsBatch({
      env: { DB: db, SMS_PROVIDER: "quo", QUO_API_KEY: "test", QUO_FROM_NUMBER: "+14192622371" },
      ids: [id],
      actor: "owner@example.com",
    },async()=>true);
    assert.equal(result.sent, 1);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].to, ["+14195550100"]);
    assert.equal(requests[0].content, failedPaymentMessage("Marvella Example"));
    assert.ok(writes.some((write) => write.sql.includes("status='sent'")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unapproved or malformed selections cannot call Quo", async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return Response.json({}); };
  try {
    const result = await sendFailedPaymentSmsBatch({
      env: { DB: {}, SMS_PROVIDER: "quo", QUO_API_KEY: "test", QUO_FROM_NUMBER: "+14192622371" },
      ids: ["not-a-valid-id"],
      actor: "owner@example.com",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_SELECTION");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("D1 payment evidence removes paid customers from approval and blocks stale bulk selections", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sng_invoices (invoice_id TEXT PRIMARY KEY,total REAL,remaining REAL,invoice_number TEXT,paid TEXT);
    CREATE TABLE route_invoice_history (invoice_id TEXT PRIMARY KEY,invoice_number TEXT,status TEXT,imported_at TEXT);
    CREATE TABLE sng_events (id TEXT PRIMARY KEY,event_type TEXT,status TEXT,received_at TEXT,payload TEXT);
    CREATE TABLE failed_payment_sms (
      id TEXT PRIMARY KEY,invoice_id TEXT,source_event_id TEXT,client_ref TEXT,client_name TEXT,
      recipient TEXT,status TEXT,attempt_count INTEGER DEFAULT 0,sent_at TEXT,failed_at TEXT,
      cancelled_at TEXT,error_message TEXT,created_at TEXT,actioned_by TEXT,
      sending_at TEXT,actioned_at TEXT,updated_at TEXT,provider_message_id TEXT
    );
    CREATE TABLE failed_payment_sms_usage (usage_day TEXT PRIMARY KEY,send_count INTEGER,updated_at TEXT);
  `);
  sqlite.exec(readFileSync(new URL('../tmp/test-migrations/0045_failed_payment_reconciliation.sql',import.meta.url),'utf8'));
  const ids = {
    cassie: "20000000-0000-1000-1000-000000000004",
    paid: "20000000-0000-2000-2000-000000000005",
    laterDecline: "20000000-0000-3000-3000-000000000006",
    ledgerPaid: "20000000-0000-4000-4000-000000000007",
    failedThenPaid: "20000000-0000-5000-5000-000000000008",
  };
  function event(id, type, status, at, client, amount, invoiceId) {
    const data = { client };
    if (type === "client:client_payment_accepted") data.amount = amount;
    else { data.total = amount; data.invoice_id = invoiceId; }
    sqlite.prepare("INSERT INTO sng_events VALUES (?,?,?,?,?)").run(id, type, status, at, JSON.stringify({ data }));
  }
  function candidate(id, invoiceId, eventId, client, name) {
    sqlite.prepare("INSERT INTO failed_payment_sms (id,invoice_id,source_event_id,client_ref,client_name,recipient,status,created_at) VALUES (?,?,?,?,?,?,'awaiting_approval','2026-09-17 10:00:00')")
      .run(id, invoiceId, eventId, client, name, "+14195550100");
  }
  event("cassie-old-paid", "client:client_payment_accepted", "processed", "2026-08-13 19:11:53", "cassie", 127.15);
  event("cassie-decline", "client:client_payment_declined", "archived", "2026-09-04 23:12:42", "cassie", 170, "3743191");
  candidate(ids.cassie, "3743191", "cassie-decline", "cassie", "Cassie Example");
  event("paid-decline", "client:client_payment_declined", "archived", "2026-09-01 20:00:00", "paid", 90, "paid-invoice");
  event("paid-accepted", "client:client_payment_accepted", "processed", "2026-09-02 20:00:00", "paid", 90);
  candidate(ids.paid, "paid-invoice", "paid-decline", "paid", "Paid Customer");
  event("later-first-decline", "client:client_payment_declined", "archived", "2026-09-01 20:00:00", "later", 80, "later-invoice");
  event("later-accepted", "client:client_payment_accepted", "processed", "2026-09-02 20:00:00", "later", 80);
  event("later-second-decline", "client:client_payment_declined", "archived", "2026-09-03 20:00:00", "later", 80, "later-invoice");
  candidate(ids.laterDecline, "later-invoice", "later-first-decline", "later", "Later Customer");
  event("ledger-decline", "client:client_payment_declined", "archived", "2026-09-01 20:00:00", "ledger", 60, "ledger-invoice");
  candidate(ids.ledgerPaid, "ledger-invoice", "ledger-decline", "ledger", "Ledger Customer");
  sqlite.prepare("INSERT INTO sng_invoices VALUES (?,?,?,?,?)").run("ledger-invoice", 60, 0,'invoice-number','60');
  event("failed-then-paid-decline", "client:client_payment_declined", "archived", "2026-09-01 20:00:00", "failed-then-paid", 75, "failed-then-paid-invoice");
  event("failed-then-paid-accepted", "client:client_payment_accepted", "processed", "2026-09-02 20:00:00", "failed-then-paid", 75);
  candidate(ids.failedThenPaid, "failed-then-paid-invoice", "failed-then-paid-decline", "failed-then-paid", "Failed Then Paid");
  sqlite.prepare("UPDATE failed_payment_sms SET status='failed' WHERE id=?").run(ids.failedThenPaid);

  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          return {
            first: async () => statement.get(...values) || null,
            all: async () => ({ results: statement.all(...values) }),
            run: async () => ({ meta: { changes: statement.run(...values).changes } }),
          };
        },
      };
    },
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return Response.json({ data: { id: "quo-message" } }); };
  try {
    const listing = await listFailedPaymentSms(db);
    const status = Object.fromEntries(listing.rows.map((row) => [row.id, row.status]));
    assert.equal(status[ids.cassie], "awaiting_approval");
    assert.equal(status[ids.paid], "payment_recorded");
    assert.equal(status[ids.laterDecline], "awaiting_approval");
    assert.equal(status[ids.ledgerPaid], "payment_recorded");
    assert.equal(status[ids.failedThenPaid], "payment_recorded");
    const result = await sendFailedPaymentSmsBatch({
      env: { DB: db, SMS_PROVIDER: "quo", QUO_API_KEY: "test", QUO_FROM_NUMBER: "+14192622371" },
      ids: [ids.paid, ids.ledgerPaid],
      actor: "owner@example.com",
    },async()=>true);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 2);
    assert.equal(requests, 0);
    const active = await sendFailedPaymentSmsBatch({
      env: { DB: db, SMS_PROVIDER: "quo", QUO_API_KEY: "test", QUO_FROM_NUMBER: "+14192622371" },
      ids: [ids.cassie],
      actor: "owner@example.com",
    },async()=>true);
    assert.equal(active.sent, 1);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
