import {getRuntimeEnv} from '@/lib/cloudflare';
import {getDb} from '@/lib/db';
import {protectJsonRequest} from '@/lib/public-api-security';
import {saveFunnelSignupAddress} from '@/lib/lead-funnel-signup.mjs';
import {FunnelError} from '@/lib/lead-funnel-admin.mjs';
import {recommendFunnelDay} from '@/lib/lead-funnel-routing';
import {funnelJobKey,funnelDigest,funnelDetails} from '@/lib/lead-funnel-policy.mjs';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function POST(request) {
  const env=getRuntimeEnv();
  if(env.LEAD_FUNNEL_ENABLED!=='true')return Response.json({ok:true,available:false},{headers:privateHeaders});
  if(request.headers.get('origin')!==new URL(request.url).origin || !['same-origin',null].includes(request.headers.get('sec-fetch-site')))return Response.json({error:'Request blocked.'},{status:403,headers:privateHeaders});
  const input=await protectJsonRequest(request,{scope:'lead_signup_route',limit:10,windowSeconds:3600,maxBytes:2048,turnstile:false,failClosed:true});
  if(input.response)return input.response;
  const db=getDb();if(!db)return Response.json({error:'Routing temporarily unavailable.'},{status:503,headers:privateHeaders});
  try {
    const saved=await saveFunnelSignupAddress(db,input.body.token,input.body);
    const route=await recommendFunnelDay(db,env,saved.body);
    await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.route',json(?),'$.routeCheckedAt',?,'$.routeInputHash',?),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?
      AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND payload=?)`)
      .bind(JSON.stringify(route),new Date().toISOString(),await funnelDigest(JSON.stringify(funnelDetails(saved.body))),funnelJobKey(saved.leadId),saved.leadId,JSON.stringify(saved.body)).run();
    // No customer addresses, route members, technician names, capacity or private
    // evidence leave the server. The day is advice, never a booking commitment.
    return Response.json({ok:true,available:Boolean(route.day),day:route.day||null,message:route.day?'Recommended recurring service day. Final availability and your start date are confirmed during setup.':'We will confirm your service day during setup.'},{headers:privateHeaders});
  }catch(error){return Response.json({error:error instanceof FunnelError?error.message:'We will confirm your service day during setup.'},{status:error instanceof FunnelError?error.status:503,headers:privateHeaders});}
}
