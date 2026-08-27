import { getDb } from "./db";

const encoder = new TextEncoder();

function clientAddress(request) {
  return request.headers.get("cf-connecting-ip")
    || "unknown";
}

async function clientKey(request) {
  const fingerprint = `${clientAddress(request)}|${String(request.headers.get("user-agent") || "unknown").slice(0, 200)}`;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(fingerprint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkRateLimit(request, { scope, limit, windowSeconds, failClosed = false }) {
  const db = getDb();
  if (!db) return { allowed: !failClosed, configured: false, unavailable: failClosed, remaining: null, retryAfter: 0 };

  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  try {
    const row = await db.prepare(
      `INSERT INTO api_rate_limits (scope,client_key,window_start,request_count,expires_at)
       VALUES (?,?,?,1,datetime(?,'unixepoch'))
       ON CONFLICT(scope,client_key,window_start)
       DO UPDATE SET request_count=request_count+1
       RETURNING request_count`
    ).bind(scope, await clientKey(request), windowStart, windowStart + (windowSeconds * 2)).first();
    const count = Number(row?.request_count || 1);

    const sample = new Uint8Array(1);
    crypto.getRandomValues(sample);
    if (sample[0] === 0) {
      try { await db.prepare("DELETE FROM api_rate_limits WHERE expires_at<CURRENT_TIMESTAMP").run(); }
      catch { /* Cleanup is best-effort and must not discard a successful limit check. */ }
    }

    return {
      allowed: count <= limit,
      configured: true,
      remaining: Math.max(0, limit - count),
      retryAfter: Math.max(1, windowStart + windowSeconds - now),
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: "rate_limit_check_failed",
      scope,
      message: error instanceof Error ? error.message : "failed",
    }));
    return { allowed: !failClosed, configured: false, unavailable: failClosed, remaining: null, retryAfter: 0 };
  }
}

export function rateLimitResponse(result) {
  if (result.unavailable) {
    return Response.json(
      { ok: false, error: "Service protection is temporarily unavailable. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { ok: false, error: "Too many requests. Please wait and try again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfter),
      },
    },
  );
}
