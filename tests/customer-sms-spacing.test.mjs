import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { formatCustomerSms } from "../lib/customer-sms.mjs";
import { leadFollowUpDrafts } from "../lib/lead-assistant.mjs";
import { buildMetaConfirmation, formatMetaSms } from "../lib/meta-lead-policy.mjs";
import { META_RESPONSES, metaFollowUpDrafts } from "../lib/meta-conversation.mjs";
import { buildCustomerQuoteFollowUpSms } from "../lib/quote-funnel.mjs";
import { buildReviewRequestSms } from "../lib/review-request-content.mjs";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";

const closing = "\n\nReply STOP to opt out";
function checkSpacing(body, expectedClosing = closing) {
  assert.ok(body.endsWith(expectedClosing), body);
  assert.doesNotMatch(body, /[\u2013\u2014]/);
  assert.equal(body.match(/(?:Reply STOP to opt out|Text STOP to unsubscribe\.)/g).length, 1);
  assert.equal(body.trim().split("\n").at(-1), expectedClosing.trim());
}

test("website, Meta confirmations, cadence, replies and lead nurture keep STOP alone after a blank line", () => {
  checkSpacing(buildCustomerQuoteFollowUpSms(), "\n\nText STOP to unsubscribe.");
  checkSpacing(buildMetaConfirmation({ name: "Alex Example", number_of_dogs: 2, zip: "43537", clean_up_frequency: "Weekly" }));
  const nurture = leadFollowUpDrafts("Alex Example");
  assert.deepEqual(nurture.map(({ step, delay }) => ({ step, delay })), [
    { step: 1, delay: "+1 day" }, { step: 2, delay: "+3 days" }, { step: 3, delay: "+7 days" },
  ]);
  for (const { body } of [...nurture, ...metaFollowUpDrafts("Alex Example")]) checkSpacing(body);
  for (const body of Object.values(META_RESPONSES)) checkSpacing(formatMetaSms(body));
});

test("the shared formatter repairs existing same-line closings and does not duplicate STOP", () => {
  for (const legacy of ["A quote reply.", "A quote reply. Reply STOP to opt out.", "A quote reply.\n\nReply STOP to opt out", "A quote reply. Reply STOP to opt out\nReply STOP to opt out."]) {
    assert.equal(formatCustomerSms(legacy), `A quote reply.${closing}`);
    assert.equal(formatMetaSms(legacy), `A quote reply.${closing}`);
  }
  checkSpacing(formatCustomerSms("Quote\u2014follow-up\u2013details"));
  assert.ok(formatCustomerSms("x".repeat(1100)).length <= 1000);
});

test("review requests retain STOP before the personalized final-link line", () => {
  const previewToken = "00000000-0000-4000-a000-000000000001";
  const reviewUrl = `https://www.ohiopetwastepros.com/review/r/${previewToken}/`;
  for (const template of ["standard", "initial-cleanup"]) {
    const body = buildReviewRequestSms({ firstName: "Alex", tech: "Tony", previewToken, template });
    assert.match(body, /\n\nReply STOP to opt out\n\nhttps:\/\/\S+$/);
    assert.equal(body.trim().split("\n").at(-1), reviewUrl);
    assert.equal(body.match(/Reply STOP to opt out/g).length, 1);
    assert.doesNotMatch(body, /[\u2013\u2014]/);
  }
});

