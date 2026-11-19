export const REVIEW_REQUEST_TEMPLATE_VERSION = "review-request-v1";
export const REVIEW_URL = "https://g.page/r/CXzwhf5RzsotEAE/review";
export const REVIEW_SITE_ORIGIN = "https://www.ohiopetwastepros.com";

export const REVIEW_TECHS = Object.freeze({
  tony: Object.freeze({ slug: "tony", name: "Tony", title: "Tony took care of your yard today", image: "/assets/photos/review-tony.jpg", imageAlt: "Tony from Ohio Pet Waste Pros", placeholder: false }),
  chad: Object.freeze({ slug: "chad", name: "Chad", title: "Chad took care of your yard today", image: "/assets/photos/review-chad.jpg", imageAlt: "Ohio Pet Waste Pros team photo, a placeholder while Chad's photo is coming soon", placeholder: true }),
  craig: Object.freeze({ slug: "craig", name: "Craig", title: "Craig took care of your yard today", image: "/assets/photos/review-craig.jpg", imageAlt: "Craig from Ohio Pet Waste Pros", placeholder: false }),
  team: Object.freeze({ slug: "team", name: "Your Ohio Pet Waste Pros team", title: "Your Ohio Pet Waste Pros team took care of your yard today", image: "/assets/photos/review-team.jpg", imageAlt: "The Ohio Pet Waste Pros team beside their service vehicle", placeholder: false }),
});

export function reviewTechSlug(name) {
  const words = String(name || "").toLowerCase().match(/[a-z]+/g) || [];
  return ["tony", "chad", "craig"].find(slug => words.includes(slug)) || "team";
}

export function reviewTech(slugOrName) {
  return REVIEW_TECHS[reviewTechSlug(slugOrName)];
}

export function reviewPageUrl(slugOrName) {
  return `${REVIEW_SITE_ORIGIN}/review/${reviewTechSlug(slugOrName)}/`;
}

export function reviewPageMetadata(slug) {
  const tech = reviewTech(slug);
  const description = "Thanks for choosing Ohio Pet Waste Pros. Share an honest Google review of your cleanup.";
  const image = `${REVIEW_SITE_ORIGIN}${tech.image}`;
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

function message({ firstName, tech, slug } = {}) {
  return `Hey ${firstNameOnly(firstName)}, thanks for choosing Ohio Pet Waste Pros for your cleanup! Here's who took care of your yard today: ${reviewPageUrl(slug || tech)} If you have a minute, an honest Google review would mean a lot.`;
}

export function buildReviewRequestSms(options = {}) {
  return `${message(options)}\n\nThank you!\n\nReply STOP to opt out`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildReviewRequestEmail(options = {}) {
  const tech = reviewTech(options.slug || options.tech);
  const unsubscribe = new URL(options.unsubscribeUrl);
  if (unsubscribe.protocol !== "https:" || unsubscribe.origin !== REVIEW_SITE_ORIGIN) throw new Error("A secure OPWP unsubscribe URL is required.");
  const body = message(options);
  const footer = "Craig Bridgman- Owner\nCell (419)-262-2371\nEmail: craig@ohiopetwastepros.com\nWebsite Ohiopetwastepros.com";
  const text = `${body}\n\nThank you!\n\nLeave a review: ${REVIEW_URL}\n\n${footer}\n\nUnsubscribe from review requests: ${unsubscribe.href}`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f5f4ee;color:#1c2a33;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:28px 20px"><div style="background:#fff;border-radius:16px;overflow:hidden"><img src="${REVIEW_SITE_ORIGIN}${tech.image}" width="600" height="315" alt="${escapeHtml(tech.imageAlt)}" style="display:block;width:100%;height:auto" /><div style="padding:28px"><p style="font-size:17px;line-height:1.7">${escapeHtml(body)}</p><p style="font-size:17px;line-height:1.7">Thank you!</p>${tech.placeholder ? '<p style="font-size:13px;color:#52616b">Team photo shown. Chad\'s photo is coming soon.</p>' : ""}<p style="margin:28px 0"><a href="${REVIEW_URL}" style="display:inline-block;padding:16px 28px;border-radius:8px;background:#347c2c;color:#fff;font-size:18px;font-weight:bold;text-decoration:none">Leave a review</a></p><div style="border-top:1px solid #e1e7dd;padding-top:22px"><img src="${REVIEW_SITE_ORIGIN}/assets/opwp-logo.webp" width="92" alt="Ohio Pet Waste Pros" style="display:block;margin-bottom:14px" /><p style="font-size:14px;line-height:1.8">Craig Bridgman- Owner<br />Cell <a href="tel:+14192622371">(419)-262-2371</a><br />Email: <a href="mailto:craig@ohiopetwastepros.com">craig@ohiopetwastepros.com</a><br />Website <a href="${REVIEW_SITE_ORIGIN}">Ohiopetwastepros.com</a></p></div><p style="font-size:12px;margin-top:24px"><a href="${escapeHtml(unsubscribe.href)}">Unsubscribe from review requests</a></p></div></div></div></body></html>`;
  return { subject: "Thank you for choosing Ohio Pet Waste Pros", text, html };
}
