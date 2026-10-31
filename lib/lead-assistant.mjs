export const AUTOMATION_MODES = ["paused", "suggest", "approved"];
export const NO_RESPONSE_GRACE_HOURS = 48;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function text(value, max) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= max ? normalized : "";
}

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

const CUSTOMER_SERVICE_LANGUAGE = /\b(cancel(?:l?ing|lation|l?ed)?|pause|skip|reschedule|moving|move out|last (?:service|month|visit)|my (?:service|account|invoice|payment|yard|gate|check)|charged|technician|missed (?:service|visit)|did(?:n't| not) (?:come|show))\b/i;
const OPERATIONAL_LANGUAGE = /\b(?:treating|spraying|fertiliz(?:e|ing)|pesticide|fleas?)\b.{0,50}\b(?:yard|lawn|property)\b|\b(?:have|mailed?|pick(?:ed)? up|drop(?:ped)? off)\b.{0,30}\b(?:the|your|my)?\s*check\b/i;
const SOLICITATION_LANGUAGE = /\b(?:marketing|seo|website design|home[- ]service leads?|google ranking|yard signs?)\b.{0,100}\b(?:ads?|leads?|setup|agency|offer|package|pricing|signs?)\b|\b(?:fund your ads?|free ad setup|no monthly cost)\b/i;

export function looksLikeCustomerServiceText(value) {
  const text = String(value || "").slice(0, 4000);
  return CUSTOMER_SERVICE_LANGUAGE.test(text) || OPERATIONAL_LANGUAGE.test(text) || SOLICITATION_LANGUAGE.test(text);
}

export function sngClientMatchesPhone(client, phone) {
  const expected = normalizePhone(phone);
  if (!expected || !client || typeof client !== "object") return false;
  const candidates = [
    client.cell_phone_number,
    client.cell_phone,
    client.phone_number,
    client.phone,
    client.mobile,
    client.mobile_phone,
    client?.contact?.cell_phone_number,
    client?.contact?.phone,
  ];
  return candidates.some((value) => normalizePhone(value) === expected);
}

export function resolveLeadSyncId(row) {
  const id = String(row?.id || row?.submission_id || "").trim();
  if (!id) throw new Error("YardOps lead ID is missing from the Airtable sync record.");
  return id;
}

export function validateLeadAssistantMutation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  if (body.action === "refresh_meta_route") return { ok: true, value: { action: body.action } };
  if (body.action === "audit_meta_route") {
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const days = Array.isArray(body.days) ? [...new Set(body.days)].sort((left, right) => weekdays.indexOf(left) - weekdays.indexOf(right)) : [];
    if (!days.length || days.length > 2 || days.some((day) => !["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].includes(day)) || !text(body.snapshotAt, 40)) return { ok: false, error: "Select current route days and their source snapshot." };
    return { ok: true, value: { action: body.action, days, snapshotAt: body.snapshotAt } };
  }
  if (body.action === "send_message") {
    const message = text(body.message, 1000);
    if (!message) return { ok: false, error: "Write a message between 1 and 1,000 characters." };
    return { ok: true, value: { action: "send_message", message } };
  }
  if (body.action === "set_automation") {
    const mode = String(body.mode || "");
    if (!AUTOMATION_MODES.includes(mode)) return { ok: false, error: "Choose a valid assistant mode." };
    return { ok: true, value: { action: "set_automation", mode } };
  }
  if (body.action === "schedule_follow_up") {
    const message = text(body.message, 1000);
    const dueAt = text(body.dueAt, 40);
    const timestamp = Date.parse(dueAt);
    if (!message || !Number.isFinite(timestamp) || timestamp < Date.now() - 60000 || timestamp > Date.now() + 90 * 86400000) {
      return { ok: false, error: "Choose a valid follow-up message and a time within the next 90 days." };
    }
    return { ok: true, value: { action: "schedule_follow_up", message, dueAt: new Date(timestamp).toISOString() } };
  }
  if (body.action === "cancel_follow_ups") return { ok: true, value: { action: "cancel_follow_ups" } };
  if (body.action === "start_nurture") return { ok: true, value: { action: "start_nurture" } };
  if (body.action === "delete_lead") {
    const reason = text(body.reason, 300);
    if (!reason) return { ok: false, error: "Add a deletion reason between 1 and 300 characters." };
    return { ok: true, value: { action: "delete_lead", reason } };
  }
  return { ok: false, error: "That YardOps assistant action is not supported." };
}

export function validateAutomationSettings(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const start = String(body.quietHoursStart || "");
  const end = String(body.quietHoursEnd || "");
  const maxTouches = Number(body.maxFollowUpTouches);
  if (!TIME.test(start) || !TIME.test(end) || !Number.isInteger(maxTouches) || maxTouches < 0 || maxTouches > 6) {
    return { ok: false, error: "Choose valid quiet hours and zero to six follow-up touches." };
  }
  return { ok: true, value: {
    assistantEnabled: body.assistantEnabled === true,
    quietHoursEnabled: body.quietHoursEnabled !== false,
    quietHoursStart: start,
    quietHoursEnd: end,
    maxFollowUpTouches: maxTouches,
    humanReviewRequired: body.humanReviewRequired !== false,
  } };
}

export function validateAnswerEntry(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." };
  const answerKey = String(body.answerKey || "").trim().toLowerCase();
  const category = text(body.category, 60);
  const question = text(body.question, 240);
  const answer = text(body.answer, 2000);
  const keywords = Array.isArray(body.keywords)
    ? [...new Set(body.keywords.map((value) => text(value, 60)).filter(Boolean))].slice(0, 20)
    : [];
  const responseMode = ["static", "pricing", "service_day", "handoff"].includes(body.responseMode) ? body.responseMode : "static";
  if (!/^[a-z0-9][a-z0-9_-]{2,59}$/.test(answerKey) || !category || !question || !answer || !keywords.length) {
    return { ok: false, error: "Add a valid key, category, question, answer, and at least one keyword." };
  }
  return { ok: true, value: { answerKey, category, question, answer, keywords, responseMode, autoSendAllowed: body.autoSendAllowed === true } };
}

export function findAnswerMatch(message, answers) {
  const haystack = String(message || "").toLowerCase();
  if (!haystack) return null;
  let best = null;
  for (const answer of answers || []) {
    let keywords = [];
    try { keywords = JSON.parse(answer.keywords || "[]"); } catch { keywords = []; }
    const score = keywords.reduce((total, keyword) => total + (haystack.includes(String(keyword).toLowerCase()) ? String(keyword).length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { ...answer, score };
  }
  return best;
}

export function isStopMessage(message) {
  return /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(String(message || "").trim());
}

export function shouldMarkNotQualifiedForNoResponse({ settings, lead, finalFollowUp, now = Date.now() } = {}) {
  const maxTouches = Number(settings?.maxFollowUpTouches);
  const finalSentAt = Date.parse(finalFollowUp?.sentAt || "");
  const lastInboundAt = Date.parse(lead?.lastInboundAt || "");
  const openStage = ["new", "contacted", "qualified", "quoted"].includes(lead?.stage);
  return Boolean(
    settings?.assistantEnabled
    && !settings?.humanReviewRequired
    && lead?.automationMode === "approved"
    && lead?.conversationStatus === "waiting"
    && openStage
    && Number.isInteger(maxTouches)
    && maxTouches > 0
    && Number(finalFollowUp?.sequenceStep) >= maxTouches
    && Number.isFinite(finalSentAt)
    && finalSentAt <= Number(now) - NO_RESPONSE_GRACE_HOURS * 3600000
    && (!Number.isFinite(lastInboundAt) || lastInboundAt <= finalSentAt)
    && !lead?.hasPendingFollowUps
  );
}
