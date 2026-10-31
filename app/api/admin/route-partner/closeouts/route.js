import { verifyAdminRequest } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { sngRequest,sngRows } from '@/lib/sweepandgo';
import { checkRateLimit,rateLimitResponse } from '@/lib/rate-limit';
import { reviewCloseoutIdentity } from '@/lib/field-sync-review.mjs';
export const dynamic='force-dynamic';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request){
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return json({ok:false,error:'Unauthorized'},401);
  if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site')return json({ok:false,error:'Cross-site request blocked.'},403);
  const rate=await checkRateLimit(request,{scope:'field_closeout_review',limit:6,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return rateLimitResponse(rate);
  let body;
  try{body=await readBoundedProviderJson(request,1024);}catch{return json({ok:false,error:'Invalid request.'},400);}
  if(!body || typeof body.closeoutId!=='string' || body.closeoutId.length>100)return json({ok:false,error:'Choose a closeout.'},400);
  const db=getDb();if(!db)return json({ok:false,error:'Storage unavailable.'},503);
  const row=await db.prepare("SELECT manifest FROM route_partner_field_closeouts WHERE id=? AND organization_id='org-opwp'").bind(body.closeoutId).first();
  if(!row)return json({ok:false,error:'Closeout not found.'},404);
  try{
    const manifest=JSON.parse(row.manifest);
    const source=await sngRequest('/api/v1/dispatch_board/jobs_for_date',{searchParams:{date:manifest.serviceDate}});
    if(!source.ok)return json({ok:false,error:'SNG dispatch could not be verified. No changes were sent.'},502);
    const rows=sngRows(source);
    if(rows.length>400)return json({ok:false,error:'Dispatch exceeded the review limit.'},502);
    return json({ok:true,review:reviewCloseoutIdentity(manifest,rows)});
  }catch{return json({ok:false,error:'SNG review failed. No changes were sent.'},502);}
}
