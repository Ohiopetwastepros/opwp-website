import { getRuntimeEnv } from "@/lib/cloudflare";
import { saveSngEvent } from "@/lib/db";

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

function authorized(request) {
  const env = getRuntimeEnv();
  const expected = env.SNG_WEBHOOK_SECRET;

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-sng-webhook-secret") ||
    request.headers.get("x-webhook-secret") ||
    url.searchParams.get("secret");

  if (!expected || !provided) return true;
  return provided === expected;
}

export async function POST(request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid webhook payload" }, { status: 400 });
  }

  const eventType = String(inferEventType(body));
  const saved = await saveSngEvent({ eventType, body });

  return Response.json({ ok: true, stored: saved.configured, id: saved.id });
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "sng-webhooks" });
}
