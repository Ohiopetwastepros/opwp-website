import { reviewTechSlug, reviewRequestPageUrl, reviewRequestImageUrl } from "./review-request-content.mjs";
import { sanitizeReviewFirstName, reviewPreviewObjectKey, validReviewPreviewToken } from "./review-preview-token.mjs";

export const REVIEW_PREVIEW_MAX_BYTES = 1_000_000;

function imageContentType(object) {
  if (object?.customMetadata?.reviewPreviewVersion === "2" && object.httpMetadata?.contentType === "image/jpeg") return "image/jpeg";
  if (object?.customMetadata?.reviewPreviewVersion === "1") return "image/png";
  return null;
}

function descriptor(token, object) {
  if (!imageContentType(object) || !["craig", "tony"].includes(object.customMetadata.tech)) return null;
  return { token, tech: object.customMetadata.tech, pageUrl: reviewRequestPageUrl(token), imageUrl: reviewRequestImageUrl(token) };
}

// These reads work on an OpenNext cache miss and never create a preview.
export async function getReviewPreview(env, token) {
  if (!validReviewPreviewToken(token)) return null;
  if (!env?.FIELD_PROOFS) throw new Error("Review preview storage unavailable");
  return descriptor(token, await env.FIELD_PROOFS.head(reviewPreviewObjectKey(token)));
}

export async function getReviewPreviewImage(env, token) {
  if (!validReviewPreviewToken(token)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!env?.FIELD_PROOFS) return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  const object = await env.FIELD_PROOFS.get(reviewPreviewObjectKey(token));
  if (!descriptor(token, object)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(object.body, { headers: {
    "Content-Type": imageContentType(object), "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
  } });
}

// Send preparation only: no DB writes, queue creation, or provider calls.
// A published request reuses its immutable image for both delivery channels.
export async function prepareReviewPreview(env, { token, firstName, tech }, { render } = {}) {
  if (!validReviewPreviewToken(token)) throw new Error("Invalid review preview token");
  const existing = await getReviewPreview(env, token);
  if (existing) return existing;
  const sanitized = sanitizeReviewFirstName(firstName);
  if (!sanitized) return null;
  const slug = reviewTechSlug(tech);
  const generate = render || (await import("./review-preview-renderer.mjs")).renderReviewPreview;
  const image = await generate(env, { firstName: sanitized, tech: slug });
  if (image.contentType !== "image/jpeg" || !image.bytes?.byteLength || image.bytes.byteLength >= REVIEW_PREVIEW_MAX_BYTES ||
      image.bytes[0] !== 0xff || image.bytes[1] !== 0xd8 || image.bytes[2] !== 0xff) throw new Error("Invalid review preview image");
  const options = {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { reviewPreviewVersion: "2", tech: slug },
    onlyIf: { etagDoesNotMatch: "*" },
  };
  await env.FIELD_PROOFS.put(reviewPreviewObjectKey(token), image.bytes, options);
  const published = await getReviewPreview(env, token);
  if (!published) throw new Error("Review preview was not persisted");
  return published;
}
