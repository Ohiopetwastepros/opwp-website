import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sanitizeReviewFirstName, createReviewPreviewToken, validReviewPreviewToken, reviewPreviewObjectKey } from "../lib/review-preview-token.mjs";
import { prepareReviewPreview, getReviewPreview, getReviewPreviewImage } from "../lib/review-previews.mjs";
import { personalizedReviewMetadata, reviewRequestPageUrl, reviewRequestImageUrl, buildReviewRequestEmail, buildReviewRequestSms, REVIEW_SITE_ORIGIN } from "../lib/review-request-content.mjs";

test("preview first names allow only letters, hyphens and apostrophes with a bounded first name", () => {
  for (const [input, expected] of [["Jennifer Example", "Jennifer"], [" Jo\u2019Anne Doe ", "Jo'Anne"], ["Anne-Marie Example", "Anne-Marie"], ["Jos\u00e9 Smith", "Jose"], ["<b>Jennifer!</b> Example", "Jennifer"], ["123<>@", ""], ["---''", ""], [null, ""]]) assert.equal(sanitizeReviewFirstName(input), expected);
  assert.equal(sanitizeReviewFirstName("W".repeat(5000)).length, 40);
  assert.doesNotMatch(sanitizeReviewFirstName('<img src=x onerror=alert(1)>Jennifer'), /[<>0-9=]/);
});

test("preview tokens and URLs contain independent random request identity without customer data", () => {
  const tokens = new Set(Array.from({ length: 100 }, createReviewPreviewToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) {
    assert.ok(validReviewPreviewToken(token));
    assert.equal(reviewRequestPageUrl(token), `${REVIEW_SITE_ORIGIN}/review/r/${token}/`);
    assert.equal(reviewRequestImageUrl(token), `${reviewRequestPageUrl(token)}og.png`);
    assert.equal(reviewPreviewObjectKey(token), `review-og/${token}.png`);
    assert.doesNotMatch(reviewRequestPageUrl(token), /Jennifer|@|job-/i);
  }
  for (const invalid of ["Jennifer", "job-123", "../secrets", "", "00000000-0000-0000-0000-000000000000", `${createReviewPreviewToken()}?name=Jennifer`]) {
    assert.equal(validReviewPreviewToken(invalid), false);
    assert.throws(() => reviewRequestPageUrl(invalid));
  }
});

function fixture() {
  const objects = new Map(), writes = [], renders = [];
  const env = { FIELD_PROOFS: {
    async head(key) { return objects.get(key) || null; },
    async get(key) { return objects.get(key) || null; },
    async put(key, bytes, options) {
      writes.push({ key, options });
      if (objects.has(key)) return null;
      objects.set(key, { body: bytes, ...options, httpEtag: '"fixture"' });
    },
  } };
  const render = async (_env, options) => { renders.push(options); return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" }; };
  return { env, writes, renders, render };
}

test("prepared preview is persisted once, immutable across channels, and readable on a cache miss", async () => {
  const f = fixture(), token = createReviewPreviewToken();
  const preview = await prepareReviewPreview(f.env, { token, firstName: "Jennifer Example", tech: "Tony B" }, f);
  assert.equal(preview.tech, "tony");
  assert.deepEqual(f.renders, [{ firstName: "Jennifer", tech: "tony" }]);
  assert.deepEqual(await prepareReviewPreview(f.env, { token, firstName: "Changed", tech: "craig" }, f), preview);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].options.onlyIf, { etagDoesNotMatch: "*" });
  assert.deepEqual(f.writes[0].options.customMetadata, { reviewPreviewVersion: "1", tech: "tony" });
  assert.deepEqual(await getReviewPreview(f.env, token), preview);
  const image = await getReviewPreviewImage(f.env, token);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("referrer-policy"), "no-referrer");
  assert.match(image.headers.get("cache-control"), /immutable/);
  assert.equal((await image.arrayBuffer()).byteLength, 4);
});

test("invalid and unpublished tokens cannot enumerate or render arbitrary bucket objects", async () => {
  let read = false;
  const env = { FIELD_PROOFS: { head() { read = true; }, get() { read = true; } } };
  assert.equal(await getReviewPreview(env, "../private-proof"), null);
  assert.equal((await getReviewPreviewImage(env, "../private-proof")).status, 404);
  assert.equal(read, false);
  const f = fixture();
  assert.equal(await getReviewPreview(f.env, createReviewPreviewToken()), null);
  assert.equal((await getReviewPreviewImage(f.env, createReviewPreviewToken())).status, 404);
  assert.equal(f.renders.length, 0);
});

test("empty sanitized name falls back and storage failure prevents sending a broken preview", async () => {
  const f = fixture();
  assert.equal(await prepareReviewPreview(f.env, { token: createReviewPreviewToken(), firstName: "123", tech: "tony" }, f), null);
  assert.equal(f.writes.length, 0); assert.equal(f.renders.length, 0);
  await assert.rejects(() => prepareReviewPreview({}, { token: createReviewPreviewToken(), firstName: "Jennifer", tech: "tony" }, f), /storage unavailable/);
  const preview = await prepareReviewPreview(f.env, { token: createReviewPreviewToken(), firstName: "Jennifer", tech: "unknown" }, f);
  assert.equal(preview.tech, "craig");
});

test("page metadata, page image, email image and SMS use the same personalized asset and opaque URL", () => {
  const token = createReviewPreviewToken(), image = reviewRequestImageUrl(token), page = reviewRequestPageUrl(token);
  const metadata = personalizedReviewMetadata({ token, tech: "tony" });
  assert.equal(metadata.openGraph.images[0].url, image);
  assert.equal(metadata.openGraph.images[0].width, 1200);
  assert.equal(metadata.openGraph.images[0].height, 630);
  assert.equal(metadata.twitter.images[0], image);
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.equal(metadata.openGraph.url, page);
  assert.equal(metadata.robots.index, false);
  assert.equal(metadata.referrer, "no-referrer");
  assert.ok(buildReviewRequestSms({ firstName: "Jennifer", tech: "tony", previewToken: token }).includes(page));
  const email = buildReviewRequestEmail({ firstName: "Jennifer", tech: "tony", previewToken: token, unsubscribeUrl: `${REVIEW_SITE_ORIGIN}/review/unsubscribe/?token=fixture` });
  assert.ok(email.text.includes(page));
  assert.ok(email.html.includes(`src="${image}"`));
  const pageSource = fs.readFileSync(new URL("../app/review/r/[token]/page.js", import.meta.url), "utf8");
  const imageSource = fs.readFileSync(new URL("../app/review/r/[token]/og.png/route.js", import.meta.url), "utf8");
  for (const source of [pageSource, imageSource]) {
    assert.match(source, /dynamic = "force-dynamic"/);
    assert.doesNotMatch(source, /dynamicParams\s*=\s*false|generateStaticParams|REVIEW_REQUESTS_ENABLED/);
  }
  assert.match(pageSource, /src=\{preview.imageUrl\}/);
  assert.match(pageSource, /href=\{REVIEW_URL\}/);
});
