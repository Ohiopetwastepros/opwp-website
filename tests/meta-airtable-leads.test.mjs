import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { syncMetaAirtableLead } from "../lib/meta-airtable-leads.mjs";
import { storeMetaLead } from "../lib/meta-lead-workflow.mjs";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { createAirtableContactFixture } from "./helpers/airtable-text-safety-fixture.mjs";

const TABLE = "tblxniDSLBZdba6Z7", PHONE = "+14192620424";
const env = {AIRTABLE_API_KEY: "fixture-only-airtable-key"};
const row = (id = "fixture-meta-one") => ({id: "fixture-submission", source: "facebook", status: "new", name: "Craig Fixture",
  phone: PHONE, email: "craig-fixture@example.test", zip: "43551", meta_lead_id: id, form_id: "1725121795904553",
  created_at: "2026-11-23T22:00:00Z", growth_stage: "new", last_inbound_at: null, last_outbound_at: null,
  payload: JSON.stringify({meta_lead_id: id, meta_form_id: "1725121795904553", city: "Perrysburg", number_of_dogs: 2})});

test("a never-replied Meta intake is upserted by Meta Lead ID in its owned table and read back", async () => {
  const f = createAirtableContactFixture(), calls = [];
  const result = await syncMetaAirtableLead(env, row(), {fetcher: (input, options) => {
    calls.push({url: new URL(String(input)), ...options});
    return f.fetcher(input, options);
  }});
  assert.deepEqual(result.differences, []);
  assert.deepEqual(calls.map(call => call.method), ["GET", "PATCH", "GET"]);
  assert.ok(calls.every(call => call.url.pathname.startsWith(`/v0/appcAWPBQB8GmOrcT/${TABLE}`)));
  assert.equal(calls[0].url.searchParams.get("filterByFormula"), "{Meta Lead ID}='fixture-meta-one'");
  const write = JSON.parse(calls[1].body);
  assert.deepEqual(write.performUpsert, {fieldsToMergeOn: ["Meta Lead ID"]});
  assert.equal(write.typecast, false);
  const saved = f.records.get(TABLE)[0];
  assert.equal(saved.id, result.recordId);
  assert.equal(saved.fields["Meta Lead ID"], "fixture-meta-one");
  assert.equal(saved.fields.Phone, PHONE);
  assert.equal(saved.fields.Form, "v2");
  assert.equal(saved.fields["Lead Status"], "New");
  assert.equal(saved.fields["Lead Date"], "2026-11-23");
  assert.equal(Object.hasOwn(saved.fields, "YardOps Lead ID"), false);
  assert.equal(f.records.get("tblhi8MGUOsWNmd37").length, 0);
});

test("different Meta source IDs retain distinct records when the same phone submits again", async () => {
  const f = createAirtableContactFixture();
  const first = await syncMetaAirtableLead(env, row("fixture-meta-one"), {fetcher: f.fetcher});
  const second = await syncMetaAirtableLead(env, row("fixture-meta-two"), {fetcher: f.fetcher});
  const repeated = await syncMetaAirtableLead(env, row("fixture-meta-one"), {fetcher: f.fetcher});
  assert.notEqual(first.recordId, second.recordId);
  assert.equal(repeated.recordId, first.recordId);
  assert.deepEqual(f.records.get(TABLE).map(record => record.fields["Meta Lead ID"]).sort(), ["fixture-meta-one", "fixture-meta-two"]);
});

test("Meta mirroring preserves opt-outs, human notes, nonempty identity and final lead status", async () => {
  for (const status of ["Signed up", "Not interested", "Former client", "Junk"]) {
    const f = createAirtableContactFixture();
    const previous = {"Meta Lead ID": "fixture-meta-one", Name: "Human corrected name", Phone: PHONE, Email: "human-fixture@example.test",
      ZIP: "43537", Town: "Human corrected town", "Lead Date": "2026-10-01", Form: "v1", Source: "Human source note",
      "Lead Status": status, Converted: true, "Do Not Text": true, "Text Status": "Opted out in Quo", Notes: "Human notes must remain intact.", "Last Contact": "2026-11-24"};
    f.records.get(TABLE).push({id: `rec${"h".repeat(14)}`, fields: structuredClone(previous)});
    assert.deepEqual((await syncMetaAirtableLead(env, row(), {fetcher: f.fetcher})).differences, []);
    assert.deepEqual(f.records.get(TABLE)[0].fields, previous, status);
  }
});

test("a Meta readback mismatch remains a durable failed mirror queue item", async t => {
  const output = await build({stdin: {contents: "export {processAirtableQueue} from './lib/lead-assistant.js';", resolveDir: process.cwd()},
    bundle: true, write: false, format: "esm", platform: "node", packages: "external", alias: {"@": process.cwd()},
    plugins: [{name: "offline-meta-mirror-runtime", setup(builder) {
      builder.onResolve({filter: /(?:^|\/)cloudflare(?:\.js)?$/}, () => ({path: "runtime", namespace: "fixture"}));
      builder.onLoad({filter: /.*/, namespace: "fixture"}, () => ({loader: "js", contents: "export const getRuntimeEnv=()=>({}); export const getCloudflareContext=()=>({env:{},ctx:{waitUntil(){}}});"}));
    }}]});
  const api = await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].text).toString("base64"));
  const db = leadTestDatabase(), f = createAirtableContactFixture();
  t.after(() => db.sqlite.close());
  const config = {...env, DB: db, LEAD_PLAYBOOK_ENABLED: "true", META_AUTOMATION_ENABLED: "false"};
  const saved = await storeMetaLead(db, config, {id: "fixture-meta-mismatch", form_id: "1725121795904553", created_time: "2026-11-23T22:00:00Z",
    field_data: [{name: "full_name", values: ["Craig Fixture"]}, {name: "phone_number", values: [PHONE]}]},
  {leadId: "fixture-meta-mismatch", formId: "1725121795904553", pageId: "617929208074485"});
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const response = f.fetcher(input, options);
    assert.ok(response, "Only mocked Airtable requests are allowed");
    if ((options.method || "GET") === "GET" && /\/rec[^/]+$/.test(new URL(String(input)).pathname)) {
      const record = await response.json();
      return Response.json({...record, fields: {...record.fields, Name: "Conflicting readback"}});
    }
    return response;
  };
  try {
    assert.equal((await api.processAirtableQueue(config, 1, saved.id)).failed, 1);
    const queued = db.sqlite.prepare("SELECT status,verification_status,error_message FROM lead_airtable_sync WHERE submission_id=?").get(saved.id);
    assert.equal(queued.status, "failed");
    assert.equal(queued.verification_status, "mismatch");
    assert.equal(queued.error_message, "airtable_readback_mismatch");
  } finally {globalThis.fetch = previousFetch;}
});
