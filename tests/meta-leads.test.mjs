import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { metaLeadIds, normalizeMetaLead, verifyMetaSignature, verifyMetaToken } from "../lib/meta-leads.mjs";

test("verifies Meta SHA-256 webhook signatures", async () => {
  const raw = new TextEncoder().encode('{"object":"page"}');
  const signature = createHmac("sha256", "test-secret").update(raw).digest("hex");
  assert.equal(await verifyMetaSignature(raw, `sha256=${signature}`, "test-secret"), true);
  assert.equal(await verifyMetaSignature(raw, "sha256=bad", "test-secret"), false);
});

test("compares the Meta verification token without a direct secret comparison", async () => {
  assert.equal(await verifyMetaToken("known-token", "known-token"), true);
  assert.equal(await verifyMetaToken("wrong-token", "known-token"), false);
  assert.equal(await verifyMetaToken("", "known-token"), false);
});

test("extracts bounded leadgen events", () => {
  const events = metaLeadIds({ entry: [{ id: "page-1", changes: [{ field: "leadgen", value: { leadgen_id: "lead-1", form_id: "form-1" } }] }] });
  assert.deepEqual(events[0], { leadId: "lead-1", formId: "form-1", pageId: "page-1", createdTime: 0 });
});

test("normalizes Meta fields without trusting custom answers as system fields", () => {
  const lead = normalizeMetaLead({ id: "lead-1", field_data: [
    { name: "full_name", values: ["ExampleLead Example"] },
    { name: "email", values: ["examplelead@example.com"] },
    { name: "phone_number", values: ["419-555-0100"] },
    { name: "number_of_dogs", values: ["2"] },
    { name: "sms_consent", values: ["I agree"] },
  ] }, { formId: "form-1", pageId: "page-1" });
  assert.equal(lead.name, "ExampleLead Example");
  assert.equal(lead.answers.number_of_dogs, "2");
  assert.equal(lead.meta_form_id, "form-1");
  assert.equal(lead.follow_up_consent, true);
  assert.match(lead.question, /number of dogs: 2/);
});

test("normalizes the spaced field names used by OPWP's active Meta lead forms", () => {
  const lead = normalizeMetaLead({ id: "lead-2", field_data: [
    { name: "full name", values: ["Taylor Example"] },
    { name: "phone", values: ["419-555-0101"] },
    { name: "email", values: ["taylor@example.com"] },
    { name: "zip_code", values: ["43615"] },
    { name: "how_many_dogs_do_you_have?", values: ["2 dogs"] },
  ] }, { formId: "form-2", pageId: "page-1" });

  assert.equal(lead.name, "Taylor Example");
  assert.equal(lead.phone, "419-555-0101");
  assert.equal(lead.email, "taylor@example.com");
  assert.equal(lead.zip, "43615");
  assert.equal(lead.answers["how_many_dogs_do_you_have?"], "2 dogs");
});
