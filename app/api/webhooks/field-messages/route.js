import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { verifyQuoSignature } from "@/lib/quo-webhook.mjs";
import { readBoundedBytes } from "@/lib/bounded-body.mjs";
import { recordFieldMessageReceipt } from "@/lib/field-message-receipts.mjs";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { workdayJson } from "@/lib/field-workday-http";
export const dynamic = "force-dynamic";
export async function POST(request) {
  const env = getRuntimeEnv();
  if (!env.FIELD_QUO_WEBHOOK_SIGNING_KEY)
    return workdayJson(
      { ok: false, error: "Field message verification is not configured." },
      503,
    );
  const rate = await checkRateLimit(request, {
    scope: "field_message_webhook",
    limit: 180,
    windowSeconds: 60,
    failClosed: true,
  });
  if (!rate.allowed) return rateLimitResponse(rate);
  let raw;
  try {
    raw = new TextDecoder().decode(await readBoundedBytes(request, 64 * 1024));
  } catch {
    return workdayJson({ ok: false, error: "Body is too large." }, 413);
  }
  if (
    !(await verifyQuoSignature(
      raw,
      request.headers.get("openphone-signature"),
      env.FIELD_QUO_WEBHOOK_SIGNING_KEY,
    ))
  )
    return workdayJson({ ok: false, error: "Invalid signature." }, 401);
  try {
    const db = getDb();
    if (!db)
      return workdayJson({ ok: false, error: "Storage unavailable." }, 503);
    const result = await recordFieldMessageReceipt(
      db,
      JSON.parse(raw),
      env.QUO_FROM_NUMBER,
    );
    return workdayJson({ ok: true, ...result });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "field_message_webhook_failed",
        error: error.message,
      }),
    );
    return workdayJson(
      { ok: false, error: "Receipt processing failed. Retry delivery." },
      503,
    );
  }
}
