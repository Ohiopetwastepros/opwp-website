import assert from "node:assert/strict";
import test from "node:test";
import { AIRTABLE_TEXT_SAFETY_TABLES, readAirtableTextSafety, syncAirtableTextStatus } from "../lib/airtable-text-safety.mjs";

const phone = "+14192620424";
const env = { AIRTABLE_API_KEY: "mock-only-key" };
const ids = { phone: `fld${"p".repeat(14)}`, blocked: `fld${"b".repeat(14)}`, status: `fld${"s".repeat(14)}`, notes: `fld${"n".repeat(14)}` };
const statuses = ["OK", "Asked to stop", "Opted out in Quo", "Text failed", "No reply"];
const recordId = (letter) => `rec${letter.repeat(14)}`;
function fixture({ missingMetaNotes = false, records = {}, failTable, paginate = false, badSchema = false, afterPatch } = {}) {
  const tables = AIRTABLE_TEXT_SAFETY_TABLES.map((id, i) => ({ id, fields: [
    { id: ids.phone, name: "Phone", type: badSchema ? "singleLineText" : "phoneNumber" },
    { id: ids.blocked, name: "Do Not Text", type: "checkbox" },
    { id: ids.status, name: "Text Status", type: "singleSelect", options: { choices: statuses.map((name) => ({ name })) } },
    ...(!(missingMetaNotes && i === 1) ? [{ id: ids.notes, name: "Text Status Notes", type: "multilineText" }] : [{ id: `fld${"g".repeat(14)}`, name: "Notes", type: "multilineText" }]),
  ] }));
  const rows = Object.fromEntries(AIRTABLE_TEXT_SAFETY_TABLES.map((id, i) => [id, structuredClone(records[id] || [{ id: recordId(i ? "m" : "c"), fields: { [ids.phone]: i ? "(419) 262-0424" : phone, [ids.status]: "OK", [ids.notes]: "Existing note" } }]) ]));
  const calls = [];
  const fetcher = async (input, options = {}) => {
    const url = new URL(input); const method = options.method || "GET";
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
    assert.equal(url.origin, "https://api.airtable.com");
    assert.equal(options.headers.Authorization, "Bearer mock-only-key");
    if (url.pathname.includes("/meta/bases/")) return Response.json({ tables });
    const [, , base, tableId, id] = url.pathname.split("/");
    assert.equal(base, "appcAWPBQB8GmOrcT");
    if (tableId === failTable) return Response.json({}, { status: 503 });
    if (!id) {
      assert.equal(method, "GET"); assert.match(url.searchParams.get("filterByFormula"), /REGEX_REPLACE\(\{Phone\}/);
      assert.equal(url.searchParams.get("returnFieldsByFieldId"), "true");
      return Response.json({ records: rows[tableId], ...(paginate ? { offset: "repeated-offset" } : {}) });
    }
    const row = rows[tableId].find((r) => r.id === id);
    if (method === "PATCH") {
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ["fields", "typecast"]);
      assert.equal(JSON.parse(options.body).typecast, false);
      Object.assign(row.fields, JSON.parse(options.body).fields); afterPatch?.(row);
    } else assert.equal(method, "GET");
    return Response.json(row);
  };
  return { fetcher, calls, rows };
}

test("send-time Airtable safety reads both owned tables and normalized phone matches", async () => {
  const f = fixture(); const result = await readAirtableTextSafety(env, phone, { fetcher: f.fetcher });
  assert.equal(result.verified, true); assert.equal(result.doNotText, false); assert.equal(result.records.length, 2);
  assert.equal(f.calls.length, 3); assert.ok(f.calls.every((c) => c.method === "GET"));
});

test("Do Not Text and opt-out or failed Text Status each block regardless of the checkbox", async () => {
  for (const fields of [{ [ids.blocked]: true }, ...statuses.filter((s) => !["OK", "No reply"].includes(s)).map((status) => ({ [ids.status]: status }))]) {
    const f = fixture({ records: { [AIRTABLE_TEXT_SAFETY_TABLES[1]]: [{ id: recordId("m"), fields: { [ids.phone]: phone, ...fields } }] } });
    const result = await readAirtableTextSafety(env, phone, { fetcher: f.fetcher });
    assert.equal(result.verified, true); assert.equal(result.doNotText, true); assert.equal(result.reason, "airtable_do_not_text");
  }
});

