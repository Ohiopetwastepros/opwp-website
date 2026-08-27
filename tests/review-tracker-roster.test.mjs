import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewTrackerRoster } from "../lib/review-tracker-roster.mjs";

test("refreshes operational fields without overwriting manual review completion or aliases", () => {
  const result = buildReviewTrackerRoster({
    customers: [{ fields: { "Client Name": "Allen Williams", Status: "Active", Frequency: "Weekly", "SNG Client ID": "123" } }],
    jobs: [{ fields: { "Customer Name": "Allen Williams", Status: "Completed", Date: "2026-08-01", "Service Type": "Recurring" } }],
    tracker: [{ id: "recAllenWilliams1", fields: { "Client Name": "Allen Williams", "Client Type": "Recurring", "Google Review": "Reviewed", "Google Review Aliases": "Mitch Medici", "Completed Jobs": 0, "Follow-up Priority": "Do not contact - reviewed" } }],
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
