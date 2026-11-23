const encoder = new TextEncoder();

function base64Bytes(value) {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch { return null; }
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(keyBytes, value) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function verifyQuoSignature(rawText, header, signingKey, now = Date.now()) {
  if (!signingKey || typeof header !== "string") return false;
  const keyBytes = base64Bytes(signingKey);
  if (!keyBytes?.length) return false;
  let canonical = rawText;
  try { canonical = JSON.stringify(JSON.parse(rawText)); } catch { return false; }
  for (const signature of header.split(",")) {
    const [scheme, version, timestamp, digest, extra] = signature.trim().split(";");
    if (scheme !== "hmac" || version !== "1" || !/^\d{10,16}$/.test(timestamp) || !digest || extra) continue;
    const timestampMs = Number(timestamp) < 10_000_000_000 ? Number(timestamp) * 1000 : Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) continue;
    const supplied = base64Bytes(digest);
    if (!supplied) continue;
    const candidates = rawText === canonical ? [rawText] : [rawText, canonical];
    for (const candidate of candidates) if (constantTimeEqual(await hmac(keyBytes, `${timestamp}.${candidate}`), supplied)) return true;
  }
  return false;
}

export function normalizeQuoMessageEvent(body) {
  const message = body?.data?.object;
  const eventId = typeof body?.id === "string" ? body.id.slice(0, 120) : "";
  const providerMessageId = typeof message?.id === "string" ? message.id.slice(0, 120) : "";
  const caption = String(message?.text ?? message?.body ?? "").trim().slice(0, 4000);
  const media = Array.isArray(message?.media) ? message.media : message?.attachments;
  const hasPhoto = Array.isArray(media) && media.slice(0, 20).some(item => /^image(?:\/|$)/i.test(String(item?.type || item?.contentType || item?.mimeType || "")));
  const text = caption || (hasPhoto ? "[Photo]" : "");
  const incoming = body?.type === "message.received" && message?.direction === "incoming";
  const outgoing = body?.type === "message.delivered" && message?.direction === "outgoing";
  if ((!incoming && !outgoing) || !eventId || !providerMessageId || !text) return null;
  const userIds = [...new Set([message.userId, message.createdByUserId, message.createdBy?.id, typeof message.createdBy === "string" ? message.createdBy : ""].filter(value => typeof value === "string" && value).map(value => value.slice(0, 120)))];
  const authorTypes = [...new Set([message.authorType, message.createdBy?.type, message.author?.type, message.source].filter(value => typeof value === "string" && value).map(value => value.slice(0, 80)))];
  return { eventId, providerMessageId, direction: incoming ? "inbound" : "outbound", from: String(message.from || "").slice(0, 40), to: Array.isArray(message.to) ? String(message.to[0] || "").slice(0, 40) : String(message.to || "").slice(0, 40), text, ...(hasPhoto ? {hasPhoto: true} : {}), conversationId: String(message.conversationId || "").slice(0, 120), createdAt: String(message.createdAt || body.createdAt || "").slice(0, 60), phoneNumberId: String(message.phoneNumberId || "").slice(0, 120), isGroup: Array.isArray(message.to) && message.to.length !== 1,
    // IDs alone are not evidence of a human author. Explicitly reviewed IDs are
    // configured privately; unrecognized senders remain Sona-owned.
    userId: userIds[0] || "", userIds, authorType: authorTypes[0] || "", authorTypes };
}
