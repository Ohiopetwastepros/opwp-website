import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { handleWinbackInbound, handleWinbackReceipt, queueWinbackOwnerReviews, runWinbackRuntime } from "../lib/winback-runtime.mjs";
import { flushPlaybookOwnerNotices } from "../lib/lead-playbook-notifications.mjs";
import { isFirstLeadMessage } from "../lib/lead-first-contact.mjs";
import { storeMetaLead } from "../lib/meta-lead-workflow.mjs";
import { winbackHash } from "../lib/winback-policy.mjs";
import { recordPlaybookQuoEvent, reconcilePlaybookQuo } from "../lib/lead-playbook-ingest.js";
import { normalizeQuoMessageEvent } from "../lib/quo-webhook.mjs";

const PHONE = "+14192620424";
const NOW = new Date("2026-11-23T23:00:00Z");
const inbound = (text, id = "AC:fixture:inbound:1") => ({direction: "inbound", from: PHONE, to: "+14192622371",
  providerMessageId: id, text, createdAt: NOW.toISOString()});

async function fixture(t, {contacted = true, version = "V2"} = {}) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Real provider calls are forbidden in runtime tests"));
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  db.sqlite.exec(readFileSync(new URL("../schema-proposals/0072_win_back_campaign.sql", import.meta.url), "utf8"));
  db.sqlite.prepare("INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES ('runtime-campaign','org-opwp','Fabricated runtime test','{}','fixture-only-hash')").run();
  db.sqlite.prepare("INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,first_name,version,batch,card_variant,status) VALUES ('runtime-recipient','runtime-campaign',?,?,'Craig Fixture',?,1,'A','queued')")
    .run(await winbackHash(PHONE), PHONE, version);
  if (contacted) {
    db.sqlite.prepare("INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body,provider_message_id,attempted_at) VALUES ('runtime-opening','runtime-recipient','initial','initial','sent','Fabricated opening','ACfixtureopening','2026-11-23T21:00:00Z')").run();
    db.sqlite.prepare("UPDATE winback_recipients SET status='sent',sent_at='2026-11-23T21:00:00Z',attempted_at='2026-11-23T21:00:00Z',provider_message_id='ACfixtureopening' WHERE id='runtime-recipient'").run();
  }
  const env = {DB: db, WINBACK_STORAGE_READY: "true", WINBACK_ENABLED: "false", WINBACK_SEND_ENABLED: "false", WINBACK_KILL_SWITCH: "true"};
  return {db, env};
}

test("winback runtime, inbound, receipts and notices stay inert without the exact installed-storage gate", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Disabled integration must not contact a provider"));
  const db = {prepare() {assert.fail("Disabled integration must not query campaign storage");}};
  for (const ready of [undefined, false, "false", "TRUE", "1"]) {
    const env = {DB: db, WINBACK_STORAGE_READY: ready, WINBACK_ENABLED: "true", WINBACK_SEND_ENABLED: "true", WINBACK_KILL_SWITCH: "false"};
    assert.equal((await runWinbackRuntime(env)).configured, false);
    assert.equal((await handleWinbackInbound(db, env, inbound("STOP"))).handled, false);
    assert.equal((await handleWinbackReceipt(db, env, {type: "message.failed", data: {object: {id: "ACfixture", direction: "outgoing"}}})).handled, false);
    assert.equal((await queueWinbackOwnerReviews(db, env, {queueNotice() {assert.fail("Disabled integration must not queue staff work");}})).queued, 0);
  }
  assert.equal((await runWinbackRuntime({WINBACK_STORAGE_READY: "true"})).configured, false);
});

test("an imported but uncontacted campaign cannot claim an inbound conversation", async t => {
  const f = await fixture(t, {contacted: false});
  const result = await handleWinbackInbound(f.db, f.env, inbound("How much for weekly cleanup?"), {now: NOW});
  assert.equal(result.handled, false);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM winback_replies").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM submissions").get().n, 0);
});