const built = await build({
  stdin: { contents: "export * from './lib/lead-assistant.js';", resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
  alias: { "@": process.cwd() },
  plugins: [{ name: "mock-sms-only", setup(b) {
    b.onResolve({ filter: /^\.\/outbound-request$/ }, () => ({ path: "mock-outbound", namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const outboundFetch=(...args)=>globalThis.__smsSpacingRequest(...args);", loader: "js" }));
    b.onLoad({ filter: /[\\/]lead-assistant\.js$/ }, ({ path }) => ({ contents: `${readFileSync(path, "utf8")}\nexport { processFollowUps };`, loader: "js" }));
  } }],
});
const assistant = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

function seedLead(db) {
  const payload = JSON.stringify({ follow_up_consent: true });
  db.sqlite.prepare("INSERT INTO submissions (id,kind,source,status,name,phone,payload) VALUES ('sms-fixture','partial_quote','website','new','Alex Example','+14195550100',?)").run(payload);
  db.sqlite.exec("INSERT INTO lead_conversations (id,submission_id,organization_id,status,automation_mode) VALUES ('sms-conversation','sms-fixture','org-opwp','open','approved'); UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0,quiet_hours_enabled=0;");
  return { id: "sms-fixture", conversation_id: "sms-conversation", source: "website", name: "Alex Example", phone: "+14195550100", payload, unread_count: 0 };
}

test("lead assistant stores formatted scheduled drafts and normalizes legacy queued bodies with mocked delivery only", async () => {
  const db = leadTestDatabase();
  const lead = seedLead(db);
  const scheduled = await assistant.scheduleLeadFollowUp(db, lead, { dueAt: "2020-01-01T00:00:00Z", message: "A scheduled follow-up." }, "fixture-owner");
  checkSpacing(scheduled.message_body);
  db.sqlite.exec("UPDATE lead_follow_up_jobs SET message_body='A legacy follow-up. Reply STOP to opt out.'");
  const sent = [];
  globalThis.__smsSpacingRequest = async (_url, request) => {
    const content = JSON.parse(request.body).content;
    sent.push(content);
    return Response.json({ data: { id: `mock-sms-${sent.length}` } });
  };
  try {
    const result = await assistant.processFollowUps({ DB: db, QUO_API_KEY: "fixture-key", QUO_FROM_NUMBER: "+14195550101" }, 10);
    assert.equal(result.sent, 1);
    assert.deepEqual(sent, [`A legacy follow-up.${closing}`]);
    assert.equal(db.sqlite.prepare("SELECT message_body FROM lead_follow_up_jobs").get().message_body, sent[0]);
    assert.equal(db.sqlite.prepare("SELECT body FROM lead_messages").get().body, sent[0]);
    const again = await assistant.processFollowUps({ DB: db }, 10);
    assert.equal(again.sent, 0);
    assert.equal(sent.length, 1);
    await assistant.sendLeadMessage(db, { QUO_API_KEY: "fixture-key", QUO_FROM_NUMBER: "+14195550101" }, lead, "An automatic answer. Reply STOP to opt out.", "fixture-automation", true);
    assert.equal(sent[1], `An automatic answer.${closing}`);
    for (const body of sent) checkSpacing(body);
  } finally { delete globalThis.__smsSpacingRequest; }
});

for (const action of ["trash", "pause"]) {
  test(`an automatic answer does not send when ${action} wins during the suppression lookup`, async (t) => {
    const db = leadTestDatabase(); t.after(() => db.sqlite.close());
    const lead = seedLead(db);
    const prepare = db.prepare;
    let changed = false; let calls = 0;
    db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!sql.startsWith("SELECT 1 blocked FROM lead_suppressions")) return statement;
      return { ...statement, bind: (...args) => {
        const bound = statement.bind(...args);
        return { ...bound, first: async () => {
          const result = await bound.first();
          if (action === "trash") db.sqlite.exec("UPDATE submissions SET status='trashed' WHERE id='sms-fixture'");
          db.sqlite.exec("UPDATE lead_conversations SET automation_mode='paused' WHERE id='sms-conversation'");
          changed = true;
          return result;
        } };
      } };
    };
    globalThis.__smsSpacingRequest = async () => { calls++; return Response.json({ data: { id: "must-not-send" } }); };
    try {
      await assert.rejects(() => assistant.sendLeadMessage(db, { QUO_API_KEY: "fixture-key", QUO_FROM_NUMBER: "+14195550101" }, lead,
        "A pending automatic answer.", "fixture-automation", true), /automated reply was cancelled/);
      assert.equal(changed, true);
      assert.equal(calls, 0);
      assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM lead_messages").get().count, 0);
    } finally { delete globalThis.__smsSpacingRequest; }
  });
}
