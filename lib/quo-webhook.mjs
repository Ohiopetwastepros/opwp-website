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

export async function verifyQuoStandardSignature(rawText,headers,signingKey,now=Date.now()) {
  const id=headers.get('webhook-id'),timestamp=headers.get('webhook-timestamp'),signatures=headers.get('webhook-signature');
  if(!id || id.length>200 || !/^\d{10}$/.test(timestamp||'') || !signatures || signatures.length>2048 || !signingKey)return false;
  if(Math.abs(now-Number(timestamp)*1000)>5*60000)return false;
  const keyBytes=base64Bytes(String(signingKey).replace(/^whsec_/,''));
  if(!keyBytes?.length)return false;
  const expected=await hmac(keyBytes,`${id}.${timestamp}.${rawText}`);
  for(const entry of signatures.split(/\s+/)) {
    const [version,digest,extra]=entry.split(',');
    const supplied=version==='v1'&&!extra?base64Bytes(digest):null;
    if(supplied&&constantTimeEqual(expected,supplied))return true;
  }
  return false;
}

// The date-versioned API moved participants into data.context. Convert only
// supported message events after signature verification; legacy consumers keep
// their existing scoped object shape, including the staff-message dispatcher.
export function normalizeQuoEnvelope(body) {
  if(body?.data?.object)return body;
  if(body?.apiVersion!=='2026-03-30' || !['message.received','message.delivered','message.failed','message.undelivered'].includes(body?.type))return body;
  const resource=body.data?.resource,context=body.data?.context;
  if(!resource || !context || typeof context.senderIdentifier!=='string' || !Array.isArray(context.recipientIdentifiers) || context.recipientIdentifiers.some(v=>typeof v!=='string'))return body;
  return {...body,type:body.type==='message.undelivered'?'message.failed':body.type,data:{...body.data,object:{...resource,
    from:context.senderIdentifier,to:context.recipientIdentifiers,conversationId:context.conversationId||'',phoneNumberId:context.phoneNumberId||''}}};
}

export function normalizeQuoMessageEvent(body) {
  body=normalizeQuoEnvelope(body);
  const message = body?.data?.object;
  const eventId = typeof body?.id === "string" ? body.id.slice(0, 120) : "";
  const providerMessageId = typeof message?.id === "string" ? message.id.slice(0, 120) : "";
  const text = String(message?.text ?? message?.body ?? "").trim().slice(0, 4000);
  if (body?.type !== "message.received" || message?.direction !== "incoming" || !eventId || !providerMessageId || !text) return null;
  return { eventId, providerMessageId, from: String(message.from || "").slice(0, 40), to: Array.isArray(message.to) ? String(message.to[0] || "").slice(0, 40) : String(message.to || "").slice(0, 40), text, conversationId: String(message.conversationId || "").slice(0, 120), createdAt: String(message.createdAt || body.createdAt || "").slice(0, 60) };
}
