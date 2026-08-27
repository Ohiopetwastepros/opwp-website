import { verifyAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getQuickBooksCleanupDataset } from "@/lib/quickbooks-cleanup";
import { safeExportName } from "@/lib/quickbooks-cleanup-logic.mjs";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  }

  const rate = await checkRateLimit(request, {
    scope: `admin_qbo_cleanup:${auth.email}`,
    limit: 12,
    windowSeconds: 600,
  });
  if (!rate.configured) {
    return Response.json({ ok: false, error: "Cleanup export controls are unavailable." }, { status: 503, headers: responseHeaders });
  }
  if (!rate.allowed) return rateLimitResponse(rate);

  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset") || "ar";
  const start = url.searchParams.get("start") || "2025-01-01";
  const end = url.searchParams.get("end") || today();
  const entity = url.searchParams.get("entity") || "";
  const reportName = url.searchParams.get("report") || "";
  const accountingMethod = url.searchParams.get("accounting_method") || "Accrual";
  const requestId = crypto.randomUUID();

  try {
    const data = await getQuickBooksCleanupDataset({
      dataset,
      start,
      end,
      entity,
      reportName,
      accountingMethod,
    });
    console.log(JSON.stringify({
      event: "quickbooks_cleanup_exported",
      request_id: requestId,
      actor: auth.email,
      dataset,
      entity: entity || null,
      report: reportName || null,
      start,
      end,
    }));
    return new Response(JSON.stringify({ ok: true, requestId, ...data }), {
      status: 200,
      headers: {
        ...responseHeaders,
        "Content-Disposition": `attachment; filename="${safeExportName(dataset, start, end)}"`,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "quickbooks_cleanup_export_failed",
      request_id: requestId,
      actor: auth.email,
      dataset,
      message: error instanceof Error ? error.message : "failed",
    }));
    return Response.json(
      { ok: false, error: "The read-only QuickBooks export could not be completed.", requestId },
      { status: 400, headers: responseHeaders },
    );
  }
}