test("invalid phone, missing auth, schema errors, and a failed table all fail closed", async () => {
  let calls = 0;
  for (const [settings, value] of [[env, "invalid"], [{}, phone], [{ ...env, AIRTABLE_BASE_ID: "appOtherOwner00000" }, phone]]) {
    const result = await readAirtableTextSafety(settings, value, { fetcher: async () => { calls++; } });
    assert.equal(result.verified, false); assert.equal(result.doNotText, true);
  }
  assert.equal(calls, 0);
  for (const options of [{ badSchema: true }, { failTable: AIRTABLE_TEXT_SAFETY_TABLES[1] }]) {
    const f = fixture(options); const result = await readAirtableTextSafety(env, phone, { fetcher: f.fetcher });
    assert.equal(result.verified, false); assert.equal(result.doNotText, true);
  }
});

test("repeated pagination fails closed rather than treating a partial lookup as safe", async () => {
  const f = fixture({ paginate: true }); const result = await readAirtableTextSafety(env, phone, { fetcher: f.fetcher });
  assert.equal(result.verified, false); assert.equal(result.doNotText, true); assert.equal(result.reason, "airtable_pagination_incomplete");
});

test("complete pagination includes an opt-out on the next page", async () => {
  const f = fixture();
  const fetcher = async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith(AIRTABLE_TEXT_SAFETY_TABLES[1])) {
      if (!url.searchParams.has("offset")) return Response.json({ records: [], offset: "second-page" });
      return Response.json({ records: [{ id: recordId("o"), fields: { [ids.phone]: phone, [ids.blocked]: true } }] });
    }
    return f.fetcher(input, options);
  };
  const result = await readAirtableTextSafety(env, phone, { fetcher });
  assert.equal(result.verified, true); assert.equal(result.doNotText, true); assert.equal(result.records.length, 2);
});

test("an invalid clock value also returns a closed safety result", async () => {
  const result = await readAirtableTextSafety(env, phone, { now: "invalid", fetcher: async () => assert.fail("No request with invalid clock") });
  assert.equal(result.verified, false); assert.equal(result.doNotText, true); assert.equal(result.reason, "airtable_safety_date_invalid");
});

test("STOP durably updates existing records first and reports missing Meta Text Status Notes", async () => {
  const f = fixture({ missingMetaNotes: true });
  const result = await syncAirtableTextStatus(env, { phone, doNotText: true, status: "Asked to stop", note: "STOP received", at: "2026-11-23T23:30:00Z", eventId: "mock-stop-event" }, { fetcher: f.fetcher });
  assert.equal(result.verified, false); assert.equal(result.partial, true); assert.deepEqual(result.reasons, ["airtable_text_status_notes_missing"]);
  assert.equal(result.records.length, 2);
  for (const tableId of AIRTABLE_TEXT_SAFETY_TABLES) { assert.equal(f.rows[tableId][0].fields[ids.blocked], true); assert.equal(f.rows[tableId][0].fields[ids.status], "Asked to stop"); }
  assert.equal(f.rows[AIRTABLE_TEXT_SAFETY_TABLES[0]][0].fields[ids.notes], "Existing note\n2026-11-23T23:30:00.000Z STOP received [event:mock-stop-event]");
  const metaPatch = f.calls.find((c) => c.method === "PATCH" && c.url.pathname.includes(AIRTABLE_TEXT_SAFETY_TABLES[1]));
  assert.deepEqual(Object.keys(metaPatch.body.fields).sort(), [ids.blocked, ids.status].sort());
  assert.ok(f.calls.every((c) => c.method !== "POST"));
});

test("status sync appends dated notes, verifies readback, and does not duplicate an event", async () => {
  const f = fixture(); const command = { phone, doNotText: true, status: "Opted out in Quo", note: "Provider opt-out", at: "2026-11-23T23:30:00Z", eventId: "mock-provider-event" };
  const first = await syncAirtableTextStatus(env, command, { fetcher: f.fetcher });
  const again = await syncAirtableTextStatus(env, { ...command, at: "2026-11-24T23:30:00Z" }, { fetcher: f.fetcher });
  assert.equal(first.verified, true); assert.equal(again.verified, true);
  assert.equal(f.rows[AIRTABLE_TEXT_SAFETY_TABLES[0]][0].fields[ids.notes].split("[event:mock-provider-event]").length, 2);
});

