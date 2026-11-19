import { formatCleanupRange } from "../app/free-quote/pricing.js";
import { escapeEmailHtml } from "./quote-funnel.mjs";

const display = (value) => String(value ?? "").trim() || "Not provided";
const dollars = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const estimate = (range) => Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) ? formatCleanupRange(range) : "Not quoted";

export function buildMetaOwnerNotification({ submissionId, lead, state }) {
  const personal = state.human_requested === true;
  if (!personal && !(state.quote_accepted && state.ready_for_route_audit && state.details?.address)) return null;
  const details = { ...lead, ...state.details };
  const subject = personal ? "Facebook lead requests a personal text from Craig" : "Facebook lead ready for signup and route audit";
  const intro = personal
    ? "This Facebook lead asked you to text personally. Automated texts are paused. Read the conversation and reply personally."
    : "This Facebook lead accepted the quote and provided a service address. Create the account and audit the route/service day before confirming a start date.";
  const quote = state.quote;
  const rows = [
    ["Name", details.name], ["Phone", details.phone], ["Address", details.address], ["ZIP", details.zip],
    ["Dogs", details.number_of_dogs], ["Frequency", details.clean_up_frequency],
    ["Quoted price", Number.isFinite(quote?.monthly) ? `${dollars(quote.monthly)} per month` : quote?.type === "one_time" ? `${estimate(quote.range)} one-time cleanup estimate` : "Not quoted"],
    ...(quote?.initialRange ? [["Initial cleanup estimate", estimate(quote.initialRange)]] : []),
    ["Submission ID", submissionId],
  ];
  const link = "https://www.ohiopetwastepros.com/admin/quote-funnel/";
  const text = `Craig,\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${display(value)}`).join("\n")}\n\nGrowth Desk: ${link}`;
  const html = `<h1>${escapeEmailHtml(subject)}</h1><p>Craig,</p><p>${escapeEmailHtml(intro)}</p><table>${rows.map(([label, value]) => `<tr><th align="left" valign="top" style="padding:4px 12px 4px 0">${escapeEmailHtml(label)}</th><td style="padding:4px 0">${escapeEmailHtml(display(value))}</td></tr>`).join("")}</table><p><a href="${link}">Open Growth Desk</a></p>`;
  // Use the existing question/quote email categories, each unique per lead and
  // recipient. These are owner-only emails; no schema change or customer send.
  return { type: personal ? "question" : "partial_quote", content: { subject, text, html } };
}
