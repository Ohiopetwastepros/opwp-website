import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { classifyQuoLeadIntent, checkQuoCustomerDirectory } from "../lib/quo-lead-intake.mjs";

test("only clear service inquiries and signup requests qualify", () => {
  for (const message of [
    "Can you send me a quote for weekly cleanup?",
    "How much does poop scooping cost for two dogs?",
    "I need pet waste removal for our apartment complex.",
    "I would like to book a one-time cleanup.",
    "Hi Example! What do you need from me to get signed up?",
    "How do I sign up?",
    "Do you offer dog food delivery?",
    "Can you clean the dog poop in my yard?",
  ]) assert.equal(classifyQuoLeadIntent(message).eligible, true, message);
});

test("marketing, support, unrelated projects and vague replies stay in Quo", () => {
  for (const message of [
    "DOPE Marketing: Dave found out. Signs through Sunday. Reply STOP to opt out",
    "We help connect local homeowners with trusted home service providers. Would you like more details?",
    "I need the chicken coop insulated. Can you give me a quote? Can you consider it 1 property with 4 dogs?",
    "Please change my service. How much is weekly cleanup?",
    "Are you coming today?",
    "They will be treating the yard for fleas today",
    "I have your check and can drop it off",
    "Are you hiring? I have experience scooping poop.",
    "Hi", "Thanks", "Yes", "Call me", "Can you send me a price list?", "What are your hours?", "STOP",
    "Can you give me a quote for insulation? My dogs poop a lot.",
  ]) assert.equal(classifyQuoLeadIntent(message).eligible, false, message);
});

test("customer checks cover both active lists and defer on incomplete or failed lookups", async () => {
  const empty = { ok: true, complete: true, rows: [] };
  const phone = "+14195550123";
  const paths = [];
  assert.equal(await checkQuoCustomerDirectory(phone, async (path) => { paths.push(path); return empty; }), false);
  assert.deepEqual(paths, ["/api/v1/clients/active", "/api/v1/clients/active_no_subscription"]);
  assert.equal(await checkQuoCustomerDirectory(phone, async (path) => path.endsWith("active_no_subscription") ? { ...empty, rows: [{ cell_phone_number: "419-555-0123" }] } : empty), true);
  for (const incomplete of [{ ok: false, rows: [] }, { ...empty, complete: false }, { ok: true, complete: true }]) {
    await assert.rejects(checkQuoCustomerDirectory(phone, async () => incomplete), /incomplete/);
  }
});

// Exercise the real webhook intake and pagination functions with isolated I/O.
const stubs = {
  "./airtable": "export const ensureFreshAirtableCockpitSnapshot=async()=>({ok:true});",
  "./cloudflare": "export const getRuntimeEnv=()=>({SNG_API_KEY:'test-only'});",
  "./outbound-request": "export const outboundFetch=(...args)=>globalThis.fetch(...args);",
  "./route-partner": "export const OPWP_ORGANIZATION_ID='org-opwp';",
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (stubs[specifier]) return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  if (specifier === "./sweepandgo") return next("./sweepandgo.js", context);
  return next(specifier, context);
} });
const { sngPaginatedRequest } = await import("../lib/sweepandgo.js");
const { recordInboundQuoMessage } = await import("../lib/lead-assistant.js");
hooks.deregister();

test("customer pagination reads beyond page one and reports truncation or malformed responses", async (t) => {
  const pages = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const page = Number(new URL(url).searchParams.get("page")); pages.push(page);
    return Response.json(page === 1 ? [{ phone: "4195550100" }, { phone: "4195550101" }] : [{ phone: "4195550123" }]);
  });
  const result = await sngPaginatedRequest("/test", { perPage: 2 });
  assert.deepEqual(pages, [1, 2]); assert.equal(result.rows.length, 3); assert.equal(result.complete, true);
  assert.equal((await sngPaginatedRequest("/test", { perPage: 2, maxPages: 1 })).complete, false);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ unexpected: [] }));
  assert.equal((await sngPaginatedRequest("/test")).complete, false);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ data: [], meta: { last_page: 1 } }));
  assert.equal((await sngPaginatedRequest("/test")).complete, true);
});

function fakeDb(existing = null) {
  const writes = [];
  return { writes, prepare(sql) { return { sql, args: [], bind(...args) { this.args = args; return this; },
    async first() {
      if (sql.includes("SELECT s.id,g.stage")) return existing;
      if (sql.includes("FROM lead_conversations WHERE")) return { id: "conversation", automation_mode: "suggest" };
      return null;
    }, async all() { return { results: [] }; }, async run() { writes.push(this); return { meta: { changes: 1 } }; }
  }; }, async batch(statements) { for (const statement of statements) await statement.run(); } };
}
const event = (text) => ({ from: "+14195550123", text, providerMessageId: "message-1", conversationId: "thread-1" });

test("rejected new senders create no lead, sync task or reply; unknown STOP still suppresses", async () => {
  for (const text of ["Hello", "DOPE Marketing: signs on sale", "Can you consider it 1 property with 4 dogs?"]) {
    const db = fakeDb(); const result = await recordInboundQuoMessage(db, {}, event(text));
    assert.equal(result.leadCreated, false); assert.equal(result.autoReplied, false); assert.equal(db.writes.length, 0);
  }
  const db = fakeDb(); await recordInboundQuoMessage(db, {}, event("STOP"));
  assert.equal(db.writes.length, 1); assert.match(db.writes[0].sql, /INSERT INTO lead_suppressions/);
});

test("short replies stay attached to established leads without creating another lead", async () => {
  const db = fakeDb({ id: "established-lead" });
  const result = await recordInboundQuoMessage(db, {}, event("Yes, thanks"));
  assert.equal(result.submissionId, "established-lead"); assert.equal(result.leadCreated, false);
  assert.ok(db.writes.some((s) => s.sql.includes("INSERT OR IGNORE INTO lead_messages")));
  assert.ok(!db.writes.some((s) => s.sql.includes("INSERT INTO submissions")));
});

test("new sales inquiries are admitted only after successful customer verification", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([]));
  const db = fakeDb(); const result = await recordInboundQuoMessage(db, {}, event("How much is weekly cleanup?"));
  assert.equal(result.leadCreated, true); assert.equal(result.autoReplied, false);
  assert.equal(db.writes.filter((s) => s.sql.includes("INSERT INTO submissions")).length, 1);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ error: "unavailable" }, { status: 503 }));
  const retryDb = fakeDb();
  await assert.rejects(recordInboundQuoMessage(retryDb, {}, event("How much is weekly cleanup?")), /incomplete/);
  assert.equal(retryDb.writes.length, 0);
});
