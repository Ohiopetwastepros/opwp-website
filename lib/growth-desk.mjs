export const GROWTH_STAGES = ["new", "contacted", "qualified", "quoted", "won", "lost", "not_qualified"];
export const GROWTH_PRIORITIES = ["normal", "high", "urgent"];
export const GROWTH_LOSS_REASONS = [
  ["price", "Price / budget"],
  ["timing", "Timing / not ready"],
  ["outside_service_area", "Outside service area"],
  ["chose_competitor", "Chose another provider"],
  ["one_time_only", "One-time service only"],
  ["service_fit", "Service was not a fit"],
  ["duplicate", "Duplicate lead"],
  ["spam", "Spam / vendor solicitation"],
  ["other", "Other"],
];
export const GROWTH_NOT_QUALIFIED_REASONS = [
  ["no_response", "No response"],
  ["opted_out", "Opted out"],
  ["wrong_number", "Wrong number"],
];
export const GROWTH_OUTCOME_REASONS = [...GROWTH_LOSS_REASONS, ...GROWTH_NOT_QUALIFIED_REASONS];

const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function boundedText(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : "";
}

export function normalizeGrowthSubmissionId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return SUBMISSION_ID.test(id) ? id : "";
}

export function validateGrowthMutation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  if (body.action === "add_note") {
    const note = boundedText(body.note, 2000);
    if (!note) return { ok: false, error: "Add a note between 1 and 2,000 characters." };
    return { ok: true, value: { action: "add_note", note } };
  }
  if (body.action !== "save_state") return { ok: false, error: "That YardOps Pipeline action is not supported." };

  const stage = String(body.stage || "");
  const priority = String(body.priority || "");
  const owner = body.owner === "me" ? "me" : body.owner === "unassigned" ? "unassigned" : "";
  const nextAction = boundedText(body.nextAction, 240);
  const suppliedAt = typeof body.nextActionAt === "string" ? body.nextActionAt.trim() : "";
  let nextActionAt = "";
  if (suppliedAt) {
    if (!DATE_TIME.test(suppliedAt)) return { ok: false, error: "Choose a valid next-action date and time." };
    const timestamp = Date.parse(suppliedAt);
    const latest = Date.now() + (2 * 366 * 86400000);
    if (!Number.isFinite(timestamp) || timestamp > latest) return { ok: false, error: "The next action must be within the next two years." };
    nextActionAt = new Date(timestamp).toISOString();
  }
  if (!GROWTH_STAGES.includes(stage) || !GROWTH_PRIORITIES.includes(priority) || !owner) {
    return { ok: false, error: "Choose a valid stage, priority, and owner." };
  }
  if (Boolean(nextAction) !== Boolean(nextActionAt)) {
    return { ok: false, error: "A next action needs both a description and a date." };
  }
  const outcomeReason = String(body.outcomeReason || "");
  const outcomeNote = boundedText(body.outcomeNote, 500);
  const lossReasons = new Set(GROWTH_LOSS_REASONS.map(([value]) => value));
  const notQualifiedReasons = new Set(GROWTH_NOT_QUALIFIED_REASONS.map(([value]) => value));
  if (stage === "lost" && !lossReasons.has(outcomeReason)) {
    return { ok: false, error: "Choose why this lead was not converted." };
  }
  if (stage === "not_qualified" && !notQualifiedReasons.has(outcomeReason)) {
    return { ok: false, error: "Choose why this lead is not qualified." };
  }
  if (!["lost", "not_qualified"].includes(stage) && outcomeReason) {
    return { ok: false, error: "An outcome reason can only be saved for a closed lead." };
  }
  if (typeof body.outcomeNote === "string" && body.outcomeNote.trim() && !outcomeNote) {
    return { ok: false, error: "Outcome notes must be 500 characters or fewer." };
  }
  return { ok: true, value: { action: "save_state", stage, priority, owner, nextAction, nextActionAt, outcomeReason, outcomeNote } };
}

export function quoteSummary(payloadText) {
  let payload = {};
  try { payload = JSON.parse(payloadText || "{}"); } catch { /* Invalid historical payloads stay safely blank. */ }
  const context = payload?.quote_context && typeof payload.quote_context === "object" ? payload.quote_context : {};
  const amount = Number(context.quote_monthly ?? payload.quoted_monthly_total);
  return {
    dogs: String(context.dogs ?? payload.number_of_dogs ?? "").slice(0, 20),
    frequency: String(context.frequency ?? payload.clean_up_frequency ?? "").slice(0, 80),
    yard: String(context.yard_size ?? payload.yard_size_tier ?? "").slice(0, 80),
    monthly: Number.isFinite(amount) && amount >= 0 ? amount : null,
    question: String(payload.question ?? "").trim().slice(0, 1000),
    consent: payload.follow_up_consent === true,
    consentAt: String(payload.follow_up_consent_at ?? "").slice(0, 40),
  };
}

