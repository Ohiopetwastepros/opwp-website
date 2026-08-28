import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGrowthSubmissionId, quoteSummary, sourceStage, validateGrowthMutation } from "../lib/growth-desk.mjs";

test("YardOps Pipeline accepts only UUID submission identifiers", () => {
  assert.equal(normalizeGrowthSubmissionId("123e4567-e89b-12d3-a456-426614174000"), "123e4567-e89b-12d3-a456-426614174000");
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
