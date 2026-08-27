import { createHash, timingSafeEqual } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function constantTimeSecretMatch(expected, provided) {
  if (typeof expected !== "string" || !expected || typeof provided !== "string" || !provided) return false;
  const left = createHash("sha256").update(expected, "utf8").digest();
  const right = createHash("sha256").update(provided, "utf8").digest();
  return timingSafeEqual(left, right);
}

export function authenticateSngWebhook(request, env = {}, nodeEnv = process.env.NODE_ENV) {
  const url = new URL(request.url);
  const expected = String(env.SNG_WEBHOOK_SECRET || "");
  const provided = request.headers.get("x-sng-webhook-secret")
    || request.headers.get("x-webhook-secret")
    || url.searchParams.get("secret")
    || "";
  const localSmoke = nodeEnv !== "production"
    && env.ADMIN_DEV_BYPASS === "true"
    && LOCAL_HOSTS.has(url.hostname)
    && request.headers.get("x-opwp-local-smoke") === "true";
  const verified = constantTimeSecretMatch(expected, provided);
  return { configured: Boolean(expected), authorized: verified || localSmoke, verified, localSmoke };
}

export function validateSngWebhookBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid webhook payload" };
  const eventType = body.event || body.event_type || body.type || body.webhook_event || body.trigger || body.name || "unknown";
  if (typeof eventType !== "string" || !eventType.trim() || eventType.length > 128) return { ok: false, error: "Invalid webhook event type" };
  if (body.data !== undefined && (!body.data || typeof body.data !== "object" || Array.isArray(body.data))) {
    return { ok: false, error: "Invalid webhook event data" };
  }
  return { ok: true, eventType: eventType.trim() };
}
