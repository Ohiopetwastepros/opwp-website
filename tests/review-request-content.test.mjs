import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
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
  for (const [input, slug] of [["Tony B", "tony"], ["Tony", "tony"], ["TONY B.", "tony"], ["Chad", "craig"], ["Chad B", "craig"], ["Craig Bridgman", "craig"], ["craig", "craig"], ["", "craig"], ["Unknown Tech", "craig"], ["Chadwick", "craig"], ["team", "craig"]]) {
    assert.equal(reviewTechSlug(input), slug, input);
    assert.equal(reviewPageUrl(input), `${REVIEW_SITE_ORIGIN}/review/${slug}/`);
    assert.match(buildReviewRequestSms({ firstName: "Alex", tech: input }), new RegExp(`/review/${slug}/`));
  }
});

test("only Tony and Craig have optimized portraits and separate absolute large social previews", async () => {
  assert.deepEqual(Object.keys(REVIEW_TECHS), ["tony", "craig"]);
  for (const slug of ["tony", "craig"]) {
    const tech = REVIEW_TECHS[slug];
    const meta = reviewPageMetadata(slug);
    assert.equal(meta.twitter.card, "summary_large_image");
    assert.equal(meta.openGraph.images[0].url, `${REVIEW_SITE_ORIGIN}/assets/photos/review-${slug}-og.jpg`);
    assert.equal(meta.twitter.images[0], meta.openGraph.images[0].url);
    assert.equal(meta.openGraph.title, `${tech.name} took care of your yard today`);
    assert.equal(meta.twitter.title, meta.openGraph.title);
    assert.equal(meta.openGraph.images[0].width, 1200);
    assert.equal(meta.openGraph.images[0].height, 630);
    assert.equal(meta.alternates.canonical, `${REVIEW_SITE_ORIGIN}/review/${slug}/`);
    assert.equal(/5.star|incentive|discount/i.test(meta.description), false);
    for (const [path, format, width, height] of [[tech.image, "webp", tech.imageWidth, tech.imageHeight], [tech.imageFallback, "jpeg", tech.imageWidth, tech.imageHeight], [tech.ogImage, "jpeg", 1200, 630]]) {
      const imagePath = fileURLToPath(new URL(`../public${path}`, import.meta.url));
      const image = await sharp(imagePath).metadata();
      assert.equal(image.format, format);
      assert.equal(image.width, width);
      assert.equal(image.height, height);
      assert.ok(fs.statSync(imagePath).size < 400_000, `${path} stays web sized`);
    }
    assert.notEqual(tech.image, tech.ogImage);
  }
  for (const unknown of ["Chad", "unknown", "", "team"]) {
    assert.deepEqual(reviewPageMetadata(unknown), reviewPageMetadata("craig"));
  }
  for (const unused of ["chad", "team"]) assert.equal(fs.existsSync(new URL(`../public/assets/photos/review-${unused}.jpg`, import.meta.url)), false);
});

test("public routes expose only configured technicians and a legacy team redirect without placeholder copy", async () => {
  const page = fs.readFileSync(new URL("../app/review/[tech]/page.js", import.meta.url), "utf8");
  const functions = vm.runInNewContext(`${page.split("export default")[0].replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")}\n({generateStaticParams,generateMetadata})`, { REVIEW_TECHS, reviewPageMetadata });
  assert.deepEqual(Array.from(functions.generateStaticParams(), row => row.tech), ["tony", "craig", "team"]);
  assert.deepEqual(await functions.generateMetadata({ params: Promise.resolve({ tech: "team" }) }), reviewPageMetadata("craig"));
  assert.deepEqual(Object.keys(await functions.generateMetadata({ params: Promise.resolve({ tech: "chad" }) })), []);
  assert.match(page, /dynamicParams = false/);
  assert.match(page, /if \(slug === "team"\) permanentRedirect\("\/review\/craig\/"\)/);
  assert.match(page, /if \(!Object.hasOwn\(REVIEW_TECHS, slug\)\) notFound\(\)/);
  assert.match(page, /<source srcSet=\{tech.image\} type="image\/webp"/);
  assert.match(page, /<img src=\{tech.imageFallback\}/);
  assert.doesNotMatch(page, /Chad|placeholder/);
  const admin = fs.readFileSync(new URL("../app/admin/review-requests/ReviewRequestsClient.js", import.meta.url), "utf8");
  assert.doesNotMatch(admin, /Chad|photo is missing|team-photo placeholder/);
  assert.equal(page.includes("REVIEW_REQUESTS_ENABLED"), false);
});

test("backup email has the tech image, honest-review wording, Google button, owner footer and unsubscribe", () => {
  const unsubscribeUrl = `${REVIEW_SITE_ORIGIN}/api/review-requests/unsubscribe/?token=fixture-token`;
  const email = buildReviewRequestEmail({ firstName: "Alex Example", tech: "Chad", unsubscribeUrl });
  assert.match(email.text, /^Hey Alex,/);
  assert.match(email.text, /an honest Google review would mean a lot/);
  assert.match(email.text, /\/review\/craig\//);
  assert.match(email.html, /review-craig-og\.jpg/);
  assert.doesNotMatch(email.html, /Chad|placeholder|review-team/);
  assert.match(email.html, new RegExp(`href="${REVIEW_URL}"`));
  assert.match(email.html, /Leave a review/);
  for (const footer of ["Craig Bridgman- Owner", "(419)-262-2371", "craig@ohiopetwastepros.com", "Ohiopetwastepros.com"]) assert.equal(email.text.includes(footer), true);
  assert.equal(email.html.includes(`${REVIEW_SITE_ORIGIN}/assets/opwp-logo.webp`), true);
  assert.equal(email.html.includes(unsubscribeUrl), true);
  const tonyEmail = buildReviewRequestEmail({ firstName: "Alex", tech: "Tony B", unsubscribeUrl });
  assert.match(tonyEmail.text, /\/review\/tony\//);
  assert.match(tonyEmail.html, /review-tony-og\.jpg/);
  assert.throws(() => buildReviewRequestEmail({ unsubscribeUrl: "https://attacker.example/unsubscribe" }), /secure OPWP/);
});
