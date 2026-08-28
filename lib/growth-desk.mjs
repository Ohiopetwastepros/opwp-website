export const GROWTH_STAGES = ["new", "contacted", "qualified", "quoted", "won", "lost"];
export const GROWTH_PRIORITIES = ["normal", "high", "urgent"];

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
  return { ok: true, value: { action: "save_state", stage, priority, owner, nextAction, nextActionAt } };
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
