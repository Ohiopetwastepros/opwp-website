// Lead and quote automation uses one opt-out line, separated from the body.
// Review-request SMS has its own approved layout with the link after this line.
export function formatCustomerSms(body) {
  const closing = "\n\nReply STOP to opt out";
  const text = String(body || "").replace(/[\u2013\u2014]/g, "-")
    .replace(/(?:\s*Reply STOP to opt out\.?)+\s*$/i, "").trim();
  return `${text.slice(0, 1000 - closing.length).trimEnd()}${closing}`;
}
