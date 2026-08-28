import assert from "node:assert/strict";
import test from "node:test";
import { buildSubmissionNotification, escapeEmailHtml, normalizeFunnelId, normalizeFunnelStage } from "../lib/quote-funnel.mjs";
import { normalizeHowHeard, validSngHowHeardValues } from "../lib/sng-onboarding.mjs";

test("funnel IDs and stages fail closed", () => {
  assert.equal(normalizeFunnelId("short"), "");
  assert.equal(normalizeFunnelId("1234567890abcdef"), "1234567890abcdef");
  assert.equal(normalizeFunnelStage("details_started"), "details_started");
  assert.equal(normalizeFunnelStage("invented"), "quote_viewed");
});

test("website attribution values map to documented Sweep & Go enums", () => {
  const inputs = ["google_search", "google_maps", "facebook", "nextdoor", "friend_referral", "door_hanger", "yard_sign", "other"];
  for (const input of inputs) assert.equal(validSngHowHeardValues.has(normalizeHowHeard(input)), true, input);
  assert.equal(normalizeHowHeard("unexpected"), "other");
});

test("owner notification escapes untrusted lead content", () => {
  const content = buildSubmissionNotification({
    type: "question",
    submissionId: "safe-id",
    body: { name: "<script>alert(1)</script>", email: "person@example.com", question: "A & B" },
  });
  assert.equal(content.html.includes("<script>"), false);
  assert.equal(content.html.includes("&lt;script&gt;"), true);
  assert.equal(content.text.includes("A & B"), true);
  assert.equal(escapeEmailHtml('"<&'), "&quot;&lt;&amp;");
});
