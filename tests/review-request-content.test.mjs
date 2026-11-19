import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  REVIEW_REQUEST_TEMPLATE_VERSION, REVIEW_SITE_ORIGIN, REVIEW_TECHS, REVIEW_URL,
  buildReviewRequestEmail, buildReviewRequestSms, reviewPageMetadata, reviewPageUrl, reviewTechSlug,
} from "../lib/review-request-content.mjs";

test("review SMS preserves the approved wording and uses only the customer's first name", () => {
  assert.equal(buildReviewRequestSms({ firstName: "Alex Example", tech: "Tony B" }),
    "Hey Alex, thanks for choosing Ohio Pet Waste Pros for your cleanup! Here's who took care of your yard today: https://www.ohiopetwastepros.com/review/tony/ If you have a minute, an honest Google review would mean a lot.\n\nThank you!\n\nReply STOP to opt out");
  assert.match(REVIEW_REQUEST_TEMPLATE_VERSION, /v1$/);
  const sms = buildReviewRequestSms({ firstName: "Jo\u2019Anne Example", tech: "Craig Bridgman" });
  assert.match(sms, /^Hey Jo'Anne,/);
  assert.equal(/[^\x20-\x7e\n]/.test(sms), false);
  assert.equal(sms.includes(REVIEW_URL), false);
  assert.match(buildReviewRequestSms(), /^Hey there,/);
});

test("Sweep & Go technician variations map to public page slugs without guessed names", () => {
  for (const [input, slug] of [["Tony B", "tony"], ["Tony", "tony"], ["TONY B.", "tony"], ["Chad", "chad"], ["Chad B", "chad"], ["Craig Bridgman", "craig"], ["craig", "craig"], ["", "team"], ["Unknown Tech", "team"], ["Chadwick", "team"]]) {
    assert.equal(reviewTechSlug(input), slug, input);
    assert.equal(reviewPageUrl(input), `${REVIEW_SITE_ORIGIN}/review/${slug}/`);
  }
});

test("all four tech previews have absolute production image URLs and large image metadata", async () => {
  for (const slug of ["tony", "chad", "craig", "team"]) {
    const meta = reviewPageMetadata(slug);
    assert.equal(meta.twitter.card, "summary_large_image");
    assert.equal(meta.openGraph.images[0].url, `${REVIEW_SITE_ORIGIN}/assets/photos/review-${slug}.jpg`);
    assert.equal(meta.twitter.images[0], meta.openGraph.images[0].url);
    assert.equal(meta.openGraph.images[0].width, 1200);
    assert.equal(meta.openGraph.images[0].height, 630);
    assert.equal(meta.alternates.canonical, `${REVIEW_SITE_ORIGIN}/review/${slug}/`);
    assert.equal(/5.star|incentive|discount/i.test(meta.description), false);
    const image = await sharp(fileURLToPath(new URL(`../public${REVIEW_TECHS[slug].image}`, import.meta.url))).metadata();
    assert.equal(image.width, 1200);
    assert.equal(image.height, 630);
  }
  assert.equal(REVIEW_TECHS.chad.placeholder, true);
  assert.match(REVIEW_TECHS.chad.imageAlt, /placeholder/);
  const page = fs.readFileSync(new URL("../app/review/[tech]/page.js", import.meta.url), "utf8");
  assert.match(page, /Chad's photo coming soon/);
  assert.equal(page.includes("REVIEW_REQUESTS_ENABLED"), false);
});

test("backup email has the tech image, honest-review wording, Google button, owner footer and unsubscribe", () => {
  const unsubscribeUrl = `${REVIEW_SITE_ORIGIN}/api/review-requests/unsubscribe/?token=fixture-token`;
  const email = buildReviewRequestEmail({ firstName: "Alex Example", tech: "Chad", unsubscribeUrl });
  assert.match(email.text, /^Hey Alex,/);
  assert.match(email.text, /an honest Google review would mean a lot/);
  assert.match(email.html, /review-chad\.jpg/);
  assert.match(email.html, /Chad's photo is coming soon/);
  assert.match(email.html, new RegExp(`href="${REVIEW_URL}"`));
  assert.match(email.html, /Leave a review/);
  for (const footer of ["Craig Bridgman- Owner", "(419)-262-2371", "craig@ohiopetwastepros.com", "Ohiopetwastepros.com"]) assert.equal(email.text.includes(footer), true);
  assert.equal(email.html.includes(`${REVIEW_SITE_ORIGIN}/assets/opwp-logo.webp`), true);
  assert.equal(email.html.includes(unsubscribeUrl), true);
  assert.throws(() => buildReviewRequestEmail({ unsubscribeUrl: "https://attacker.example/unsubscribe" }), /secure OPWP/);
});
