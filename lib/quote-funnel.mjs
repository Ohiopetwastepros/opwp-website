const FUNNEL_ID = /^[A-Za-z0-9_-]{16,80}$/;
const STAGES = new Set(["quote_viewed", "details_started", "onboarding_submitted", "converted"]);

export function normalizeFunnelId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return FUNNEL_ID.test(normalized) ? normalized : "";
}

export function normalizeFunnelStage(value, fallback = "quote_viewed") {
  return STAGES.has(value) ? value : fallback;
}

export function escapeEmailHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function display(value, fallback = "Not provided") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function quoteContext(body = {}) {
  const context = body.quote_context || {};
  return [
    ["ZIP", body.zip || body.zip_code],
    ["Dogs", context.dogs ?? body.number_of_dogs],
    ["Frequency", context.frequency || body.clean_up_frequency],
    ["Yard", context.yard_size || body.yard_size_tier],
    ["Quoted monthly", context.quote_monthly ?? body.quoted_monthly_total],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
}

const SUBJECTS = {
  partial_quote: "New website quote lead",
  question: "Website quote question",
  waitlist: "New out-of-area waitlist request",
  onboarding_succeeded: "New Sweep & Go customer created",
  onboarding_failed: "Website signup needs attention",
};

export function buildSubmissionNotification({ type, submissionId, body = {}, providerStatus = null }) {
  const subject = SUBJECTS[type] || "Website funnel activity";
  const name = display(body.name || [body.first_name, body.last_name].filter(Boolean).join(" "));
  const rows = [
    ["Event", type.replaceAll("_", " ")],
    ["Name", name],
    ["Email", display(body.email || body.email_address)],
    ["Phone", display(body.phone || body.cell_phone_number)],
    ...quoteContext(body),
    ...(body.question ? [["Question", body.question]] : []),
    ...(providerStatus !== null ? [["Sweep & Go status", providerStatus]] : []),
    ["Submission ID", submissionId],
  ];
  const text = rows.map(([label, value]) => `${label}: ${display(value)}`).join("\n");
  const html = `<h1>${escapeEmailHtml(subject)}</h1><table>${rows.map(([label, value]) => `<tr><th align="left" valign="top" style="padding:4px 12px 4px 0">${escapeEmailHtml(label)}</th><td style="padding:4px 0">${escapeEmailHtml(display(value))}</td></tr>`).join("")}</table>`;
  return { subject, text, html };
}

export const quoteFunnelStages = STAGES;