test("a later non-opt-out status can never clear an existing opt-out", async () => {
  const f = fixture({ records: { [AIRTABLE_TEXT_SAFETY_TABLES[0]]: [{ id: recordId("c"), fields: { [ids.phone]: phone, [ids.blocked]: true, [ids.status]: "Asked to stop", [ids.notes]: "Prior opt-out" } }] } });
  const result = await syncAirtableTextStatus(env, { phone, doNotText: false, status: "OK", note: "Later outcome", at: "2026-11-23T23:30:00Z" }, { fetcher: f.fetcher });
  assert.equal(result.verified, true); assert.equal(f.rows[AIRTABLE_TEXT_SAFETY_TABLES[0]][0].fields[ids.blocked], true); assert.equal(f.rows[AIRTABLE_TEXT_SAFETY_TABLES[0]][0].fields[ids.status], "Asked to stop");
});

test("no matching existing contact never creates an Airtable record", async () => {
  const f = fixture({ records: Object.fromEntries(AIRTABLE_TEXT_SAFETY_TABLES.map((id) => [id, []])) });
  const result = await syncAirtableTextStatus(env, { phone, doNotText: true, status: "Asked to stop", note: "STOP", at: "2026-11-23T23:30:00Z" }, { fetcher: f.fetcher });
  assert.equal(result.verified, false); assert.equal(result.reason, "airtable_contact_not_found"); assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
});

test("a partial directory read still marks known matching contacts and reports incomplete coverage", async () => {
  const f = fixture({ failTable: AIRTABLE_TEXT_SAFETY_TABLES[1] });
  const result = await syncAirtableTextStatus(env, { phone, doNotText: true, status: "Asked to stop", note: "STOP", at: "2026-11-23T23:30:00Z" }, { fetcher: f.fetcher });
  assert.equal(result.verified, false); assert.equal(result.partial, true); assert.equal(result.records.length, 1);
  assert.equal(f.rows[AIRTABLE_TEXT_SAFETY_TABLES[0]][0].fields[ids.blocked], true);
});

test("mismatched provider phone rows never authorize a send or a status write", async () => {
  const f = fixture({ records: { [AIRTABLE_TEXT_SAFETY_TABLES[1]]: [{ id: recordId("m"), fields: { [ids.phone]: "invalid" } }] } });
  const result = await readAirtableTextSafety(env, phone, { fetcher: f.fetcher });
  assert.equal(result.verified, false); assert.equal(result.doNotText, true); assert.equal(result.reason, "airtable_phone_match_unverified");
});

test("accepted PATCH with inconsistent readback remains unverified", async () => {
  const f = fixture({ afterPatch: (row) => { row.fields[ids.blocked] = false; } });
  const result = await syncAirtableTextStatus(env, { phone, doNotText: true, status: "Asked to stop", note: "STOP", at: "2026-11-23T23:30:00Z" }, { fetcher: f.fetcher });
  assert.equal(result.verified, false); assert.equal(result.partial, true); assert.ok(result.reasons.includes("airtable_write_unverified"));
});

test("full notes never truncate existing history or prevent durable opt-out flags", async () => {
  const existing = "x".repeat(94999);
  const f = fixture({ records: { [AIRTABLE_TEXT_SAFETY_TABLES[0]]: [{ id: recordId("c"), fields: { [ids.phone]: phone, [ids.notes]: existing } }] } });
  const result = await syncAirtableTextStatus(env, { phone, doNotText: true, status: "Asked to stop", note: "STOP", at: "2026-11-23T23:30:00Z" }, { fetcher: f.fetcher });
  assert.equal(result.verified, false); assert.equal(result.partial, true); assert.ok(result.reasons.includes("airtable_text_status_notes_capacity"));
  assert.equal(f.rows[AIRTABLE_TEXT_SAFETY_TABLES[0]][0].fields[ids.blocked], true); assert.equal(f.rows[AIRTABLE_TEXT_SAFETY_TABLES[0]][0].fields[ids.notes], existing);
});
