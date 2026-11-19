import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  REVIEW_REQUEST_TEMPLATE_VERSION, REVIEW_SITE_ORIGIN, REVIEW_TECHS, REVIEW_URL,
  buildReviewRequestEmail, buildReviewRequestSms, reviewPageMetadata, reviewPageUrl, reviewRequestImageUrl, reviewTechSlug,
} from "../lib/review-request-content.mjs";
import { createReviewPreviewToken } from "../lib/review-preview-token.mjs";
import { REVIEW_REQUEST_TEMPLATES, renderReviewRequestTemplate, reviewRequestTemplateVersion } from "../lib/review-request-templates.mjs";

test("review SMS preserves the approved wording and uses only the customer's first name", () => {
  assert.equal(buildReviewRequestSms({ firstName: "Alex Example", tech: "Tony B" }),
    "Hey Alex, thanks for choosing Ohio Pet Waste Pros for your cleanup! Here's who took care of your yard today. If you have a minute, an honest Google review would mean a lot.\n\nThank you!\n\nReply STOP to opt out\n\nhttps://g.page/r/CXzwhf5RzsotEAE/review");
  assert.equal(REVIEW_REQUEST_TEMPLATE_VERSION, "review-request-v3");
  assert.equal(reviewRequestTemplateVersion("initial-cleanup"), "review-request-initial-cleanup-v3");
  const sms = buildReviewRequestSms({ firstName: "Jo\u2019Anne Example", tech: "Craig Bridgman" });
  assert.match(sms, /^Hey Jo'Anne,/);
  assert.equal(/[^\x20-\x7e\n]/.test(sms), false);
  assert.equal(sms.includes(REVIEW_URL), true);
  assert.match(buildReviewRequestSms(), /^Hey there,/);
});

test("Sweep & Go technician variations map to public page slugs without guessed names", () => {
  for (const [input, slug] of [["Tony B", "tony"], ["Tony", "tony"], ["TONY B.", "tony"], ["Chad", "craig"], ["Chad B", "craig"], ["Craig Bridgman", "craig"], ["craig", "craig"], ["", "craig"], ["Unknown Tech", "craig"], ["Chadwick", "craig"], ["team", "craig"]]) {
    assert.equal(reviewTechSlug(input), slug, input);
    assert.equal(reviewPageUrl(input), `${REVIEW_SITE_ORIGIN}/review/${slug}/`);
    assert.equal(buildReviewRequestSms({ firstName: "Alex", tech: input }).split("\n").at(-1), REVIEW_URL);
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
  assert.equal(email.text.includes(REVIEW_URL), true);
  assert.doesNotMatch(email.text, /ohiopetwastepros\.com\/review\/(?:r\/|tony\/|craig\/)/);
  assert.match(email.html, /review-craig-og\.jpg/);
  assert.doesNotMatch(email.html, /Chad|placeholder|review-team/);
  assert.match(email.html, new RegExp(`href="${REVIEW_URL}"`));
  assert.match(email.html, /Leave a review/);
  for (const footer of ["Craig Bridgman- Owner", "(419)-262-2371", "craig@ohiopetwastepros.com", "Ohiopetwastepros.com"]) assert.equal(email.text.includes(footer), true);
  assert.equal(email.html.includes(`${REVIEW_SITE_ORIGIN}/assets/opwp-logo.webp`), true);
  assert.equal(email.html.includes(unsubscribeUrl), true);
  const tonyEmail = buildReviewRequestEmail({ firstName: "Alex", tech: "Tony B", unsubscribeUrl });
  assert.equal(tonyEmail.text.includes(REVIEW_URL), true);
  assert.match(tonyEmail.html, /review-tony-og\.jpg/);
  assert.throws(() => buildReviewRequestEmail({ unsubscribeUrl: "https://attacker.example/unsubscribe" }), /secure OPWP/);
});

test("initial-cleanup SMS uses the exact approved message with the direct Google URL last and a STOP line", () => {
  const previewToken = createReviewPreviewToken();
  const sms = buildReviewRequestSms({ template: "initial-cleanup", firstName: "Craig Bridgman", tech: "Tony B", previewToken });
  assert.equal(sms, "Hi Craig, this is Craig with Ohio Pet Waste Pros. Thanks for letting Tony take care of your yard! If you were happy with the cleanup, would you take a minute to leave us a Google review? It really helps our small family business grow. 😃\n\nReply STOP to opt out\n\nhttps://g.page/r/CXzwhf5RzsotEAE/review");
  assert.equal(sms.split("\n").filter(Boolean).at(-1), REVIEW_URL);
  assert.doesNotMatch(sms, /\{\{|\}\}|[\u2013\u2014\u2018\u2019\u201c\u201d]|five.star|5.star/i);
  assert.equal(sms.replace("😃", "").match(/[^\x20-\x7e\n]/), null);
});

test("both SMS templates put their sole direct Google URL after STOP with or without a preview", () => {
  for (const template of ["standard", "initial-cleanup"]) for (const previewToken of [undefined, createReviewPreviewToken()]) {
    const sms = buildReviewRequestSms({ template, firstName: "Alex", tech: "Tony", previewToken });
    const lines = sms.split("\n").filter(line => line.trim());
    assert.equal(lines.at(-1), REVIEW_URL, template);
    assert.equal(lines.at(-2), "Reply STOP to opt out", template);
    assert.ok(sms.endsWith(`\n\n${REVIEW_URL}`), template);
    assert.equal(sms.slice(0, sms.indexOf("Reply STOP to opt out")).includes("http"), false, template);
    assert.deepEqual(sms.match(/https?:\/\/\S+/g), [REVIEW_URL], template);
    assert.doesNotMatch(sms, /ohiopetwastepros\.com\/review\/|[\u2013\u2014]|five.star|5.star/i);
  }
});

test("named templates substitute first name, technician and review URL without changing delivery code", () => {
  const reviewLink = "https://example.invalid/opaque-token/";
  const rendered = renderReviewRequestTemplate("initial-cleanup", { firstName: "Alex", techName: "Jordan", reviewLink });
  assert.match(rendered.sms, /^Hi Alex,/);
  assert.match(rendered.sms, /Thanks for letting Jordan take care of your yard!/);
  assert.equal(rendered.emailBody, `${rendered.sms.split("\n\n")[0]} ${reviewLink}`);
  assert.equal(rendered.version, reviewRequestTemplateVersion("initial-cleanup"));
  assert.match(buildReviewRequestSms({ template: "initial-cleanup", firstName: "Jo\u2019Anne Example", tech: "Craig Bridgman" }), /^Hi Jo'Anne,.*Thanks for letting Craig take care/);
  assert.throws(() => renderReviewRequestTemplate("missing", {}), /Unknown review request template/);
  assert.throws(() => renderReviewRequestTemplate("initial-cleanup", { firstName: "Alex" }), /Missing review request placeholder: techName/);
  assert.throws(() => buildReviewRequestSms({ template: "missing" }), /Unknown review request template/);
  for (const [name, template] of Object.entries(REVIEW_REQUEST_TEMPLATES)) {
    assert.match(template.sms, /\n\nReply STOP to opt out\n\n\{\{reviewLink\}\}$/);
    assert.doesNotMatch(JSON.stringify(template), /[\u2013\u2014\u2018\u2019\u201c\u201d]|five.star|5.star/i);
    assert.equal(reviewRequestTemplateVersion(name), template.version);
  }
});

test("initial-cleanup email shares the SMS message, personalized image, Google button and exact owner footer", () => {
  const previewToken = createReviewPreviewToken();
  const unsubscribeUrl = `${REVIEW_SITE_ORIGIN}/review/unsubscribe/?token=fixture`;
  const options = { template: "initial-cleanup", firstName: "Craig", tech: "Tony", previewToken, unsubscribeUrl };
  const email = buildReviewRequestEmail(options), message = buildReviewRequestSms(options).split("\n\n")[0];
  assert.equal(email.text.split("\n\n")[0], `${message} ${REVIEW_URL}`);
  assert.equal(email.html.includes(`${message} ${REVIEW_URL}`), true);
  assert.equal(email.html.includes(`src="${reviewRequestImageUrl(previewToken)}"`), true);
  assert.equal(email.html.includes(`href="${REVIEW_URL}"`), true);
  assert.match(email.html, /font-size:18px;font-weight:bold;text-decoration:none">Leave a review<\/a>/);
  assert.equal(email.html.includes(`${REVIEW_SITE_ORIGIN}/assets/opwp-logo.webp`), true);
  assert.equal(email.text.includes("Craig Bridgman- Owner\nCell (419)-262-2371\nEmail: craig@ohiopetwastepros.com\nWebsite Ohiopetwastepros.com"), true);
  assert.equal(email.html.includes(unsubscribeUrl), true);
  assert.match(email.text, /Unsubscribe from review requests:/);
  assert.doesNotMatch(email.text, /five.star|5.star/i);
});

test("both email templates use Google for every review link and preserve personalized JPEGs", () => {
  const unsubscribeUrl = `${REVIEW_SITE_ORIGIN}/review/unsubscribe/?token=fixture`;
  for (const template of ["standard", "initial-cleanup"]) for (const previewToken of [undefined, createReviewPreviewToken()]) {
    const email = buildReviewRequestEmail({ template, firstName: "Craig", tech: "Tony", previewToken, unsubscribeUrl });
    const body = email.text.split("\n\nLeave a review:")[0];
    assert.deepEqual(body.match(/https?:\/\/\S+/g), [REVIEW_URL]);
    assert.equal(email.html.includes(`href="${REVIEW_URL}"`), true);
    assert.equal(email.text.includes(`Leave a review: ${REVIEW_URL}`), true);
    assert.doesNotMatch(email.text, /ohiopetwastepros\.com\/review\/(?:r\/|tony\/|craig\/)/);
    assert.doesNotMatch(email.html, /href="https:\/\/www\.ohiopetwastepros\.com\/review\/(?:r\/|tony\/|craig\/)/);
    if (previewToken) {
      assert.equal(email.html.includes(`src="${reviewRequestImageUrl(previewToken)}" width="600" height="315"`), true);
      assert.equal(email.text.includes(previewToken), false);
    }
    assert.equal(email.text.includes("Craig Bridgman- Owner\nCell (419)-262-2371\nEmail: craig@ohiopetwastepros.com\nWebsite Ohiopetwastepros.com"), true);
    assert.doesNotMatch(email.text, /[\u2013\u2014]|five.star|5.star/i);
  }
});
