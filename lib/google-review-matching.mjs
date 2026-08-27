const ALIAS_SEPARATOR = /[\n,;]+/;

export function normalizeReviewIdentity(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "");
}

export function parseReviewAliases(value) {
  const aliases = [];
  const seen = new Set();
  for (const item of String(value ?? "").split(ALIAS_SEPARATOR)) {
    const alias = item.trim().replace(/\s+/g, " ").slice(0, 100);
    const key = normalizeReviewIdentity(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases.slice(0, 20);
}

export function reviewRatingNumber(value) {
  const named = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) return numeric;
  return named[String(value ?? "").toUpperCase()] ?? null;
}

export function buildReviewIdentityIndex(records) {
  const index = new Map();
  const add = (identity, record) => {
    const key = normalizeReviewIdentity(identity);
    if (!key) return;
    const matches = index.get(key) ?? [];
    if (!matches.some((candidate) => candidate.id === record.id)) matches.push(record);
    index.set(key, matches);
  };

  for (const record of records) {
    if (String(record?.fields?.["Client Type"] ?? "").toLowerCase() === "unmatched review") continue;
    add(record?.fields?.["Client Name"], record);
    for (const alias of parseReviewAliases(record?.fields?.["Google Review Aliases"])) add(alias, record);
    if (String(record?.fields?.["Google Review"] ?? "").toLowerCase() === "reviewed") {
      add(record?.fields?.["Review Name"], record);
    }
  }
  return index;
}

function safeIsoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

export function matchGoogleReviews(records, reviews) {
  const index = buildReviewIdentityIndex(records);
  const matchedByRecord = new Map();
  const unmatched = [];
  const ambiguous = [];

  for (const review of reviews) {
    const displayName = String(review?.reviewer?.displayName ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
    const key = normalizeReviewIdentity(displayName);
    if (!key) {
      unmatched.push({ reviewId: String(review?.reviewId ?? "").slice(0, 200), displayName: "Anonymous" });
      continue;
    }
    const candidates = index.get(key) ?? [];
    if (candidates.length !== 1) {
      const item = { reviewId: String(review?.reviewId ?? "").slice(0, 200), displayName };
      if (candidates.length > 1) ambiguous.push({ ...item, clientNames: candidates.map((record) => record.fields["Client Name"] || "Unknown") });
      else unmatched.push(item);
      continue;
    }

    const record = candidates[0];
    const current = matchedByRecord.get(record.id);
    const currentTime = Date.parse(current?.updateTime || current?.createTime || 0);
    const candidateTime = Date.parse(review?.updateTime || review?.createTime || 0);
    if (!current || (Number.isFinite(candidateTime) && candidateTime > currentTime)) matchedByRecord.set(record.id, review);
  }

  const matches = [];
  for (const [recordId, review] of matchedByRecord) {
    const record = records.find((candidate) => candidate.id === recordId);
    const reviewDate = safeIsoDate(review?.createTime);
    const rating = reviewRatingNumber(review?.starRating);
    const fields = {
      "Google Review": "Reviewed",
      "Follow-up Priority": "Do not contact - reviewed",
      "Review Name": String(review?.reviewer?.displayName ?? "").trim().replace(/\s+/g, " ").slice(0, 100),
    };
    if (reviewDate) fields["Review Date"] = reviewDate;
    if (rating) fields["Review Rating"] = rating;
    const changedFields = Object.fromEntries(Object.entries(fields).filter(([name, value]) => String(record?.fields?.[name] ?? "") !== String(value)));
    matches.push({ record, review, fields: changedFields });
  }

  return { matches, unmatched, ambiguous };
}
