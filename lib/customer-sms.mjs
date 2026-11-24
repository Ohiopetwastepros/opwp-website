// Routine messages omit opt-out footers and strip historical suffixes.
// The first Meta confirmation adds its footer explicitly after formatting.
export function stripSmsOptOutFooter(body) {
  return String(body || "").replace(/(?:\s*(?:Reply STOP to opt out|Text STOP to unsubscribe|Reply to opt out:\s*STOP)\.?)+\s*$/i, "").trim();
}

export function formatCustomerSms(body) {
  const text = stripSmsOptOutFooter(body).normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018-\u201b]/g, "'")
    .replace(/[\u201c-\u201f]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\p{P}/gu, punctuation => punctuation.charCodeAt(0) < 128 ? punctuation : " ")
    .replace(/[\u00a0\u202f]/g, " ").trim();
  return text.slice(0, 1000).trimEnd();
}
