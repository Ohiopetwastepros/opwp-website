import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { createAirtableContactFixture } from "./helpers/airtable-text-safety-fixture.mjs";

const PHONE = "+14192620424";
const FORM = "1725121795904553", PAGE = "617929208074485";
const META_TABLE = "tblxniDSLBZdba6Z7";
const META_SECRET = "fixture-only-meta-signing-key", QUO_SECRET = "fixture-only-quo-signing-key";
const entry = `export {POST as metaPost} from './app/api/webhooks/meta-leads/route.js';
export {POST as quoPost} from './app/api/webhooks/quo-messages/route.js';
export {processAirtableQueue} from './lib/lead-assistant.js';`;
const output = await build({stdin: {contents: entry, resolveDir: process.cwd()}, bundle: true, write: false,
  format: "esm", platform: "node", packages: "external", alias: {"@": process.cwd()},
  plugins: [{name: "local-golive-runtime", setup(builder) {
    builder.onResolve({filter: /(?:^|\/)cloudflare(?:\.js)?$/}, () => ({path: "runtime", namespace: "golive-fixture"}));
    builder.onLoad({filter: /.*/, namespace: "golive-fixture"}, () => ({loader: "js", contents: `
      export function getRuntimeEnv(){return globalThis.__metaGoliveFixture.env;}
      export function getCloudflareContext(){return {env:globalThis.__metaGoliveFixture.env,ctx:{waitUntil(p){globalThis.__metaGoliveFixture.waits.push(p);}}};}` }));
  }}]});
const api = await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].text).toString("base64"));

function signedMeta() {
  const body = JSON.stringify({entry: [{id: PAGE, changes: [{field: "leadgen", value: {leadgen_id: "fixture-v2-lead", form_id: FORM}}]}]});
  return new Request("https://fixture.example.test/api/webhooks/meta-leads/", {method: "POST", body,
    headers: {"x-hub-signature-256": "sha256=" + createHmac("sha256", META_SECRET).update(body).digest("hex")}});
}
function signedInbound(text, index) {
  const body = JSON.stringify({id: `fixture-event-${index}`, type: "message.received", data: {object: {
    id: `fixture-inbound-${index}`, direction: "incoming", text, from: PHONE, to: ["+14192622371"], createdAt: new Date().toISOString(),
  }}});
  const timestamp = Date.now();
  return new Request("https://fixture.example.test/api/webhooks/quo-messages/", {method: "POST", body,
    headers: {"openphone-signature": `hmac;1;${timestamp};${createHmac("sha256", QUO_SECRET).update(`${timestamp}.${body}`).digest("base64")}`}});
}

