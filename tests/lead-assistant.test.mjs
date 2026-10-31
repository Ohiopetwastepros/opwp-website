import assert from "node:assert/strict";
import test from "node:test";
import { findAnswerMatch, isStopMessage, looksLikeCustomerServiceText, normalizePhone, resolveLeadSyncId, shouldMarkNotQualifiedForNoResponse, sngClientMatchesPhone, validateAnswerEntry, validateAutomationSettings, validateLeadAssistantMutation } from "../lib/lead-assistant.mjs";

test("normalizes supported North American phone numbers", () => {
  assert.equal(normalizePhone("(419) 262-2371"), "+14192622371");
  assert.equal(normalizePhone("+1 419 262 2371"), "+14192622371");
  assert.equal(normalizePhone("123"), "");
});

test("recognizes existing-customer Quo texts and SNG phone matches", () => {
  assert.equal(looksLikeCustomerServiceText("We are moving out of state and need to cancel service next month."), true);
  assert.equal(looksLikeCustomerServiceText("They will be treating the yard for fleas today"), true);
  assert.equal(looksLikeCustomerServiceText("I have your check and can drop it off"), true);
  assert.equal(looksLikeCustomerServiceText("Our home-service leads include free ad setup"), true);
  assert.equal(looksLikeCustomerServiceText("Do you offer monthly billing for weekly cleanup?"), false);
  assert.equal(looksLikeCustomerServiceText("Can you send me a price list?"), false);
  assert.equal(looksLikeCustomerServiceText("Can you send me a quote for weekly cleanup?"), false);
  assert.equal(sngClientMatchesPhone({ cell_phone_number: "(419) 555-0184" }, "+14195550184"), true);
  assert.equal(sngClientMatchesPhone({ contact: { phone: "419-555-0184" } }, "+14195550184"), true);
  assert.equal(sngClientMatchesPhone({ phone: "419-555-0100" }, "+14195550184"), false);
});

test("Airtable sync always resolves the stable submission ID", () => {
  assert.equal(resolveLeadSyncId({ submission_id: "lead-123" }), "lead-123");
  assert.equal(resolveLeadSyncId({ id: "lead-456", submission_id: "lead-123" }), "lead-456");
  assert.throws(() => resolveLeadSyncId({}), /lead ID is missing/i);
});

test("requires bounded lead assistant actions", () => {
  assert.equal(validateLeadAssistantMutation({ action: "send_message", message: "Hello" }).ok, true);
  assert.equal(validateLeadAssistantMutation({ action: "send_message", message: "" }).ok, false);
  assert.equal(validateLeadAssistantMutation({ action: "set_automation", mode: "unknown" }).ok, false);
  assert.equal(validateLeadAssistantMutation({ action: "delete_lead", reason: "Not relevant" }).ok, true);
  assert.equal(validateLeadAssistantMutation({ action: "start_nurture" }).ok, true);
});

test("validates automation and answer-library settings", () => {
  assert.equal(validateAutomationSettings({ quietHoursStart: "20:00", quietHoursEnd: "08:00", maxFollowUpTouches: 3 }).ok, true);
  assert.equal(validateAutomationSettings({ quietHoursStart: "25:00", quietHoursEnd: "08:00", maxFollowUpTouches: 3 }).ok, false);
  assert.equal(validateAnswerEntry({ answerKey: "gate_access", category: "Service", question: "Gate?", answer: "We secure it.", keywords: ["gate"] }).ok, true);
});

test("matches the strongest approved answer and recognizes opt-out commands", () => {
  const match = findAnswerMatch("How much does weekly service cost?", [
    { answer_key: "general", keywords: '["service"]' },
    { answer_key: "pricing", keywords: '["how much","cost"]' },
  ]);
  assert.equal(match.answer_key, "pricing");
  assert.equal(isStopMessage(" STOP "), true);
  assert.equal(isStopMessage("stop by tomorrow"), false);
});

test("no-response qualification waits for the final approved touch and a 48-hour grace period", () => {
  const now = Date.parse("2026-09-08T16:00:00.000Z");
  const base = {
    settings: { assistantEnabled: true, humanReviewRequired: false, maxFollowUpTouches: 3 },
    lead: { stage: "contacted", automationMode: "approved", conversationStatus: "waiting", lastInboundAt: "2026-08-30T12:00:00.000Z", hasPendingFollowUps: false },
    finalFollowUp: { sequenceStep: 3, sentAt: "2026-09-06T15:59:59.000Z" },
    now,
  };
  assert.equal(shouldMarkNotQualifiedForNoResponse(base), true);
  assert.equal(shouldMarkNotQualifiedForNoResponse({ ...base, settings: { ...base.settings, assistantEnabled: false } }), false);
  assert.equal(shouldMarkNotQualifiedForNoResponse({ ...base, settings: { ...base.settings, humanReviewRequired: true } }), false);
  assert.equal(shouldMarkNotQualifiedForNoResponse({ ...base, finalFollowUp: { sequenceStep: 2, sentAt: base.finalFollowUp.sentAt } }), false);
  assert.equal(shouldMarkNotQualifiedForNoResponse({ ...base, finalFollowUp: { sequenceStep: 3, sentAt: "2026-09-07T16:00:00.000Z" } }), false);
  assert.equal(shouldMarkNotQualifiedForNoResponse({ ...base, lead: { ...base.lead, lastInboundAt: "2026-09-07T12:00:00.000Z" } }), false);
  assert.equal(shouldMarkNotQualifiedForNoResponse({ ...base, lead: { ...base.lead, hasPendingFollowUps: true } }), false);
});
