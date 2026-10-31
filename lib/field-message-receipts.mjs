import { normalizePhone } from "./field-workday-store.mjs";
export async function recordFieldMessageReceipt(db, body, fromNumber) {
  const id = body?.id,
    object = body?.data?.object,
    type = body?.type;
  if (typeof id !== "string" || id.length > 160 || !object)
    return { handled: false };
  const outgoing =
    ["message.delivered", "message.failed"].includes(type) &&
    object.direction === "outgoing";
  const incoming =
    type === "message.received" && object.direction === "incoming";
  if (!outgoing && !incoming) return { handled: false };
  const scope = normalizePhone(
    outgoing
      ? object.from
      : Array.isArray(object.to) && object.to.length === 1
        ? object.to[0]
        : "",
  );
  if (!scope || scope !== normalizePhone(fromNumber)) return { handled: false };
  const stamp = String(object.createdAt || body.createdAt || ""),
    at = Date.parse(stamp);
  if (!Number.isFinite(at) || at > Date.now() + 120000)
    return { handled: false };
  const receipt = db
    .prepare(
      "INSERT INTO field_message_receipts(id) VALUES (?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(id);
  if (outgoing) {
    const providerId = object.id,
      status = type === "message.delivered" ? "delivered" : "failed";
    if (
      typeof providerId !== "string" ||
      !providerId ||
      providerId.length > 160
    )
      return { handled: false };
    await db.batch([
      receipt,
      db
        .prepare(
          "INSERT INTO field_message_delivery_receipts(provider_id,status,occurred_at) VALUES (?,?,?) ON CONFLICT(provider_id) DO UPDATE SET status=excluded.status,occurred_at=excluded.occurred_at WHERE field_message_delivery_receipts.status<>'delivered' AND (excluded.status='delivered' OR excluded.occurred_at>=field_message_delivery_receipts.occurred_at)",
        )
        .bind(providerId, status, new Date(at).toISOString()),
      db
        .prepare(
          "UPDATE field_workday_messages SET status=(SELECT status FROM field_message_delivery_receipts WHERE provider_id=?),detail=?,updated_at=CURRENT_TIMESTAMP WHERE provider_id=? AND status<>'delivered'",
        )
        .bind(
          providerId,
          status === "delivered"
            ? "Provider delivery receipt confirmed."
            : "Provider reported failed delivery. Office review required.",
          providerId,
        ),
    ]);
    return { handled: true };
  }
  const phone = normalizePhone(object.from),
    text = String(object.text || object.body || "")
      .trim()
      .slice(0, 2000),
    upper = text.toUpperCase();
  if (!phone || !text) return { handled: false };
  if (
    [
      "STOP",
      "UNSUBSCRIBE",
      "CANCEL",
      "END",
      "QUIT",
      "START",
      "UNSTOP",
    ].includes(upper)
  ) {
    await db.batch([
      receipt,
      db
        .prepare(
          "INSERT INTO field_message_suppression(phone,updated_at,last_event_at,suppressed) VALUES (?,?,?,?) ON CONFLICT(phone) DO UPDATE SET updated_at=excluded.updated_at,last_event_at=excluded.last_event_at,suppressed=excluded.suppressed WHERE excluded.last_event_at>=field_message_suppression.last_event_at",
        )
        .bind(
          phone,
          new Date().toISOString(),
          new Date(at).toISOString(),
          Number(!["START", "UNSTOP"].includes(upper)),
        ),
    ]);
    return { handled: true };
  }
  const candidates = await db
    .prepare(
      "SELECT n.shift_id,n.stop_id,w.state_json FROM field_workday_messages n JOIN field_workdays w ON w.shift_id=n.shift_id JOIN route_partner_field_shifts s ON s.id=n.shift_id WHERE n.recipient=? AND n.created_at>datetime('now','-12 hours') AND s.status='in_progress' AND n.organization_id='org-opwp' GROUP BY n.shift_id,n.stop_id LIMIT 3",
    )
    .bind(phone)
    .all();
  if (candidates.results.length !== 1) return { handled: false };
  const row = candidates.results[0],
    unsafe =
      /\b(dog|dogs|pet|pets|cat|cats)\b/i.test(text) &&
      /\b(loose|outside|unsafe|not|cannot|can't|unsure|maybe)\b/i.test(text);
  // A free-form SMS can raise a safety hold; it never grants entry permission.
  const payload = unsafe
    ? {
        stopId: row.stop_id,
        safe: false,
        reason: `Customer safety concern: ${text}`,
      }
    : {
        stopId: row.stop_id,
        text,
        reason: "Customer reply requires office review",
      };
  await db.batch([
    receipt,
    db
      .prepare(
        "INSERT INTO field_dispatch_changes(id,organization_id,shift_id,kind,payload,created_by) VALUES (?,'org-opwp',?,?,?,'signed_quo_customer_reply') ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        `quo:${id}`,
        row.shift_id,
        unsafe ? "safety" : "response",
        JSON.stringify({ ...payload, customerReply: true }),
      ),
  ]);
  return { handled: true, unsafe };
}