test("offline Meta v2 intake, verified Airtable mirror, natural replies and STOP use Craig's fixture only", async () => {
  const transcript = ["# Local Meta v2 go-live simulation", "", "All provider calls are mocked. No text, email, production write, or Meta test lead was sent.",
    "", `Phone: ${PHONE}. Form: ${FORM}. Page: ${PAGE}.`, "", "The Airtable target is a local fixture configuration; production field compatibility is verified separately.", ""];
  for (const yardAnswer of ["1/8th acre", "standard yard"]) {
    const db = leadTestDatabase(), waits = [], sends = [];
    const airtable = createAirtableContactFixture();
    db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('fixture-test','org-opwp','meta-confirmation-v2-test','fixture-owner','Offline simulation only',datetime('now','-1 minute'),NULL);
      UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0;`);
    const env = {DB: db, META_APP_SECRET: META_SECRET, META_PAGE_ACCESS_TOKEN: "fixture-only-page-token", META_GRAPH_API_VERSION: "v26.0", META_ALLOWED_PAGE_IDS: PAGE,
      META_AUTOMATION_ENABLED: "false", META_TEST_MODE: "true", META_TEST_APPROVAL_ID: "fixture-test", META_TEST_FORM_IDS: FORM,
      META_TEST_RECIPIENTS: PHONE, META_CADENCE_ENABLED: "false", LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: "true",
      LEAD_PLAYBOOK_ENABLED: "true", LEAD_PLAYBOOK_AUTO_SEND_ENABLED: "true", LEAD_PLAYBOOK_NOTIFY_ENABLED: "false",
      LEAD_CLASSIFIER_ENABLED: "false", LEAD_CLASSIFIER_KILL_SWITCH: "true", LEAD_PLAYBOOK_HASH_KEY: "fixture-only-learning-key",
      QUO_WEBHOOK_SIGNING_KEY: Buffer.from(QUO_SECRET).toString("base64"), QUO_API_KEY: "fixture-only-quo-key", QUO_FROM_NUMBER: "+14192622371",
      SNG_API_KEY: "fixture-only-sng-key", AIRTABLE_API_KEY: "fixture-only-airtable-key", AIRTABLE_BASE_ID: "appcAWPBQB8GmOrcT",
      AIRTABLE_META_LEADS_TABLE_ID: META_TABLE,
      META_APPROVED_SMS_FORMS: JSON.stringify({[FORM]: {pageId: PAGE, consentField: "text_message_consent", version: "fb-consent-2026-11-18",
        disclosure: "Can we text you your quote? By choosing Yes, you agree Ohio Pet Waste Pros may send texts, including automated texts, about your quote and service to the number above. Consent isn't required to buy. Msg and data rates may apply. Reply STOP to opt out."}})};
    const previousFetch = globalThis.fetch;
    globalThis.__metaGoliveFixture = {env, waits};
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input)), method = options.method || "GET";
      const mirrored = airtable.fetcher(input, options);
      if (mirrored) return mirrored;
      if (url.origin === "https://graph.facebook.com" && method === "GET" && url.pathname.endsWith("/fixture-v2-lead")) {
        const fields = {full_name: "Craig Bridgman", email: "craig-fixture@example.test", phone_number: PHONE,
          zip_code: "43551", number_of_dogs: "2", service_frequency: "weekly", contact_preference: "text", text_message_consent: "yes"};
        return Response.json({id: "fixture-v2-lead", form_id: FORM, created_time: new Date().toISOString(),
          field_data: Object.entries(fields).map(([name, value]) => ({name, values: [value]}))});
      }
      if (url.origin === "https://openapi.sweepandgo.com" && method === "GET" && ["/api/v1/clients/active", "/api/v1/clients/active_no_subscription"].includes(url.pathname)) {
        return Response.json({data: [], last_page: 1});
      }
      if (url.href === "https://api.openphone.com/v1/messages" && method === "POST") {
        const sms = JSON.parse(options.body);
        assert.deepEqual(sms.to, [PHONE], "The fixture permits only Craig's recipient number");
        sends.push(sms.content);
        return Response.json({data: {id: `fixture-sms-${sends.length}`}});
      }
      assert.fail(`Unmocked ${method} request prohibited in local go-live simulation: ${url.origin}${url.pathname}`);
    };
    try {
      assert.equal((await api.metaPost(signedMeta())).status, 200);
      const lead = db.sqlite.prepare("SELECT * FROM submissions WHERE phone=?").get(PHONE);
      const intake = db.sqlite.prepare("SELECT * FROM meta_lead_intakes WHERE submission_id=?").get(lead.id);
      assert.equal(intake.form_id, FORM);
      assert.equal(JSON.parse(lead.payload).sms_consent_evidence.field, "text_message_consent");
      assert.equal(sends.length, 1);
      assert.equal(db.sqlite.prepare("SELECT status,verification_status FROM lead_airtable_sync WHERE submission_id=?").get(lead.id).verification_status, "matched");
      assert.equal(airtable.writes[0].tableId, META_TABLE, "Facebook intake uses its designated Meta Leads mirror");
      transcript.push(`## Yard answer: ${yardAnswer}`, "", "D1 intake saved. Mock Airtable Meta Leads upsert and readback matched.", "", "Outgoing confirmation:", "", "```text", sends[0], "```", "");
      for (const [index, text] of ["yes", yardAnswer, "how much for 2 dogs weekly?", "STOP"].entries()) {
        const before = sends.length;
        assert.equal((await api.quoPost(signedInbound(text, index))).status, 200);
        await api.processAirtableQueue(env, 10, lead.id);
        const outgoing = sends.slice(before);
        transcript.push(`Inbound: ${JSON.stringify(text)}`, "");
        if (!outgoing.length) transcript.push("Outgoing: none.", "");
        for (const body of outgoing) transcript.push("Outgoing:", "", "```text", body, "```", "");
        if (text === "STOP") assert.deepEqual(outgoing, [], "An opt-out must not receive a later reply");
      }
      assert.ok(db.sqlite.prepare("SELECT 1 FROM lead_suppressions LIMIT 1").get(), "STOP creates durable suppression");
      assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM meta_sms_jobs WHERE status IN ('queued','sending')").get().n, 0);
      const mirror = airtable.records.get(META_TABLE)[0].fields;
      assert.equal(mirror["Do Not Text"], true, "STOP must persist to the designated Airtable contact");
      assert.match(String(mirror["Text Status"]), /opt.?out|do not text|stopped|asked to stop/i);
      assert.match(String(mirror["Text Status Notes"]), /\d{4}-\d{2}-\d{2}.*(?:STOP|opt.?out)/i, "STOP notes include a dated explanation");
      for (const body of sends.slice(1)) assert.doesNotMatch(body, /Reply STOP|Text STOP|[\u2013\u2014]/i);
      transcript.push("STOP persisted in D1; pending Meta jobs: 0. Mock Airtable Do Not Text, Text Status, and dated Text Status Notes were resynchronized.", "");
    } finally {
      await Promise.allSettled(waits);
      globalThis.fetch = previousFetch;
      delete globalThis.__metaGoliveFixture;
      db.sqlite.close();
    }
  }
  if (process.env.OPWP_GOLIVE_TRANSCRIPT) {
    const filename = path.resolve(process.env.OPWP_GOLIVE_TRANSCRIPT);
    assert.ok(filename.startsWith(path.resolve("tmp") + path.sep), "Fixture transcripts belong only in ignored tmp storage");
    await mkdir(path.dirname(filename), {recursive: true});
    await writeFile(filename, transcript.join("\n") + "\n");
    console.log(transcript.join("\n"));
  }
});
