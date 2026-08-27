import { getRuntimeEnv } from "./cloudflare";
import { isProductionEnvironment } from "./app-config";
import { checkRateLimit, rateLimitResponse } from "./rate-limit";
import { outboundFetch } from "./outbound-request";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function errorResponse(error, status) {
  return Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readBoundedJson(request, maxBytes) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return { response: errorResponse("Send this request as JSON.", 415) };
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) return { response: errorResponse("Request is too large.", 413) };
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) return { response: errorResponse("Request is too large.", 413) };
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return { body };
  } catch {
    return { response: errorResponse("Invalid request.", 400) };
  }
}

export async function verifyTurnstile(request, token, expectedAction = "") {
  const env = getRuntimeEnv();
  const production = isProductionEnvironment(env);
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
  if (!production && localHost && env.PUBLIC_API_DEV_BYPASS === "true" && request.headers.get("x-opwp-local-smoke") === "true") {
    return { ok: true, bypassed: true };
  }
  const expectedHostnames = new Set(String(env.TURNSTILE_HOSTNAMES || "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean));
  if (!env.TURNSTILE_SECRET_KEY || !expectedAction || expectedHostnames.size === 0) return { ok: false, unavailable: true };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false };
  try {
    const remoteip = request.headers.get("cf-connecting-ip") || undefined;
    const response = await outboundFetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip, idempotency_key: crypto.randomUUID() }),
    }, { provider: "cloudflare_turnstile", operation: "siteverify", timeoutMs: 8000 });
    const result = await response.json().catch(() => ({}));
    const actionMatches = result.action === expectedAction;
    const hostnameMatches = typeof result.hostname === "string" && expectedHostnames.has(result.hostname.toLowerCase());
    return { ok: response.ok && result.success === true && actionMatches && hostnameMatches };
  } catch {
    return { ok: false, unavailable: true };
  }
}

export async function protectJsonRequest(request, options) {
  const rate = await checkRateLimit(request, {
    scope: options.scope,
    limit: options.limit,
    windowSeconds: options.windowSeconds,
    failClosed: options.failClosed !== false,
  });
  if (!rate.allowed) return { response: rate.unavailable ? errorResponse("Service protection is temporarily unavailable. Please try again.", 503) : rateLimitResponse(rate) };
  const parsed = await readBoundedJson(request, options.maxBytes);
  if (parsed.response) return parsed;
  if (options.turnstile) {
    const verification = await verifyTurnstile(request, parsed.body.turnstileToken, options.action || "");
    if (!verification.ok) {
      return { response: errorResponse(verification.unavailable ? "Verification is temporarily unavailable. Please try again." : "Please complete the verification and try again.", verification.unavailable ? 503 : 403) };
    }
  }
  delete parsed.body.turnstileToken;
  return parsed;
}