export function sourceStage(row) {
  return row?.lifecycle_stage === "converted" || (row?.kind === "onboarding" && row?.sng_sync_state === "succeeded")
    ? "won"
    : GROWTH_STAGES.includes(row?.growth_stage) ? row.growth_stage : "new";
}

export function leadSourceBucket(lead) {
  if (lead?.source === "facebook") return "meta";
  if (lead?.source === "quo") return "quo";
  if (lead?.source === "website" && lead?.kind === "partial_quote") return "website_quotes";
  return "other";
}

export function leadOrigin(payloadText, lead = {}) {
  let payload = {};
  try { payload = JSON.parse(payloadText || "{}"); } catch { /* Historical payloads may be invalid. */ }
  const bucket = leadSourceBucket(lead);
  const sourceNames = { meta: "Meta lead form", quo: "Quo text", website_quotes: "Website quote funnel", other: "Website / manual" };
  const externalId = bucket === "meta"
    ? String(payload.meta_lead_id || "").slice(0, 100)
    : bucket === "website_quotes"
      ? String(payload.funnel_id || lead.funnelId || "").slice(0, 100)
      : String(lead.externalThreadId || "").slice(0, 100);
  return {
    bucket,
    name: sourceNames[bucket],
    externalId,
    formId: bucket === "meta" ? String(payload.meta_form_id || "").slice(0, 100) : "",
    pageId: bucket === "meta" ? String(payload.meta_page_id || "").slice(0, 100) : "",
    channel: String(lead.channel || lead.source || "website").slice(0, 60),
  };
}

export function buildLeadAnalytics(leads) {
  const records = Array.isArray(leads) ? leads : [];
  const won = records.filter((lead) => lead.stage === "won");
  const lost = records.filter((lead) => lead.stage === "lost");
  const notQualified = records.filter((lead) => lead.stage === "not_qualified");
  const open = records.filter((lead) => !["won", "lost", "not_qualified"].includes(lead.stage));
  const decided = won.length + lost.length;
  const sources = ["meta", "quo", "website_quotes", "other"].map((source) => {
    const group = records.filter((lead) => leadSourceBucket(lead) === source);
    const sourceWon = group.filter((lead) => lead.stage === "won").length;
    const sourceLost = group.filter((lead) => lead.stage === "lost").length;
    const sourceNotQualified = group.filter((lead) => lead.stage === "not_qualified").length;
    return {
      source,
      total: group.length,
      won: sourceWon,
      lost: sourceLost,
      notQualified: sourceNotQualified,
      delivered: group.filter((lead) => (lead.conversation?.messages || []).some((message) => message.direction === "outbound" && message.delivery_status === "delivered")).length,
      deliveryErrors: group.filter((lead) => (lead.meta?.jobs || []).some((job) => ["failed", "unknown"].includes(job.status))).length,
      replied: group.filter((lead) => Boolean(lead.conversation?.lastInboundAt)).length,
      qualified: group.filter((lead) => lead.meta?.qualifiedAt || ["qualified", "quoted", "won"].includes(lead.stage)).length,
      quoted: group.filter((lead) => lead.meta?.quotedAt || ["quoted", "won"].includes(lead.stage)).length,
      open: group.length - sourceWon - sourceLost - sourceNotQualified,
      conversionRate: sourceWon + sourceLost ? Math.round((sourceWon / (sourceWon + sourceLost)) * 100) : null,
    };
  });
  const lossReasons = GROWTH_LOSS_REASONS.map(([reason, reasonLabel]) => ({
    reason,
    label: reasonLabel,
    count: lost.filter((lead) => lead.outcomeReason === reason).length,
  })).filter((item) => item.count > 0);
  const notQualifiedReasons = GROWTH_NOT_QUALIFIED_REASONS.map(([reason, reasonLabel]) => ({
    reason,
    label: reasonLabel,
    count: notQualified.filter((lead) => lead.outcomeReason === reason).length,
  })).filter((item) => item.count > 0);
  return {
    total: records.length,
    won: won.length,
    lost: lost.length,
    notQualified: notQualified.length,
    open: open.length,
    decided,
    conversionRate: decided ? Math.round((won.length / decided) * 100) : null,
    openQuotedMonthly: open.reduce((sum, lead) => sum + (Number(lead.quote?.monthly) || 0), 0),
    wonMonthly: won.reduce((sum, lead) => sum + (Number(lead.quote?.monthly) || 0), 0),
    sources,
    lossReasons,
    notQualifiedReasons,
  };
}