test("a newer active Meta conversation keeps ownership, while STOP still cancels owned campaign work", async t => {
  const f = await fixture(t);
  const meta = await storeMetaLead(f.db, {META_AUTOMATION_ENABLED: "false"}, {id: "runtime-meta", form_id: "runtime-form",
    field_data: [{name: "phone_number", values: [PHONE]}]}, {leadId: "runtime-meta", formId: "runtime-form", pageId: "runtime-page"});
  f.db.sqlite.prepare("UPDATE lead_conversations SET status='open',last_outbound_at='2026-11-23T22:00:00Z' WHERE submission_id=?").run(meta.id);
  const ignored = await handleWinbackInbound(f.db, f.env, inbound("How much for weekly cleanup?"), {now: NOW});
  assert.equal(ignored.handled, false);
  assert.equal(ignored.reason, "newer_meta_conversation");
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM winback_replies").get().n, 0);
  f.db.sqlite.prepare("INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES ('foreign-campaign','org-other','Foreign fixture','{}','fixture-only-hash')").run();
  f.db.sqlite.prepare("INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,version,batch,card_variant,status) VALUES ('foreign-recipient','foreign-campaign',?,?,'V1',1,'B','queued')")
    .run(await winbackHash(PHONE), PHONE);
  const stopped = await handleWinbackInbound(f.db, f.env, inbound("STOP", "AC:fixture:stop:1"), {now: NOW});
  assert.equal(stopped.handled, true);
  assert.equal(stopped.outcome, "opted_out");
  assert.equal(f.db.sqlite.prepare("SELECT status FROM winback_recipients WHERE id='runtime-recipient'").get().status, "opted_out");
  assert.equal(f.db.sqlite.prepare("SELECT status FROM winback_recipients WHERE id='foreign-recipient'").get().status, "queued");
  assert.equal(f.db.sqlite.prepare("SELECT automation_mode FROM lead_conversations WHERE submission_id=?").get(meta.id).automation_mode, "paused");
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM lead_suppressions WHERE organization_id='org-opwp'").get().n, 1);
  assert.equal(f.db.sqlite.prepare("SELECT status,provider_message_id FROM winback_deliveries WHERE id='runtime-opening'").get().provider_message_id, "ACfixtureopening");
});

for (const id of ["AC:fixture:restart:1", "AC:" + ":".repeat(80)]) test(`colon-bearing campaign message ID ${id.length} characters queues its exact owner context`, async t => {
  const f = await fixture(t);
  const env = {...f.env, LEAD_PLAYBOOK_ENABLED: "true", LEAD_PLAYBOOK_NOTIFY_ENABLED: "true", LEAD_PLAYBOOK_CRAIG_CELL: PHONE,
    QUO_API_KEY: "fixture-only-key", QUO_FROM_NUMBER: "+14192622371", OWNER_NOTIFICATION_EMAIL: "fixture-owner@example.test",
    LEAD_PLAYBOOK_ADMIN_ORIGIN: "https://admin.example.test"};
  const text = "Yes, I'd like to start back up.";
  const result = await handleWinbackInbound(f.db, env, inbound(text, id), {now: NOW});
  assert.equal(result.handled, true);
  assert.equal(result.outcome, "restart_interest");
  const recipient = f.db.sqlite.prepare("SELECT submission_id FROM winback_recipients WHERE id='runtime-recipient'").get();
  const conversation = f.db.sqlite.prepare("SELECT id FROM lead_conversations WHERE submission_id=?").get(recipient.submission_id);
  const notices = f.db.sqlite.prepare("SELECT channel,event_key,status FROM lead_playbook_owner_notifications ORDER BY channel").all();
  assert.equal(notices.length, 2);
  const linked = f.db.sqlite.prepare("SELECT id,provider_message_id FROM lead_messages WHERE provider_message_id=? AND conversation_id=?").get(id, conversation.id);
  assert.equal(linked.id, "winback-inbound:" + await winbackHash(id));
  assert.equal(linked.provider_message_id, id, "The original provider identity remains unchanged");
  const expectedKey = "winback:existing_customer:" + encodeURIComponent(linked.id);
  assert.ok(expectedKey.length <= 200);
  assert.ok(notices.every(notice => notice.event_key === expectedKey && notice.status === "queued"));
  assert.equal(f.db.sqlite.prepare("SELECT status FROM winback_owner_notices").get().status, "acknowledged");
  assert.equal((await queueWinbackOwnerReviews(f.db, env)).queued, 0);
  f.db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,created_by,created_at) VALUES ('runtime-later-message',?,'org-opwp','inbound','quo_sms','AC:later','Unrelated later message','fixture','2026-11-23T23:01:00Z')").run(conversation.id);
  const rendered = [];
  const flushed = await flushPlaybookOwnerNotices(f.db, env, {now: NOW,
    fetcher: async (_url, options) => {
      const message = JSON.parse(options.body);
      assert.deepEqual(message.to, [PHONE]);
      rendered.push(message.content);
      return Response.json({data: {id: "ACfixturestaffnotice"}});
    }, emailSender: async (_env, message) => {rendered.push(message.text); return "fixture-email-notice";},
  });
  assert.equal(flushed.acceptedCount, 2);
  for (const body of rendered) {
    assert.match(body, /^\[OPWP STAFF ALERT\]/);
    assert.ok(body.includes(text));
    assert.doesNotMatch(body, /Unrelated later message|Reply STOP to opt out/);
  }
});

