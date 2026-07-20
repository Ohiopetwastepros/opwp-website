import { getRuntimeEnv } from "@/lib/cloudflare";
import { saveSngEvent } from "@/lib/db";
import { processSngEvent, recoverFailedSngEvents } from "@/lib/sng-event-processor";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

function inferEventType(body) {
  return (
    body?.event ||
    body?.event_type ||
    body?.type ||
    body?.webhook_event ||
    body?.trigger ||
    body?.name ||
    "unknown"
  );
}

function secretMatches(expected, provided) {
  if (!expected || !provided) return false;
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const providedBytes = encoder.encode(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

function authentication(request) {
  const env = getRuntimeEnv();
  const expected = env.SNG_WEBHOOK_SECRET;

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-sng-webhook-secret") ||
    request.headers.get("x-webhook-secret") ||
    url.searchParams.get("secret");

  const localSmoke = env.ADMIN_DEV_BYPASS === "true" && ["127.0.0.1", "localhost"].includes(url.hostname) && request.headers.get("x-opwp-local-smoke") === "true";
  const verifiedSecret = secretMatches(expected, provided);
  return {
    authorized: !expected || !provided || verifiedSecret,
    financialVerified: localSmoke || verifiedSecret,
  };
}

export async function POST(request) {
  const auth = authentication(request);
  if (!auth.authorized) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid webhook payload" }, { status: 400 });
  }

  const eventType = String(inferEventType(body));
  const saved = await saveSngEvent({ eventType, body });
  const data = body?.data && typeof body.data === "object" ? body.data : body;
  const externalId = body?.id ?? body?.event_id ?? data?.job_id ?? data?.invoice_id ?? data?.shift_id ?? data?.client_id ?? data?.lead_id ?? data?.id;
  const processing = saved.configured
    ? await processSngEvent({ id: saved.id, eventType, externalId, body, allowFinancialMutation: auth.financialVerified })
    : { processed: false, error: "D1 is not configured." };
  const recovery = saved.configured
    ? await recoverFailedSngEvents({ limit: 5, excludeId: saved.id })
    : { attempted: 0, recovered: 0, remaining: 0 };

  return Response.json({ ok: true, stored: saved.configured, id: saved.id, processing, recovery });
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "sng-webhooks" });
}
