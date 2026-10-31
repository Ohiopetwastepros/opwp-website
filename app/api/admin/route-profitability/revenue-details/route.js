import { verifyAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getRouteRevenueDetail } from "@/lib/airtable";
import { ROUTE_REVENUE_CATEGORIES } from "@/lib/route-revenue.mjs";
import { ROUTE_DAYS, validRouteDate } from "@/lib/route-profitability-calculations.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
export async function GET(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const rate = await checkRateLimit(request, { scope: `route_revenue_detail:${auth.email}`, limit: 20, windowSeconds: 600, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "", through = url.searchParams.get("through") || "";
  const category = url.searchParams.get("category") || "", weekday = url.searchParams.get("weekday") || "All days";
  const technician = url.searchParams.get("technician") || "";
  if (technician.length > 100 || /[\x00-\x1f\x7f]/.test(technician)) return Response.json({ error: "Invalid technician filter." }, { status: 400, headers });
  if ((category && !Object.hasOwn(ROUTE_REVENUE_CATEGORIES, category)) || (weekday !== "All days" && !ROUTE_DAYS.includes(weekday))) return Response.json({ error: "Invalid service filter." }, { status: 400, headers });
  if (!validRouteDate(from) || !validRouteDate(through) || from > through) return Response.json({ error: "Invalid reporting range." }, { status: 400, headers });
  if ((Date.parse(through) - Date.parse(from)) / 86400000 > 399) return Response.json({ error: "Reporting range is too large." }, { status: 400, headers });
  try {
    return Response.json({ ok: true, records: await getRouteRevenueDetail({ from, through, category, weekday, technician }) }, { headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "route_revenue_detail_failed", message: String(error).slice(0, 300) }));
    return Response.json({ error: "Revenue detail is temporarily unavailable." }, { status: 503, headers });
  }
}
