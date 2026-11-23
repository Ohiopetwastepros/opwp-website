import { normalizePhone } from "./lead-assistant.mjs";

const ids = value => String(value || "").split(",").map(x => x.trim()).filter(Boolean);

export function quoLearningScope(env, event) {
  const business = normalizePhone(env.QUO_FROM_NUMBER);
  const line = normalizePhone(event.direction === "outbound" ? event.from : event.to);
  const allowed = new Set([business, ...ids(env.QUO_LEARNING_NUMBERS).map(normalizePhone)].filter(Boolean));
  return { allowed: Boolean(line && allowed.has(line)), learningOnly: line !== business, line };
}

export function isQuoSonaAuthor(event, env) {
  const types = [event.authorType, ...(Array.isArray(event.authorTypes) ? event.authorTypes : [])].filter(Boolean);
  const userIds = [event.userId, ...(Array.isArray(event.userIds) ? event.userIds : [])].filter(Boolean);
  return types.some(value => /^(sona|ai|automation|ai_agent|assistant|aiagent|sona_ai|automated)$/i.test(String(value))) || userIds.some(value => ids(env.QUO_SONA_USER_IDS).includes(value));
}
export function resolveQuoAuthor(event, env, { approvedDraft = false, knownBackend = false } = {}) {
  if (event.direction === "inbound") return "lead";
  if (isQuoSonaAuthor(event, env)) return "sona";
  if (approvedDraft || knownBackend) return "backend";
  if (event.userId && ids(env.QUO_HUMAN_USER_IDS).includes(event.userId)) return "craig";
  return "sona";
}

export function ownerAfterOutbound(owner, author, { matchesPendingDraft = false } = {}) {
  if (author === "sona") return "sona";
  if (author === "craig" && !matchesPendingDraft) return "craig";
  return owner;
}

// Messenger and Instagram are intentionally record-only. Ignore attachments and
// delivery/read receipts; neither can generate a sales reply.
export function normalizeMetaLearningEvents(body, env) {
  const allowedPages = new Set(ids(env.META_ALLOWED_PAGE_IDS));
  const allowedIg = new Set(ids(env.META_ALLOWED_INSTAGRAM_IDS));
  const output = [];
  if (!["page", "instagram"].includes(body?.object)) return output;
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const account = String(entry.id || "");
    const kind = body.object === "instagram" ? "meta_instagram" : "meta_messenger";
    if (!(kind === "meta_instagram" ? allowedIg : allowedPages).has(account)) {
      if ((entry.messaging || []).some(x => x.message?.text)) throw new Error("Meta learning account is not authorized.");
      continue;
    }
    for (const item of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const message = item.message;
      if (!message?.mid || typeof message.text !== "string" || !message.text.trim()) continue;
      const outgoing = message.is_echo === true;
      if (String(outgoing ? item.sender?.id : item.recipient?.id) !== account) throw new Error("Meta learning recipient mismatch.");
      const participant = String(outgoing ? item.recipient?.id : item.sender?.id || "");
      if (!participant || participant.length > 160) continue;
      const time = new Date(Number(item.timestamp));
      if (!Number.isFinite(time.getTime())) continue;
      output.push({ kind, account, participant, providerMessageId: String(message.mid).slice(0, 160), direction: outgoing ? "outbound" : "inbound", author: outgoing ? "sona" : "lead", text: message.text.slice(0, 4000), createdAt: time.toISOString() });
    }
  }
  return output;
}
