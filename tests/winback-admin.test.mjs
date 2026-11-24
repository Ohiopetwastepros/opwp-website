import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app/api/admin/winback/route.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const request = (body, options = {}) => new Request("https://admin.example.test/api/admin/winback/", {method: "POST",
  headers: {origin: "https://admin.example.test", "content-type": "application/json", "sec-fetch-site": "same-origin", ...options.headers}, body: JSON.stringify(body)});

function fixture(t, {authorized = true, ready = true, flags = false, gate = {allowed: false, reason: "database_disabled"}} = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema-proposals/0072_win_back_campaign.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  sqlite.exec(`INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES
    ('fixture-campaign','org-opwp','Fabricated campaign','{"privateCopy":"must stay server-side"}','fixture-hash'),
    ('other-campaign','org-other','Other organization fixture','{}','fixture-hash');
    INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,first_name,version,batch,card_variant,status) VALUES
    ('fixture-queued','fixture-campaign','hash-q','+14192620424','Private fixture name','V1',1,'A','queued'),
    ('fixture-sent','fixture-campaign','hash-s','+14192620424','Private fixture name','V2',1,'B','sent'),
    ('other-queued','other-campaign','hash-o','+14192620424','Other fixture','V1',1,'A','queued');
    INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body,provider_message_id) VALUES
    ('fixture-draft','fixture-queued','reply','fixture-inbound','draft','Private fixture body',NULL),
    ('fixture-receipt','fixture-sent','initial','initial','sent','Private sent body','fixture-receipt'),
    ('other-draft','other-queued','reply','fixture-other-inbound','draft','Private other body',NULL);`);
  const stmt = (sql, values = []) => ({bind: (...args) => stmt(sql, args), first: async () => sqlite.prepare(sql).get(...values) || null,
    run: async () => ({meta: {changes: Number(sqlite.prepare(sql).run(...values).changes)}}), execute: () => sqlite.prepare(sql).run(...values)});
  const db = {prepare: sql => stmt(sql), batch: async statements => {
    sqlite.exec("BEGIN"); try {const results = statements.map(statement => statement.execute()); sqlite.exec("COMMIT"); return results;}
    catch (error) {sqlite.exec("ROLLBACK"); throw error;}
  }};
  const env = {DB: db, WINBACK_STORAGE_READY: ready ? "true" : "false", WINBACK_ENABLED: flags ? "true" : "false",
    WINBACK_SEND_ENABLED: flags ? "true" : "false", WINBACK_KILL_SWITCH: flags ? "false" : "true"};
  const calls = {env: 0, guard: [], campaigns: 0, batches: [], logs: []};
  let guardResponse;
  const scope = {Response, URL, WINBACK_ORG: "org-opwp", console: {log: value => calls.logs.push(JSON.parse(value))},
    headers: async () => new Headers(), verifyAdminRequest: async () => ({authorized, email: "verified-owner@example.test"}),
    getRuntimeEnv: () => {calls.env++; return env;},
    protectJsonRequest: async (value, options) => {calls.guard.push(options); return guardResponse ? {response: guardResponse} : {body: await value.json()};},
    winbackCampaign: async (_db, id) => {calls.campaigns++; return sqlite.prepare("SELECT * FROM winback_campaigns WHERE id=? AND organization_id='org-opwp'").get(id) || null;},
    winbackRecipients: async (_db, id) => sqlite.prepare("SELECT * FROM winback_recipients WHERE campaign_id=?").all(id),
    winbackSwitches: async () => gate,
    winbackReport: rows => ({variants: {A: {sent: rows.filter(row => row.card_variant === "A" && row.sent_at).length}, B: {sent: rows.filter(row => row.card_variant === "B" && row.sent_at).length}}, recommendation: "Owner approval is required before switching.", switchingApproved: false, cardMode: "text_only"}),
    runWinbackBatch: async (actualEnv, options) => {calls.batches.push({env: actualEnv, options}); return {enabled: true, sent: 0, skipped: 0, failed: 0, held: "quo_optout_authority_unavailable"};},
  };
  const api = vm.runInNewContext(source + "\n({GET,POST});", scope);
  return {api, env, sqlite, calls, rejectGuard(response) {guardResponse = response;}};
}

test("winback admin requires verified backend identity before reading config, storage or mutations", async t => {
  const f = fixture(t, {authorized: false});
  assert.equal((await f.api.GET(new Request("https://admin.example.test/api/admin/winback/?campaignId=fixture-campaign"))).status, 401);
  assert.equal((await f.api.POST(request({action: "kill_all"}))).status, 401);
  assert.equal(f.calls.env, 0);
  assert.equal(f.calls.guard.length, 0);
  assert.equal(f.calls.campaigns, 0);
});

test("winback admin mutations reject absent or cross-site origins before body protection or storage", async t => {
  const f = fixture(t);
  for (const headers of [{origin: "https://other.example.test"}, {origin: ""}, {"sec-fetch-site": "cross-site"}, {"sec-fetch-site": "same-site"}]) {
    assert.equal((await f.api.POST(request({action: "kill_all"}, {headers}))).status, 403);
  }
  assert.equal(f.calls.env, 0);
  assert.equal(f.calls.guard.length, 0);
});

