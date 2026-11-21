// Lead and quote automation uses one opt-out line, separated from the body.
// Review-request SMS has its own approved layout with the link after this line.
export function formatCustomerSms(body) {
  const closing = "\n\nReply STOP to opt out";
  const text = String(body || "").normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018-\u201b]/g, "'")
    .replace(/[\u201c-\u201f]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\p{P}/gu, punctuation => punctuation.charCodeAt(0) < 128 ? punctuation : " ")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/(?:\s*Reply STOP to opt out\.?)+\s*$/i, "").trim();
  return `${text.slice(0, 1000 - closing.length).trimEnd()}${closing}`;
}
