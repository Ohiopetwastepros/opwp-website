import { verifyAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readStopTravel, refreshStopTravelDate, validTravelDate } from "@/lib/stop-travel";
import { readBoundedProviderJson } from "@/lib/bounded-body.mjs";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control":"no-store, private", "X-Content-Type-Options":"nosniff" };
const json = (body,status=200) => Response.json(body,{status,headers});
export async function GET(request) {
  if (!(await verifyAdminRequest(request.headers)).authorized) return json({error:"Unauthorized"},401);
  const params=new URL(request.url).searchParams;
  const from=params.get("from"), through=params.get("through");
  if (!validTravelDate(from) || !validTravelDate(through) || from>through) return json({error:"Choose a valid date range within the last 400 days."},400);
  const rate=await checkRateLimit(request,{scope:"stop_travel_read",limit:60,windowSeconds:60,failClosed:true});
  if (!rate.allowed) return rateLimitResponse(rate);
  try { return json({ok:true,...await readStopTravel(from,through)}); }
  catch { return json({error:"Stop travel history is temporarily unavailable."},503); }
}
export async function POST(request) {
  const auth=await verifyAdminRequest(request.headers);
  if (!auth.authorized) return json({error:"Unauthorized"},401);
  if (request.headers.get("origin")!==new URL(request.url).origin || request.headers.get("sec-fetch-site")==="cross-site") return json({error:"Cross-site request blocked."},403);
  let body;
  try { body=await readBoundedProviderJson(request,1024); } catch { return json({error:"Provide a small JSON body with a service date."},400); }
  if (!body || Object.keys(body).some(k=>k!=="date") || !validTravelDate(body.date)) return json({error:"Choose a valid service date within the last 400 days."},400);
  const rate=await checkRateLimit(request,{scope:`stop_travel_refresh:${auth.email}`,limit:2,windowSeconds:600,failClosed:true});
  if (!rate.allowed) return rateLimitResponse(rate);
  try { return json({ok:true,refresh:await refreshStopTravelDate(body.date)}); }
  catch { return json({error:"Travel refresh could not complete. Previous records are retained."},503); }
}
