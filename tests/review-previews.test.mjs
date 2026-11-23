import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sanitizeReviewFirstName, createReviewPreviewToken, validReviewPreviewToken, reviewPreviewObjectKey } from "../lib/review-preview-token.mjs";
import { prepareReviewPreview, getReviewPreview, getReviewPreviewImage } from "../lib/review-previews.mjs";
import { personalizedReviewMetadata, reviewRequestPageUrl, reviewRequestImageUrl, buildReviewRequestEmail, buildReviewRequestSms, REVIEW_SITE_ORIGIN, REVIEW_URL } from "../lib/review-request-content.mjs";

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
    assert.equal(reviewRequestImageUrl(token), `${reviewRequestPageUrl(token)}og.jpg`);
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
  const render = async (_env, options) => { renders.push(options); return { bytes: new Uint8Array([255, 216, 255, 224, 255, 217]), contentType: "image/jpeg" }; };
  return { env, objects, writes, renders, render };
}

test("prepared preview is persisted once, immutable across channels, and readable on a cache miss", async () => {
  const f = fixture(), token = createReviewPreviewToken();
  const preview = await prepareReviewPreview(f.env, { token, firstName: "Jennifer Example", tech: "Tony B" }, f);
  assert.equal(preview.tech, "tony");
  assert.deepEqual(f.renders, [{ firstName: "Jennifer", tech: "tony" }]);
  assert.deepEqual(await prepareReviewPreview(f.env, { token, firstName: "Changed", tech: "craig" }, f), preview);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].options.onlyIf, { etagDoesNotMatch: "*" });
  assert.deepEqual(f.writes[0].options.customMetadata, { reviewPreviewVersion: "2", tech: "tony" });
  assert.equal(f.writes[0].options.httpMetadata.contentType, "image/jpeg");
  assert.deepEqual(await getReviewPreview(f.env, token), preview);
  const image = await getReviewPreviewImage(f.env, token);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.equal(image.headers.get("location"), null);
  assert.equal(image.headers.get("x-robots-tag"), null);
  assert.equal(image.headers.get("referrer-policy"), "no-referrer");
  assert.match(image.headers.get("cache-control"), /immutable/);
  assert.equal((await image.arrayBuffer()).byteLength, 6);
});

test("legacy tokens still resolve and a JPEG replacement preserves the same page and image aliases", async () => {
  const f = fixture(), token = "11111111-2222-4333-8444-555555555555", key = reviewPreviewObjectKey(token);
  f.objects.set(key, {
    body: new Uint8Array([137, 80, 78, 71]),
    customMetadata: { reviewPreviewVersion: "1", tech: "tony" },
    httpMetadata: { contentType: "image/png" },
  });
  const before = await getReviewPreview(f.env, token);
  assert.equal(before.token, token);
  assert.equal(before.imageUrl, `${reviewRequestPageUrl(token)}og.jpg`);
  assert.equal((await getReviewPreviewImage(f.env, token)).headers.get("content-type"), "image/png");
  const jpeg = (await f.render(f.env, { firstName: "Jennifer", tech: "tony" })).bytes;
  f.objects.set(key, { body: jpeg, customMetadata: { reviewPreviewVersion: "2", tech: "tony" }, httpMetadata: { contentType: "image/jpeg" } });
  assert.deepEqual(await getReviewPreview(f.env, token), before);
  const response = await getReviewPreviewImage(f.env, token);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("location"), null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
});

test("invalid and oversized rendered images cannot be published as JPEG previews", async () => {
  const cases = [
    { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" },
    { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/jpeg" },
    { bytes: new Uint8Array(), contentType: "image/jpeg" },
    { bytes: new Uint8Array(1_000_001).fill(255), contentType: "image/jpeg" },
  ];
  cases.at(-1).bytes[1] = 216;
  for (const image of cases) {
    const f = fixture();
    await assert.rejects(() => prepareReviewPreview(f.env, { token: createReviewPreviewToken(), firstName: "Jennifer", tech: "tony" }, { render: async () => image }), /Invalid review preview image/);
    assert.equal(f.writes.length, 0);
  }
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

test("page metadata and email keep the personalized asset while messages use the direct Google review URL", () => {
  const token = createReviewPreviewToken(), image = reviewRequestImageUrl(token), page = reviewRequestPageUrl(token);
  const metadata = personalizedReviewMetadata({ token, tech: "tony" });
  assert.equal(metadata.openGraph.images[0].url, image);
  assert.match(image, /^https:\/\/www\.ohiopetwastepros\.com\/review\/r\/[a-f0-9-]+\/og\.jpg$/);
  assert.equal(metadata.openGraph.images[0].secureUrl, image);
  assert.equal(metadata.openGraph.images[0].type, "image/jpeg");
  assert.equal(metadata.openGraph.images[0].width, 1200);
  assert.equal(metadata.openGraph.images[0].height, 630);
  assert.equal(metadata.twitter.images[0], image);
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.equal(metadata.openGraph.url, page);
  assert.equal(metadata.openGraph.title, "Tony took care of your yard today");
  assert.equal(metadata.robots.index, false);
  assert.equal(metadata.referrer, "no-referrer");
  const sms = buildReviewRequestSms({ firstName: "Jennifer", tech: "tony", previewToken: token });
  assert.doesNotMatch(sms, /Reply STOP to opt out|Text STOP to unsubscribe/i);
  assert.ok(sms.split("\n")[0].includes(`You can leave one here: ${REVIEW_URL}`));
  assert.ok(!sms.includes(page));
  const email = buildReviewRequestEmail({ firstName: "Jennifer", tech: "tony", previewToken: token, unsubscribeUrl: `${REVIEW_SITE_ORIGIN}/review/unsubscribe/?token=fixture` });
  assert.ok(email.text.includes(REVIEW_URL));
  assert.ok(!email.text.includes(page));
  assert.ok(email.html.includes(`href="${REVIEW_URL}"`));
  assert.ok(email.html.includes(`src="${image}"`));
  const pageSource = fs.readFileSync(new URL("../app/review/r/[token]/page.js", import.meta.url), "utf8");
  const imageSources = ["og.jpg", "og.png"].map(name => fs.readFileSync(new URL(`../app/review/r/[token]/${name}/route.js`, import.meta.url), "utf8"));
  for (const source of [pageSource, ...imageSources]) {
    assert.match(source, /dynamic = "force-dynamic"/);
    assert.doesNotMatch(source, /dynamicParams\s*=\s*false|generateStaticParams|REVIEW_REQUESTS_ENABLED/);
  }
  for (const source of imageSources) {
    assert.match(source, /return getReviewPreviewImage\(getRuntimeEnv\(\), token\)/);
    assert.doesNotMatch(source, /redirect|Location|30[1278]/);
  }
  assert.match(pageSource, /src=\{preview.imageUrl\}/);
  assert.match(pageSource, /href=\{REVIEW_URL\}/);
});