test("disabled owner notifications retain campaign reviews for a later enabled queue attempt", async t => {
  const f = await fixture(t);
  await handleWinbackInbound(f.db, f.env, inbound("Yes, I'd like to start back up.", "AC:fixture:held-notice"), {now: NOW});
  assert.equal(f.db.sqlite.prepare("SELECT status FROM winback_owner_notices").get().status, "queued");
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM lead_playbook_owner_notifications").get().n, 0);
});

test("first-contact detection recognizes attempted or sent campaign history across formatted phone numbers", async t => {
  const f = await fixture(t, {contacted: false});
  const current = {submission_id: "runtime-current-lead", phone: "(419) 262-0424"};
  f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES (?,'question','website','new',?,'{}')").run(current.submission_id, PHONE);
  assert.equal(await isFirstLeadMessage(f.db, current), true, "An unattempted import does not count as prior contact");
  for (const assignment of ["attempted_at='2026-11-23T21:00:00Z'", "sent_at='2026-11-23T21:00:00Z'", "provider_message_id='ACfixtureprior'"]) {
    f.db.sqlite.exec("UPDATE winback_recipients SET attempted_at=NULL,sent_at=NULL,provider_message_id=NULL");
    f.db.sqlite.exec("UPDATE winback_recipients SET " + assignment);
    assert.equal(await isFirstLeadMessage(f.db, current), false, assignment);
  }
});

function receiptLead(f) {
  f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES ('runtime-receipt-lead','question','website','new','Craig Fixture',?,'{}')").run(PHONE);
  f.db.sqlite.exec("INSERT INTO lead_conversations(id,submission_id,organization_id,owner,owner_event_at,owner_event_id,owner_event_priority) VALUES ('runtime-receipt-conversation','runtime-receipt-lead','org-opwp','craig','2026-11-23T20:00:00Z','manual:fixture',3)");
  return {...f.env, LEAD_PLAYBOOK_ENABLED: "true", LEAD_PLAYBOOK_HASH_KEY: "fabricated-runtime-learning-key-never-production", QUO_FROM_NUMBER: "+14192622371", QUO_API_KEY: "fixture-only-key", QUO_API_BASE_URL: "https://api.openphone.com"};
}
const campaignMessage = () => ({id: "ACfixtureopening", direction: "outgoing", from: "+14192622371", to: [PHONE],
  text: "Fabricated opening", createdAt: "2026-11-23T21:00:00Z", phoneNumberId: "PNfixture", conversationId: "CNfixture"});
const receiptEvent = message => normalizeQuoMessageEvent({id: "EVfixture", type: "message.delivered", data: {object: message}});
const receiptOwner = db => ({...db.sqlite.prepare("SELECT owner,owner_event_at,owner_event_id,owner_event_priority FROM lead_conversations WHERE id='runtime-receipt-conversation'").get()});

