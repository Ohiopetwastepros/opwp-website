import { getRuntimeEnv } from "@/lib/cloudflare";
import { saveSngEvent } from "@/lib/db";
import { processSngEvent, recoverFailedSngEvents } from "@/lib/sng-event-processor";
import { authenticateSngWebhook, validateSngWebhookBody } from "@/lib/sng-webhook-security.mjs";

export const dynamic = "force-dynamic";
const MAX_WEBHOOK_BYTES = 512 * 1024;

export async function POST(request) {
  const auth = authenticateSngWebhook(request, getRuntimeEnv());
  if (!auth.configured && !auth.localSmoke) {
    console.error(JSON.stringify({ event: "sng_webhook_rejected", reason: "secret_not_configured" }));
    return Response.json({ ok: false, error: "Webhook authentication is not configured." }, { status: 503 });
  }
  if (!auth.authorized) {
    console.warn(JSON.stringify({ event: "sng_webhook_rejected", reason: "invalid_or_missing_credential" }));
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return Response.json({ ok: false, error: "Webhook payload must be JSON." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ ok: false, error: "Webhook payload is too large." }, { status: 413 });
  }
  const payload = await request.arrayBuffer();
  if (payload.byteLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ ok: false, error: "Webhook payload is too large." }, { status: 413 });
  }
  let body = null;
  try {
    body = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    // Handled by the validation response below.
  }
  const validation = validateSngWebhookBody(body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400 });

  try {
    const eventType = validation.eventType;
    const saved = await saveSngEvent({ eventType, body });
    const data = body?.data && typeof body.data === "object" ? body.data : body;
    const externalId = body?.id ?? body?.event_id ?? data?.job_id ?? data?.invoice_id ?? data?.shift_id ?? data?.client_id ?? data?.lead_id ?? data?.id;
    const processing = saved.configured
      ? await processSngEvent({ id: saved.id, eventType, externalId, body, allowFinancialMutation: auth.verified || auth.localSmoke })
      : { processed: false, error: "D1 is not configured." };
    const recovery = saved.configured
      ? await recoverFailedSngEvents({ limit: 5, excludeId: saved.id })
      : { attempted: 0, recovered: 0, remaining: 0 };
    console.info(JSON.stringify({ event: "sng_webhook_processed", eventType, eventId: saved.id, stored: saved.configured, verified: auth.verified }));
    return Response.json({ ok: true, stored: saved.configured, id: saved.id, processing, recovery });
  } catch (error) {
    console.error(JSON.stringify({ event: "sng_webhook_failed", classification: "processing", message: error instanceof Error ? error.message : "failed" }));
    return Response.json({ ok: false, error: "Webhook processing failed." }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "sng-webhooks" });
}