test("winback storage defaults inert and body guards remain bounded and fail closed", async t => {
  const f = fixture(t, {ready: false});
  f.env.DB = {prepare() {assert.fail("Uninstalled campaign storage must not be read");}};
  const view = await f.api.GET(new Request("https://admin.example.test/api/admin/winback/?campaignId=fixture-campaign"));
  assert.equal((await view.json()).held, "storage_not_ready");
  assert.equal((await f.api.POST(request({action: "run_batch", campaignId: "fixture-campaign"}))).status, 409);
  const guard = f.calls.guard[0];
  assert.equal(guard.scope, "admin_winback:verified-owner@example.test");
  assert.equal(guard.maxBytes, 1024);
  assert.equal(guard.failClosed, true);
  assert.equal(guard.turnstile, false);
  f.rejectGuard(Response.json({error: "rate limited"}, {status: 429}));
  assert.equal((await f.api.POST(request({action: "kill_all"}))).status, 429);
  assert.equal(f.calls.batches.length, 0);
});

test("winback admin accepts no arbitrary copy, approvals, identities, providers, imports or file paths", async t => {
  const f = fixture(t);
  for (const body of [{action: "enable", campaignId: "fixture-campaign"}, {action: "import", path: "private.csv"},
    {action: "run_batch", campaignId: "fixture-campaign", approved: true}, {action: "run_batch", campaignId: "fixture-campaign", actor: "client@example.test"},
    {action: "run_batch", campaignId: "fixture-campaign", providers: {}}, {action: "run_batch", campaignId: "../private"},
    {action: "kill_all", campaignId: "fixture-campaign"}]) assert.equal((await f.api.POST(request(body))).status, 400);
  assert.equal(f.calls.env, 0);
  assert.equal(f.calls.batches.length, 0);
});

test("winback reports are aggregate-only and never expose contacts, copy, or message bodies", async t => {
  const f = fixture(t);
  const response = await f.api.GET(new Request("https://admin.example.test/api/admin/winback/?campaignId=fixture-campaign"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  const value = await response.json(), serialized = JSON.stringify(value);
  assert.equal(value.counts.queued, 1);
  assert.equal(value.counts.sent, 1);
  assert.equal(value.eligibilityVerified, false);
  assert.equal(value.switchesAllowAttempt, false);
  assert.doesNotMatch(serialized, /14192620424|Private fixture name|privateCopy|Private sent body|copy_json|source_sha256/);
  assert.equal((await f.api.GET(new Request("https://admin.example.test/api/admin/winback/?campaignId=other-campaign"))).status, 404);
  assert.equal((await f.api.GET(new Request("https://admin.example.test/api/admin/winback/?campaignId=fixture-campaign&raw=true"))).status, 400);
});

test("winback run requires both runtime and stored approval gates and limits each request to one engine attempt", async t => {
  const disabled = fixture(t);
  assert.equal((await disabled.api.POST(request({action: "run_batch", campaignId: "fixture-campaign"}))).status, 409);
  assert.equal(disabled.calls.batches.length, 0);
  const dbDisabled = fixture(t, {flags: true});
  assert.equal((await dbDisabled.api.POST(request({action: "run_batch", campaignId: "fixture-campaign"}))).status, 409);
  assert.equal(dbDisabled.calls.batches.length, 0);
  const permitted = fixture(t, {flags: true, gate: {allowed: true}});
  const response = await permitted.api.POST(request({action: "run_batch", campaignId: "fixture-campaign"}));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.held, "quo_optout_authority_unavailable");
  assert.equal(permitted.calls.batches.length, 1);
  assert.equal(permitted.calls.batches[0].options.campaignId, "fixture-campaign");
  assert.equal(permitted.calls.batches[0].options.limit, 1);
  assert.deepEqual(Object.keys(permitted.calls.batches[0].options).sort(), ["campaignId", "limit"]);
});

test("winback kill and campaign cancellation work while sending is OFF and preserve sent history and other organizations", async t => {
  const f = fixture(t);
  f.sqlite.exec("UPDATE winback_settings SET enabled=1,kill_switch=0; UPDATE winback_campaigns SET enabled=1,kill_switch=0;");
  assert.equal((await f.api.POST(request({action: "kill_all"}))).status, 200);
  assert.equal(f.sqlite.prepare("SELECT kill_switch FROM winback_settings WHERE organization_id='org-opwp'").get().kill_switch, 1);
  assert.equal((await f.api.POST(request({action: "cancel_campaign", campaignId: "fixture-campaign"}))).status, 200);
  assert.equal(f.sqlite.prepare("SELECT status FROM winback_recipients WHERE id='fixture-queued'").get().status, "skipped");
  assert.equal(f.sqlite.prepare("SELECT status FROM winback_deliveries WHERE id='fixture-draft'").get().status, "cancelled");
  assert.equal(f.sqlite.prepare("SELECT status,provider_message_id FROM winback_deliveries WHERE id='fixture-receipt'").get().provider_message_id, "fixture-receipt");
  assert.equal(f.sqlite.prepare("SELECT status FROM winback_recipients WHERE id='fixture-sent'").get().status, "sent");
  assert.equal(f.sqlite.prepare("SELECT status FROM winback_recipients WHERE id='other-queued'").get().status, "queued");
  assert.equal(f.sqlite.prepare("SELECT status FROM winback_deliveries WHERE id='other-draft'").get().status, "draft");
  assert.ok(f.calls.logs.every(log => log.actor === "verified-owner@example.test"));
  assert.equal(f.calls.batches.length, 0);
});
