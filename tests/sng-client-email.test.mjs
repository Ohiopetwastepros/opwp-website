import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assignAirtableContact,
  assignAirtableEmail,
  assignAirtablePhone,
  indexSngClients,
  parseContactBackfillArgs,
  planCustomerContactBackfill,
  readSngClientEmail,
  readSngClientPhone,
  sngClientEmail,
  sngClientPhone,
} from "../lib/sng-client-email.mjs";

test("Sweep & Go email is read from the client list field and subscription alias", () => {
  assert.equal(sngClientEmail({ email: " Ada@Example.com " }), "Ada@Example.com");
  assert.equal(sngClientEmail({ email: "", client_email: "ada@example.com" }), "ada@example.com");
  assert.equal(sngClientEmail({ email: null, client: { email: "nested@example.com" } }), "nested@example.com");
  assert.deepEqual(readSngClientEmail({ email: "   " }), { email: "", reason: "blank" });
  assert.deepEqual(readSngClientEmail({ email: "not-an-email" }), { email: "", reason: "invalid" });
  assert.equal(sngClientEmail({ email: "not-an-email", client_email: "fallback@example.com" }), "fallback@example.com");
});

test("Sweep & Go phone prefers the cell number and ignores blank or short values", () => {
  assert.equal(sngClientPhone({ cell_phone: "2025550101", home_phone: "4155550110" }), "2025550101");
  assert.equal(sngClientPhone({ cell_phone: "", home_phone: "(419) 555-0199" }), "(419) 555-0199");
  assert.equal(sngClientPhone({ cell_phone_number: 4195550100 }), "4195550100");
  assert.deepEqual(readSngClientPhone({}), { phone: "", reason: "blank" });
  assert.deepEqual(readSngClientPhone({ cell_phone: "555" }), { phone: "", reason: "invalid" });
});

test("Airtable Phone and Email are assigned only for a different usable value", () => {
  const created = {};
  assert.equal(assignAirtableContact(created, {}, { email: "new@example.com", cell_phone: "4195550100" }), true);
  assert.equal(created.Email, "new@example.com");
  assert.equal(created.Phone, "4195550100");

  const same = {};
  assert.equal(assignAirtableEmail(same, "New@Example.com", { email: "new@example.com" }), false);
  assert.equal(assignAirtablePhone(same, "(419) 555-0100", { cell_phone: "4195550100" }), false);
  assert.equal("Email" in same, false);
  assert.equal("Phone" in same, false);

  const kept = { Phone: "4195550100", Email: "keep@example.com" };
  assert.equal(assignAirtableContact(kept, kept, { email: "  ", cell_phone: null, home_phone: "" }), false);
  assert.equal(kept.Phone, "4195550100");
  assert.equal(kept.Email, "keep@example.com");
});

test("active-client backfill fills blank Phone and Email and leaves stored values alone", () => {
  const clients = indexSngClients([
    { client: "rcl_both", email: "both@example.com", cell_phone: "4195550101" },
    { client: "rcl_phone_only", email: "new@example.com", cell_phone: "4195550102", home_phone: "4195550199" },
    { client: "rcl_keep", email: "changed@example.com", cell_phone: "4195550103" },
    { client: "rcl_empty", email: "", cell_phone: "" },
    { client: "rcl_bad", email: "nope", cell_phone: "12" },
  ]);
  const records = [
    { id: "recBoth", fields: { "Client Name": "Both Example", "SNG Client ID": "rcl_both" } },
    { id: "recPhone", fields: { "Client Name": "Phone Example", "SNG Client ID": "rcl_phone_only", Email: "keep@example.com" } },
    { id: "recKeep", fields: { "Client Name": "Keep Example", "SNG Client ID": "rcl_keep", Phone: "4195550000", Email: "keep@example.com" } },
    { id: "recEmpty", fields: { "Client Name": "Empty Example", "SNG Client ID": "rcl_empty" } },
    { id: "recBad", fields: { "Client Name": "Bad Example", "SNG Client ID": "rcl_bad" } },
    { id: "recInactive", fields: { "Client Name": "Inactive Example", "SNG Client ID": "rcl_inactive", Status: "Active" } },
    { id: "recNoId", fields: { "Client Name": "No ID Example" } },
  ];
  const plan = planCustomerContactBackfill(records, clients);
  assert.deepEqual(plan.updates, [
    {
      id: "recBoth",
      fields: { Phone: "4195550101", Email: "both@example.com" },
      clientName: "Both Example",
      sngClientId: "rcl_both",
    },
    {
      id: "recPhone",
      fields: { Phone: "4195550102" },
      clientName: "Phone Example",
      sngClientId: "rcl_phone_only",
    },
  ]);
  assert.equal(plan.updates.every((update) => Object.keys(update.fields).every((field) => field === "Phone" || field === "Email")), true);
  assert.deepEqual(plan.summary, {
    scanned: 7,
    noSngId: 1,
    notActive: 1,
    alreadySet: 1,
    blankPhone: 1,
    invalidPhone: 1,
    blankEmail: 1,
    invalidEmail: 1,
    wouldUpdate: 2,
  });
  assert.deepEqual(plan.unmatchedIds, ["rcl_inactive"]);
});

test("webhook customer create and update both copy Phone and Email before writing", () => {
  const source = readFileSync(new URL("../lib/airtable.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function updateSngCustomerLifecycle");
  const end = source.indexOf("async function airtableCustomerMrr");
  const fn = source.slice(start, end);
  const assignment = fn.indexOf("assignAirtableContact(fields, current, data)");
  const create = fn.indexOf("if (!records.length && createIfMissing)");
  assert.ok(assignment > 0);
  assert.ok(create > assignment);
});

test("contact backfill defaults to dry-run and writes only with --apply", () => {
  assert.deepEqual(parseContactBackfillArgs([]), { apply: false, dryRun: true });
  assert.deepEqual(parseContactBackfillArgs(["--dry-run"]), { apply: false, dryRun: true });
  assert.deepEqual(parseContactBackfillArgs(["--apply"]), { apply: true, dryRun: false });
  assert.throws(() => parseContactBackfillArgs(["--apply", "--dry-run"]), /either --dry-run or --apply/);
  assert.throws(() => parseContactBackfillArgs(["--force"]), /Unknown argument/);
});
