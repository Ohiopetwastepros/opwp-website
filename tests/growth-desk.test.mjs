import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadAnalytics, leadOrigin, leadSourceBucket, normalizeGrowthSubmissionId, quoteSummary, sourceStage, validateGrowthMutation } from "../lib/growth-desk.mjs";

test("YardOps Pipeline accepts only UUID submission identifiers", () => {
  assert.equal(normalizeGrowthSubmissionId("20000000-0000-1000-a000-000000000009"), "20000000-0000-1000-a000-000000000009");
  assert.equal(normalizeGrowthSubmissionId("../another-record"), "");
  assert.equal(normalizeGrowthSubmissionId("123"), "");
});

test("YardOps Pipeline state updates are bounded and require a complete next action", () => {
  const valid = validateGrowthMutation({
    action: "save_state",
    stage: "quoted",
    priority: "high",
    owner: "me",
    nextAction: "Call about weekly service",
    nextActionAt: "2026-09-01T14:30:00.000Z",
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.stage, "quoted");
  assert.equal(validateGrowthMutation({ ...valid.value, action: "save_state", nextActionAt: "" }).ok, false);
  assert.equal(validateGrowthMutation({ ...valid.value, action: "save_state", stage: "deleted" }).ok, false);
  assert.equal(validateGrowthMutation({ ...valid.value, action: "save_state", owner: "someone@example.com" }).ok, false);
});

test("closed-lost leads require a structured reason and bounded context", () => {
  const base = { action: "save_state", stage: "lost", priority: "normal", owner: "unassigned", nextAction: "", nextActionAt: "" };
  assert.equal(validateGrowthMutation(base).ok, false);
  assert.equal(validateGrowthMutation({ ...base, outcomeReason: "price", outcomeNote: "The customer chose not to move forward at this price." }).ok, true);
  assert.equal(validateGrowthMutation({ ...base, outcomeReason: "made_up" }).ok, false);
  assert.equal(validateGrowthMutation({ ...base, outcomeReason: "other", outcomeNote: "x".repeat(501) }).ok, false);
});

test("not-qualified leads require a no-response or opt-out reason", () => {
  const base = { action: "save_state", stage: "not_qualified", priority: "normal", owner: "unassigned", nextAction: "", nextActionAt: "" };
  assert.equal(validateGrowthMutation(base).ok, false);
  assert.equal(validateGrowthMutation({ ...base, outcomeReason: "no_response" }).ok, true);
  assert.equal(validateGrowthMutation({ ...base, outcomeReason: "opted_out" }).ok, true);
  assert.equal(validateGrowthMutation({ ...base, outcomeReason: "price" }).ok, false);
});

test("YardOps Pipeline notes reject empty and oversized content", () => {
  assert.equal(validateGrowthMutation({ action: "add_note", note: "Customer asked for a Friday callback." }).ok, true);
  assert.equal(validateGrowthMutation({ action: "add_note", note: "   " }).ok, false);
  assert.equal(validateGrowthMutation({ action: "add_note", note: "x".repeat(2001) }).ok, false);
});

test("quote summary exposes only bounded operating context", () => {
  const summary = quoteSummary(JSON.stringify({
    quote_context: { dogs: 2, frequency: "weekly", yard_size: "medium", quote_monthly: "89.50" },
    question: "Can you text before arriving?",
    follow_up_consent: true,
    follow_up_consent_at: "2026-08-28T16:00:00.000Z",
    unrelated_secret: "must not be returned",
  }));
  assert.deepEqual(summary, {
    dogs: "2",
    frequency: "weekly",
    yard: "medium",
    monthly: 89.5,
    question: "Can you text before arriving?",
    consent: true,
    consentAt: "2026-08-28T16:00:00.000Z",
  });
  assert.equal("unrelated_secret" in summary, false);
});

test("provider conversion remains authoritative over an office stage", () => {
  assert.equal(sourceStage({ growth_stage: "lost", lifecycle_stage: "converted" }), "won");
  assert.equal(sourceStage({ growth_stage: "quoted", lifecycle_stage: "details_started" }), "quoted");
  assert.equal(sourceStage({ growth_stage: "invalid" }), "new");
});

test("lead sources map to separate YardOps queues", () => {
  assert.equal(leadSourceBucket({ source: "facebook", kind: "question" }), "meta");
  assert.equal(leadSourceBucket({ source: "quo", kind: "question" }), "quo");
  assert.equal(leadSourceBucket({ source: "website", kind: "partial_quote" }), "website_quotes");
  assert.equal(leadSourceBucket({ source: "website", kind: "question" }), "other");
});

test("lead origin returns bounded provenance without exposing arbitrary payload fields", () => {
  const origin = leadOrigin(JSON.stringify({ meta_lead_id: "lead-123", meta_form_id: "form-9", secret: "ignore" }), { source: "facebook", kind: "question" });
  assert.deepEqual(origin, { bucket: "meta", name: "Meta lead form", externalId: "lead-123", formId: "form-9", pageId: "", channel: "facebook" });
  assert.equal("secret" in origin, false);
});

test("lead analytics reports outcomes, source performance, and quoted monthly value", () => {
  const analytics = buildLeadAnalytics([
    { stage: "won", source: "website", kind: "partial_quote", quote: { monthly: 90 } },
    { stage: "lost", source: "facebook", kind: "question", outcomeReason: "price", quote: { monthly: 110 } },
    { stage: "quoted", source: "quo", kind: "question", quote: { monthly: 75 } },
    { stage: "not_qualified", source: "quo", kind: "question", outcomeReason: "opted_out", quote: { monthly: 120 } },
  ]);
  assert.equal(analytics.total, 4);
  assert.equal(analytics.conversionRate, 50);
  assert.equal(analytics.openQuotedMonthly, 75);
  assert.equal(analytics.wonMonthly, 90);
  assert.equal(analytics.notQualified, 1);
  assert.equal(analytics.sources.find((item) => item.source === "quo").notQualified, 1);
  assert.deepEqual(analytics.lossReasons, [{ reason: "price", label: "Price / budget", count: 1 }]);
  assert.deepEqual(analytics.notQualifiedReasons, [{ reason: "opted_out", label: "Opted out", count: 1 }]);
});
