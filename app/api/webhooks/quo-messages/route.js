import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { recordInboundQuoMessage } from "@/lib/lead-assistant";
import { normalizeQuoMessageEvent, verifyQuoSignature } from "@/lib/quo-webhook.mjs";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { OPWP_ORGANIZATION_ID } from "@/lib/route-partner";
import { normalizePhone } from "@/lib/lead-assistant.mjs";
import { readBoundedBytes } from "@/lib/bounded-body.mjs";
import { recordQuoDelivery, processMetaConfirmations } from "@/lib/meta-lead-workflow.mjs";
import { recordFoodCollectionReply, processFoodCollectionReplies, recordFoodCollectionDelivery } from "@/lib/dog-food-collections";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { playbookEnabled } from "@/lib/lead-playbook.mjs";
import { quoLearningScope } from "@/lib/playbook-ownership.mjs";
import { recordPlaybookQuoEvent } from "@/lib/lead-playbook-ingest";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request) {
  const env = getRuntimeEnv();
  if (!env.QUO_WEBHOOK_SIGNING_KEY) return Response.json({ ok: false, error: "Quo webhook security is not configured." }, { status: 503, headers: responseHeaders });
  const rate = await checkRateLimit(request, { scope: "webhook_quo_messages", limit: 300, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Request is too large." }, { status: 413, headers: responseHeaders });
  let raw;
  try { raw = await readBoundedBytes(request, MAX_BODY_BYTES); } catch { return Response.json({ ok: false, error: "Request is too large." }, { status: 413, headers: responseHeaders }); }
  const rawText = new TextDecoder().decode(raw);
  if (!await verifyQuoSignature(rawText, request.headers.get("openphone-signature"), env.QUO_WEBHOOK_SIGNING_KEY)) return Response.json({ ok: false, error: "Invalid signature." }, { status: 401, headers: responseHeaders });
  let body;
  try { body = JSON.parse(rawText); } catch { return Response.json({ ok: false, error: "Invalid request." }, { status: 400, headers: responseHeaders }); }
  const event = normalizeQuoMessageEvent(body);
  const delivery = ["message.delivered", "message.failed"].includes(body?.type) && body?.data?.object?.direction === "outgoing";
  if (!event && !delivery) return Response.json({ ok: true, accepted: 0 }, { headers: responseHeaders });
  const configuredNumber = normalizePhone(env.QUO_FROM_NUMBER);
  const scopedNumber = normalizePhone(event ? event.direction === "outbound" ? event.from : event.to : body.data.object.from);
  const scope = playbookEnabled(env) && event ? quoLearningScope(env, event) : { allowed: scopedNumber === configuredNumber, learningOnly: false };
  if (!configuredNumber || !scope.allowed || (scopedNumber !== configuredNumber && !scope.learningOnly)) return Response.json({ ok: false, error: "Phone scope mismatch." }, { status: 403, headers: responseHeaders });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Storage is unavailable." }, { status: 503, headers: responseHeaders });
  if (event?.isGroup && playbookEnabled(env)) return Response.json({ ok: true, accepted: 0, ignoredReason: "group_thread" }, { headers: responseHeaders });
  if (delivery) {
    if (!scope.learningOnly) {
      await recordQuoDelivery(db, body);
      await recordFoodCollectionDelivery(db, body);
    }
    if (event && playbookEnabled(env)) await recordPlaybookQuoEvent(db, env, event);
    return Response.json({ ok: true, accepted: 1 }, { headers: responseHeaders });
  }
  if (scope.learningOnly) {
    await recordPlaybookQuoEvent(db, env, event);
    return Response.json({ ok: true, accepted: 1, learningOnly: true }, { headers: responseHeaders });
  }
  // Staff reports are scoped to the verified staff phone and signed OPWP inbox.
  // They must never enter prospect intake or trigger customer auto-replies.
  const staffResult = await recordFoodCollectionReply({ ...env, DB: db }, { ...event, isGroup: Array.isArray(body.data.object.to) && body.data.object.to.length !== 1 });
  if (staffResult.handled) {
    if (staffResult.queued) getCloudflareContext().ctx.waitUntil(processFoodCollectionReplies({ ...env, DB: db }, { limit: 1 }).catch(() => ({ failed: true })));
    return Response.json({ ok: true, accepted: staffResult.duplicate ? 0 : 1, staffCollection: true }, { headers: responseHeaders });
  }
  const claim = await db.prepare(`INSERT INTO lead_webhook_events (provider,event_id,organization_id,status)
    VALUES ('quo',?,?,'received')
    ON CONFLICT(provider,event_id) DO UPDATE SET status='received',received_at=CURRENT_TIMESTAMP,error_message=NULL,processed_at=NULL
    WHERE lead_webhook_events.status='failed' OR (lead_webhook_events.status='received' AND lead_webhook_events.received_at<datetime('now','-5 minutes'))`).bind(event.eventId, OPWP_ORGANIZATION_ID).run();
  if (!Number(claim.meta?.changes || 0)) {
    const receipt = await db.prepare(`SELECT status FROM lead_webhook_events WHERE provider='quo' AND event_id=? AND organization_id=?`).bind(event.eventId, OPWP_ORGANIZATION_ID).first();
    if (receipt?.status !== "processed") return Response.json({ ok: false, error: "Message processing is pending; retry delivery." }, { status: 503, headers: { ...responseHeaders, "Retry-After": "60" } });
    return Response.json({ ok: true, accepted: 0, duplicate: true }, { headers: responseHeaders });
  }
  try {
    const result = await recordInboundQuoMessage(db, env, event);
    if (playbookEnabled(env)) await recordPlaybookQuoEvent(db, env, event);
    if (result.submissionId && !playbookEnabled(env)) await processMetaConfirmations({ ...env, DB: db }, { submissionId: result.submissionId, limit: 1 });
    await db.prepare(`UPDATE lead_webhook_events SET status='processed',processed_at=CURRENT_TIMESTAMP WHERE provider='quo' AND event_id=?`).bind(event.eventId).run();
    return Response.json({ ok: true, accepted: 1, leadCreated: result.leadCreated, ignoredReason: result.ignoredReason || null, autoReplied: result.autoReplied }, { headers: responseHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quo message processing failed.";
    await db.prepare(`UPDATE lead_webhook_events SET status='failed',error_message=?,processed_at=CURRENT_TIMESTAMP WHERE provider='quo' AND event_id=?`).bind(message.slice(0, 500), event.eventId).run();
    console.error(JSON.stringify({ event: "quo_message_processing_failed", eventId: event.eventId, message }));
    return Response.json({ ok: false, error: "Quo message processing failed." }, { status: 503, headers: responseHeaders });
  }
}
