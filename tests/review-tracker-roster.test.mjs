import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewTrackerRoster, reviewFollowUpPriority } from "../lib/review-tracker-roster.mjs";

test("refreshes operational fields without overwriting manual review completion or aliases", () => {
  const result = buildReviewTrackerRoster({
    customers: [{ fields: { "Client Name": "Allen Example", Status: "Active", Frequency: "Weekly", "SNG Client ID": "123" } }],
    jobs: [{ fields: { "Customer Name": "Allen Example", Status: "Completed", Date: "2026-08-01", "Service Type": "Recurring" } }],
    tracker: [{ id: "rec00000000100000", fields: { "Client Name": "Allen Example", "Client Type": "Recurring", "Google Review": "Reviewed", "Google Review Aliases": "Mitch Example", "Completed Jobs": 0, "Follow-up Priority": "Do not contact - reviewed" } }],
    now: Date.parse("2026-08-01T12:00:00Z"),
  });
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].fields["Completed Jobs"], 1);
  assert.equal(result.updates[0].fields["Google Review"], undefined);
  assert.equal(result.updates[0].fields["Google Review Aliases"], undefined);
  assert.equal(result.updates[0].fields["Follow-up Priority"], undefined);
});

test("creates a safe not-reviewed tracker row for a new customer", () => {
  const result = buildReviewTrackerRoster({
    customers: [{ fields: { "Client Name": "New Customer", Status: "Active", Frequency: "Weekly" } }],
    jobs: [{ fields: { "Customer Name": "New Customer", Status: "Completed", Date: "2026-08-01", "Service Type": "Recurring" } }],
    now: Date.parse("2026-08-01T12:00:00Z"),
  });
  assert.equal(result.creates.length, 1);
  assert.equal(result.creates[0].fields["Google Review"], "Not reviewed");
  assert.equal(result.creates[0].fields["Follow-up Priority"], "Future automation");
});

test("expires a stale one-time review follow-up from the live 30-day window", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  assert.equal(reviewFollowUpPriority({ "Client Type": "One-time", "Google Review": "Not reviewed", "Completed Jobs": 2, "Last Completed Job": "2026-07-03", "Follow-up Priority": "Highlight - recent one-time" }, now), "Do not contact - past one-time");
  assert.equal(reviewFollowUpPriority({ "Client Type": "One-time", "Google Review": "Not reviewed", "Completed Jobs": 1, "Last Completed Job": "2026-09-10" }, now), "Highlight - recent one-time");
});
