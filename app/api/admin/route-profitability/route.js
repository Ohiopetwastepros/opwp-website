import { verifyAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getRouteProfitabilityData, refreshQuickBooksRouteCosts } from "@/lib/route-profitability";
import { refreshAirtableRouteProfitability } from "@/lib/airtable";
import { refreshCleanupBilling } from '@/lib/cleanup-work';

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

export async function GET(request) {
  if (!(await verifyAdminRequest(request.headers)).authorized) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  try { return Response.json({ ok: true, ...await getRouteProfitabilityData() }, { headers: responseHeaders }); }
  catch { return Response.json({ ok: false, error: "Route profitability is temporarily unavailable." }, { status: 503, headers: responseHeaders }); }
}

export async function POST(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Cross-site request blocked." }, { status: 403, headers: responseHeaders });
  // No request body or user-controlled provider query is accepted.
  // Workers may expose an empty stream even when the browser sends no body.
  if (request.body !== null) {
    const reader = request.body.getReader();
    try {
      const chunk = await reader.read();
      if (!chunk.done) {
        await reader.cancel();
        return Response.json({ error: "This refresh does not accept a request body." }, { status: 400, headers: responseHeaders });
      }
    } finally { reader.releaseLock(); }
  }
  const rate = await checkRateLimit(request, { scope: `route_profitability:${auth.email}`, limit: 2, windowSeconds: 600, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  const results = await Promise.allSettled([refreshAirtableRouteProfitability(), refreshQuickBooksRouteCosts({force:true}), refreshCleanupBilling({ force: true })]);
  results.forEach((result,index)=>{
    if(result.status==="rejected")console.error(JSON.stringify({event:"route_profitability_sync_failed",source:index===0?"history":index===1?"quickbooks":"cleanup_billing",message:String(result.reason?.message||"Sync failed").slice(0,300)}));
  });
  const warnings = results.flatMap((result, index) => result.status === "rejected" ? [index === 0 ? "Route history could not refresh. Previous records are retained." : index === 1 ? "QuickBooks cost sync could not complete. Check the financial connector; previous costs are retained." : "Cleanup invoice validation could not refresh. Previous QuickBooks evidence is retained."] : []);
  try { return Response.json({ ok: true, warnings, ...await getRouteProfitabilityData() }, { headers: responseHeaders }); }
  catch { return Response.json({ ok: false, error: "Route profitability could not be loaded." }, { status: 503, headers: responseHeaders }); }
}
