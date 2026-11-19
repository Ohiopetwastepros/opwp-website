import { validReviewPreviewToken } from "./review-preview-token.mjs";
import { DEFAULT_REVIEW_REQUEST_TEMPLATE, REVIEW_REQUEST_EMAIL_COPY, renderReviewRequestTemplate, reviewRequestTemplateVersion } from "./review-request-templates.mjs";

export const REVIEW_REQUEST_TEMPLATE_VERSION = reviewRequestTemplateVersion();
export const REVIEW_URL = "https://g.page/r/CXzwhf5RzsotEAE/review";
export const REVIEW_SITE_ORIGIN = "https://www.ohiopetwastepros.com";

export const REVIEW_TECHS = Object.freeze({
  tony: Object.freeze({
    slug: "tony", name: "Tony", title: "Tony took care of your yard today",
    image: "/assets/photos/review-tony.webp", imageFallback: "/assets/photos/review-tony.jpg",
    imageWidth: 960, imageHeight: 1280, ogImage: "/assets/photos/review-tony-og.jpg",
    imageAlt: "Tony from Ohio Pet Waste Pros with his rake and red scoop under a tree",
  }),
  craig: Object.freeze({
    slug: "craig", name: "Craig", title: "Craig took care of your yard today",
    image: "/assets/photos/review-craig.webp", imageFallback: "/assets/photos/review-craig.jpg",
    imageWidth: 960, imageHeight: 1280, ogImage: "/assets/photos/review-craig-og.jpg",
    imageAlt: "Craig from Ohio Pet Waste Pros beside the wrapped service vehicle",
  }),
});

export function reviewTechSlug(name) {
  const words = String(name || "").toLowerCase().match(/[a-z]+/g) || [];
  return ["tony", "craig"].find(slug => words.includes(slug)) || "craig";
}

export function reviewTech(slugOrName) {
  return REVIEW_TECHS[reviewTechSlug(slugOrName)];
}

export function reviewPageUrl(slugOrName) {
  return `${REVIEW_SITE_ORIGIN}/review/${reviewTechSlug(slugOrName)}/`;
}

export function reviewRequestPageUrl(token) {
  if (!validReviewPreviewToken(token)) throw new Error("Invalid review preview token");
  return `${REVIEW_SITE_ORIGIN}/review/r/${token}/`;
}

export function reviewRequestImageUrl(token) {
  return `${reviewRequestPageUrl(token)}og.jpg`;
}

export function personalizedReviewMetadata({ token, tech }) {
  const metadata = reviewPageMetadata(tech);
  const pageUrl = reviewRequestPageUrl(token), imageUrl = reviewRequestImageUrl(token);
  return {
    ...metadata, alternates: { canonical: pageUrl },
    robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer",
    openGraph: { ...metadata.openGraph, url: pageUrl, images: [{ ...metadata.openGraph.images[0], url: imageUrl, secureUrl: imageUrl, type: "image/jpeg" }] },
    twitter: { ...metadata.twitter, images: [imageUrl] },
  };
}

export function reviewPageMetadata(slug) {
  const tech = reviewTech(slug);
  const description = "Thanks for choosing Ohio Pet Waste Pros. Share an honest Google review of your cleanup.";
  const image = `${REVIEW_SITE_ORIGIN}${tech.ogImage}`;
  return {
    title: { absolute: tech.title },
    description,
    alternates: { canonical: reviewPageUrl(tech.slug) },
    openGraph: {
      type: "website", siteName: "Ohio Pet Waste Pros", title: tech.title, description,
      url: reviewPageUrl(tech.slug), images: [{ url: image, width: 1200, height: 630, alt: tech.imageAlt }],
    },
    twitter: { card: "summary_large_image", title: tech.title, description, images: [image] },
  };
}

function firstNameOnly(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e]/g, "").replace(/[<>]/g, "").trim().split(/\s+/)[0] || "there";
}

function message({ firstName, tech, slug, previewToken, template = DEFAULT_REVIEW_REQUEST_TEMPLATE } = {}) {
  return renderReviewRequestTemplate(template, {
    firstName: firstNameOnly(firstName),
    techName: reviewTech(slug || tech).name,
    reviewLink: previewToken ? reviewRequestPageUrl(previewToken) : reviewPageUrl(slug || tech),
  });
}

export function buildReviewRequestSms(options = {}) {
  return message(options).sms;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildReviewRequestEmail(options = {}) {
  const tech = reviewTech(options.slug || options.tech);
  const imageUrl = options.previewToken ? reviewRequestImageUrl(options.previewToken) : `${REVIEW_SITE_ORIGIN}${tech.ogImage}`;
  const unsubscribe = new URL(options.unsubscribeUrl);
  if (unsubscribe.protocol !== "https:" || unsubscribe.origin !== REVIEW_SITE_ORIGIN) throw new Error("A secure OPWP unsubscribe URL is required.");
  const content = message(options), body = content.emailBody;
  const { footer, button, unsubscribe: unsubscribeLabel } = REVIEW_REQUEST_EMAIL_COPY;
  const text = `${body}\n\n${button}: ${REVIEW_URL}\n\n${footer}\n\n${unsubscribeLabel}: ${unsubscribe.href}`;
  const paragraphs = body.split(/\n\n/).map(paragraph => `<p style="font-size:17px;line-height:1.7">${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`).join("");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f5f4ee;color:#1c2a33;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:28px 20px"><div style="background:#fff;border-radius:16px;overflow:hidden"><img src="${imageUrl}" width="600" height="315" alt="${escapeHtml(tech.imageAlt)}" style="display:block;width:100%;height:auto" /><div style="padding:28px">${paragraphs}<p style="margin:28px 0"><a href="${REVIEW_URL}" style="display:inline-block;padding:16px 28px;border-radius:8px;background:#347c2c;color:#fff;font-size:18px;font-weight:bold;text-decoration:none">${escapeHtml(button)}</a></p><div style="border-top:1px solid #e1e7dd;padding-top:22px"><img src="${REVIEW_SITE_ORIGIN}/assets/opwp-logo.webp" width="92" alt="Ohio Pet Waste Pros" style="display:block;margin-bottom:14px" /><p style="font-size:14px;line-height:1.8">Craig Bridgman- Owner<br />Cell <a href="tel:+14192622371">(419)-262-2371</a><br />Email: <a href="mailto:craig@ohiopetwastepros.com">craig@ohiopetwastepros.com</a><br />Website <a href="${REVIEW_SITE_ORIGIN}">Ohiopetwastepros.com</a></p></div><p style="font-size:12px;margin-top:24px"><a href="${escapeHtml(unsubscribe.href)}">${escapeHtml(unsubscribeLabel)}</a></p></div></div></div></body></html>`;
  return { subject: content.emailSubject, text, html };
}
