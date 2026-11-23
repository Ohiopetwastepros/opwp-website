import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assignAirtableContact,
  assignAirtableEmail,
  assignAirtablePhone,
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