test("accepted initial campaign receipts and repeated history reads preserve the lead owner in every accepted outcome", async t => {
  for (const status of ["sent", "unknown", "failed"]) {
    const f = await fixture(t), env = receiptLead(f), message = campaignMessage();
    f.db.sqlite.prepare("UPDATE winback_deliveries SET status=? WHERE id='runtime-opening'").run(status);
    const owner = receiptOwner(f.db);
    for (let attempt = 0; attempt < 2; attempt++) await recordPlaybookQuoEvent(f.db, env, receiptEvent(message));
    const fetcher = async (input, options) => {
      assert.equal(options.method, "GET");
      const url = new URL(input);
      if (url.pathname === "/v1/phone-numbers") return Response.json({data: [{id: "PNfixture", number: env.QUO_FROM_NUMBER}]});
      if (url.pathname === "/v1/conversations") return Response.json({data: [{id: "CNfixture", phoneNumberId: "PNfixture", participants: [PHONE]}]});
      if (url.pathname === "/v1/messages") return Response.json({data: [message]});
      assert.fail("Unexpected mocked history endpoint");
    };
    for (let attempt = 0; attempt < 2; attempt++) await reconcilePlaybookQuo(env, {now: NOW, fetcher});
    assert.deepEqual(receiptOwner(f.db), owner, status);
    const ledger = f.db.sqlite.prepare("SELECT author,automated FROM lead_messages WHERE provider_message_id='ACfixtureopening'").all();
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].author, "backend");
    assert.equal(ledger[0].automated, 1);
    assert.equal(f.db.sqlite.prepare("SELECT author FROM playbook_turns WHERE provider_message_id='ACfixtureopening'").get().author, "backend");
  }
});

test("campaign receipt evidence rejects foreign ownership, provider/body/phone mismatches and remains query-free when OFF", async t => {
  for (const mismatch of ["foreign", "provider", "body", "phone", "disabled"]) {
    const f = await fixture(t), env = receiptLead(f), message = campaignMessage();
    if (mismatch === "foreign") f.db.sqlite.exec("UPDATE winback_campaigns SET organization_id='org-other'");
    if (mismatch === "provider") message.id = "ACdifferentprovider";
    if (mismatch === "body") message.text = "A different outbound body";
    if (mismatch === "phone") f.db.sqlite.exec("UPDATE winback_recipients SET phone='+14195550199'");
    if (mismatch === "disabled") {
      env.WINBACK_STORAGE_READY = "false";
      const prepare = f.db.prepare;
      f.db.prepare = sql => {assert.doesNotMatch(sql, /winback_deliveries|winback_recipients/); return prepare(sql);};
    }
    await recordPlaybookQuoEvent(f.db, env, receiptEvent(message));
    assert.equal(receiptOwner(f.db).owner, "sona", mismatch);
    assert.equal(f.db.sqlite.prepare("SELECT author FROM playbook_turns WHERE provider_message_id=?").get(message.id).author, "sona", mismatch);
  }
});

test("exact accepted campaign evidence refines an older unknown learning author without undoing a manual handback", async t => {
  const f = await fixture(t), env = receiptLead(f), event = receiptEvent(campaignMessage());
  await recordPlaybookQuoEvent(f.db, {...env, WINBACK_STORAGE_READY: "false"}, event);
  f.db.sqlite.exec("UPDATE lead_conversations SET owner='craig',owner_event_at='2026-11-23T22:00:00Z',owner_event_id='manual:later-handback',owner_event_priority=3 WHERE id='runtime-receipt-conversation'");
  const owner = receiptOwner(f.db);
  await recordPlaybookQuoEvent(f.db, env, {...event, authorType: "sona"});
  assert.deepEqual(receiptOwner(f.db), owner);
  const refined = f.db.sqlite.prepare("SELECT author,automated FROM lead_messages WHERE provider_message_id=?").get(event.providerMessageId);
  assert.equal(refined.author, "backend");
  assert.equal(refined.automated, 1);
  assert.equal(f.db.sqlite.prepare("SELECT author FROM playbook_turns WHERE provider_message_id=?").get(event.providerMessageId).author, "backend");
});
