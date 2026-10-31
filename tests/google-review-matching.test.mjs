import assert from "node:assert/strict";
import test from "node:test";
import { matchGoogleReviews, normalizeReviewIdentity, parseReviewAliases } from "../lib/google-review-matching.mjs";

const allen = {
  id: "rec00000000100000",
  fields: {
    "Client Name": "Allen Example",
    "Client Type": "Recurring",
    "Google Review": "Reviewed",
    "Google Review Aliases": "Mitch Example\nM. Example",
  },
};

test("normalizes and deduplicates reviewer aliases", () => {
  assert.equal(normalizeReviewIdentity("  Mitch Éxample "), "mitchexample");
  assert.deepEqual(parseReviewAliases("Mitch Example, Mitch Example\nM. Example"), ["Mitch Example", "M. Example"]);
});

test("matches a Google reviewer alias to the customer account", () => {
  const result = matchGoogleReviews([allen], [{
    reviewId: "google-review-1",
    reviewer: { displayName: "Mitch Example" },
    starRating: "FIVE",
    createTime: "2026-08-01T12:00:00Z",
    updateTime: "2026-08-01T12:00:00Z",
  }]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].record.id, allen.id);
  assert.deepEqual(result.matches[0].fields, { "Follow-up Priority": "Do not contact - reviewed", "Review Name": "Mitch Example", "Review Date": "2026-08-01", "Review Rating": 5 });
});

test("fails closed when an alias belongs to more than one customer", () => {
  const result = matchGoogleReviews([
    allen,
    { id: "rec00000000100001", fields: { "Client Name": "Other Customer", "Client Type": "Recurring", "Google Review Aliases": "Mitch Example" } },
  ], [{ reviewId: "google-review-1", reviewer: { displayName: "Mitch Example" } }]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.ambiguous.length, 1);
});

test("does not modify a manually completed record when no review matches", () => {
  const result = matchGoogleReviews([allen], [{ reviewId: "unmatched", reviewer: { displayName: "Example Stranger" } }]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.unmatched.length, 1);
  assert.equal(allen.fields["Google Review"], "Reviewed");
});
