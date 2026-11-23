import assert from "node:assert/strict";
import test from "node:test";
import { storeMetaLead, processMetaConfirmations } from "../lib/meta-lead-workflow.mjs";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { verifiedTextSafety } from "./helpers/airtable-text-safety-fixture.mjs";

test("Meta recovery quarantines interrupted sends after fifteen minutes and never retries receipts or unknown outcomes", async t => {
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('fixture-recovery','org-opwp','meta-confirmation-v2','fixture-owner','Offline recovery test',datetime('now','-1 minute'),NULL);
    UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0;`);
  const env = {DB: db, META_AUTOMATION_ENABLED: "true", META_AUTOMATION_APPROVAL_ID: "fixture-recovery", META_CADENCE_ENABLED: "false",
    LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: "true", META_TEST_RECIPIENTS: "+14192620424", QUO_API_KEY: "fixture-only-key", QUO_FROM_NUMBER: "+14192622371"};
  const rows = {};
  for (const [label, status, minutes, receipt] of [["stale", "sending", 16, null], ["recent", "sending", 10, null], ["sent", "sent", 20, "fixture-sent-receipt"], ["unknown", "unknown", 20, "fixture-uncertain-receipt"]]) {
    const id = "fixture-recovery-" + label;
    const saved = await storeMetaLead(db, env, {id, form_id: "1725121795904553", field_data: [{name: "phone_number", values: ["+14192620424"]}]},
      {leadId: id, formId: "1725121795904553", pageId: "617929208074485"});
    db.sqlite.prepare(`UPDATE meta_sms_jobs SET status=?,attempted_at=datetime('now',?),provider_message_id=?,message_body='Fixture original body' WHERE submission_id=?`)
      .run(status, `-${minutes} minutes`, receipt, saved.id);
    rows[label] = saved.id;
  }
  let providerCalls = 0;
  const options = {textSafety: verifiedTextSafety, loadCustomerDirectory: async () => ({ok: true, complete: true, rows: []}),
    fetcher: async () => {providerCalls++; assert.fail("Quarantined, sending, sent and unknown rows must not contact Quo");}};
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await processMetaConfirmations(env, options)).sent, 0);
  assert.equal(providerCalls, 0);
  const job = label => db.sqlite.prepare("SELECT status,error_message,provider_message_id,message_body FROM meta_sms_jobs WHERE submission_id=?").get(rows[label]);
  assert.equal(job("stale").status, "failed");
  assert.match(job("stale").error_message, /reconcile in Quo.*Automatic retry disabled/);
  assert.equal(job("recent").status, "sending");
  assert.equal(job("sent").status, "sent");
  assert.equal(job("sent").provider_message_id, "fixture-sent-receipt");
  assert.equal(job("unknown").status, "unknown");
  assert.equal(job("unknown").provider_message_id, "fixture-uncertain-receipt");
  for (const label of Object.keys(rows)) assert.equal(job(label).message_body, "Fixture original body");
});
