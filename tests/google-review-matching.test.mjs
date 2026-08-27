import assert from "node:assert/strict";
import test from "node:test";
import { matchGoogleReviews, normalizeReviewIdentity, parseReviewAliases } from "../lib/google-review-matching.mjs";

const allen = {
  id: "recAllenWilliams1",
  fields: {
    "Client Name": "Allen Williams",
    "Client Type": "Recurring",
    "Google Review": "Reviewed",
    "Google Review Aliases": "Mitch Medici\nM. Medici",
  },
};

test("normalizes and deduplicates reviewer aliases", () => {
  assert.equal(normalizeReviewIdentity("  Mitch M\u00e9dici "), "mitchmedici");
  assert.deepEqual(parseReviewAliases("Mitch Medici, Mitch Medici\nM. Medici"), ["Mitch Medici", "M. Medici"]);
});

test("matches a Google reviewer alias to the customer account", () => {
  const result = matchGoogleReviews([allen], [{
    reviewId: "google-review-1",
    reviewer: { displayName: "Mitch Medici" },
    starRating: "FIVE",
    createTime: "2026-08-01T12:00:00Z",
    updateTime: "2026-08-01T12:00:00Z",
  }]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].record.id, allen.id);
  assert.deepEqual(result.matches[0].fields, { "Follow-up Priority": "Do not contact - reviewed", "Review Name": "Mitch Medici", "Review Date": "2026-08-01", "Review Rating": 5 });
});

test("fails closed when an alias belongs to more than one customer", () => {
  const result = matchGoogleReviews([
    allen,
    { id: "recOtherCustomer1", fields: { "Client Name": "Other Customer", "Client Type": "Recurring", "Google Review Aliases": "Mitch Medici" } },
  ], [{ reviewId: "google-review-1", reviewer: { displayName: "Mitch Medici" } }]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.ambiguous.length, 1);
});

test("does not modify a manually completed record when no review matches", () => {
  const result = matchGoogleReviews([allen], [{ reviewId: "unmatched", reviewer: { displayName: "Someone Else" } }]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.unmatched.length, 1);
  assert.equal(allen.fields["Google Review"], "Reviewed");
});
