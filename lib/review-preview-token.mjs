export const REVIEW_PREVIEW_WIDTH = 1200;
export const REVIEW_PREVIEW_HEIGHT = 630;
export const REVIEW_FIRST_NAME_MAX_LENGTH = 40;

// Request IDs are crypto.randomUUID() values, never customer or source job IDs.
export function validReviewPreviewToken(value) {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

export function createReviewPreviewToken() {
  return crypto.randomUUID();
}

export function sanitizeReviewFirstName(value) {
  const first = String(value ?? "").slice(0, 500).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-").replace(/<[^>]*>/g, "")
    .trim().split(/\s+/)[0].replace(/[^a-zA-Z'-]/g, "")
    .slice(0, REVIEW_FIRST_NAME_MAX_LENGTH).replace(/^['-]+|['-]+$/g, "");
  return /[a-z]/i.test(first) ? first : "";
}

export function reviewPreviewObjectKey(token) {
  if (!validReviewPreviewToken(token)) throw new Error("Invalid review preview token");
  // Keep the original storage identity across image formats and old links.
  return `review-og/${token}.png`;
}
