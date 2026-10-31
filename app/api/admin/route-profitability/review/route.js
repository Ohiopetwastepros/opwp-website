import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { protectJsonRequest } from "@/lib/public-api-security";
import { saveRouteDecision } from "@/lib/route-data-quality";
import { refreshAirtableRouteProfitability } from "@/lib/airtable";
import { getRouteProfitabilityData } from "@/lib/route-profitability";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
export async function POST(request) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return Response.json({error:"Unauthorized"},{status:401,headers});
  if(request.headers.get("origin")!==new URL(request.url).origin||request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Cross-site request blocked."},{status:403,headers});
  const guarded=await protectJsonRequest(request,{scope:`route_review:${auth.email}`,limit:12,windowSeconds:600,maxBytes:2048,turnstile:false,failClosed:true});
  if(guarded.response)return guarded.response;
  const input=guarded.body;
  if(!input||typeof input.jobId!=="string"||! /^[a-zA-Z0-9_.-]{1,100}$/.test(input.jobId))return Response.json({error:"Invalid route record."},{status:400,headers});
  const db=getDb();
  if(!db)return Response.json({error:"Review storage unavailable."},{status:503,headers});
  try {
    const result=await saveRouteDecision(db,input,auth.email);
    if(!result.ok)return Response.json(result,{status:result.status,headers});
    let warning=null;
    try { await refreshAirtableRouteProfitability(getRuntimeEnv(),{reviewDate:result.date}); }
    catch { warning="Review saved. Route totals still need a successful data refresh."; }
    return Response.json({ok:true,warning,...await getRouteProfitabilityData(db)},{headers});
  } catch { return Response.json({error:"Review could not be saved. Refresh before retrying."},{status:503,headers}); }
}
