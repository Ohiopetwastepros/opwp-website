import { verifyAdminRequest } from "@/lib/admin-auth";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { dismissFailedPaymentSmsBatch, sendFailedPaymentSmsBatch, listFailedPaymentSms } from "@/lib/failed-payment-sms";
import { readBoundedBytes } from '@/lib/bounded-body.mjs';
import { runFailedPaymentRecovery } from '@/lib/failed-payment-reconciliation';
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

async function boundedJson(request) {
  try { return JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,4096))); } catch { return null; }
}

function errorFor(code) {
  if (code === "QUO_UNAVAILABLE") return [503, "Quo messaging is not configured."];
  if (code === "DATABASE_UNAVAILABLE") return [503, "The approval queue is unavailable."];
  if (code === "DAILY_LIMIT") return [429, "The daily failed-payment messaging limit would be exceeded."];
  return [400, "Select between 1 and 25 valid pending messages."];
}

export async function POST(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  if(request.headers.get('origin')!==new URL(request.url).origin) return Response.json({ok:false,error:'Cross-site request rejected'},{status:403,headers:responseHeaders});

  const rate = await checkRateLimit(request, {
    scope: `admin_failed_payment_sms:${auth.email}`,
    limit: 6,
    windowSeconds: 600,
    failClosed: true,
  });
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await boundedJson(request);
  const action = String(body?.action || "");
  const ids = body?.ids;
  if (!body || !["send", "dismiss", "refresh"].includes(action)) {
    return Response.json({ ok: false, error: "That bulk action is not valid." }, { status: 400, headers: responseHeaders });
  }

  try {
    if(action==='refresh') {
      const recovery=await runFailedPaymentRecovery(getRuntimeEnv());
      return Response.json({ok:true,recovery,...await listFailedPaymentSms(getDb())},{headers:responseHeaders});
    }
    const result = action === "send"
      ? await sendFailedPaymentSmsBatch({ env: getRuntimeEnv(), ids, actor: auth.email })
      : await dismissFailedPaymentSmsBatch({ db: getDb(), ids, actor: auth.email });
    if (!result.ok) {
      const [status, error] = errorFor(result.code);
      return Response.json({ ok: false, error, remaining: result.remaining }, { status, headers: responseHeaders });
    }
    console.info(JSON.stringify({
      event: action === "send" ? "failed_payment_sms_bulk_sent" : "failed_payment_sms_bulk_dismissed",
      actor: auth.email,
      selected: Array.isArray(ids) ? ids.length : 0,
      sent: result.sent || 0,
      failed: result.failed || 0,
      dismissed: result.dismissed || 0,
    }));
    return Response.json({ ok: true, action, ...result, ...await listFailedPaymentSms(getDb()) }, { headers: responseHeaders });
  } catch (error) {
    console.error(JSON.stringify({
      event: "failed_payment_sms_bulk_action_failed",
      actor: auth.email,
      action,
      message: error instanceof Error ? error.message : "failed",
    }));
    return Response.json({ ok: false, error: "The selected messages could not be processed." }, { status: 500, headers: responseHeaders });
  }
}
