import { headers } from 'next/headers';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { listGrowthDesk } from '@/lib/growth-desk';
import { normalizeGrowthSubmissionId } from '@/lib/growth-desk.mjs';
import { protectJsonRequest } from '@/lib/public-api-security';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { saveInboxChange, readInboxRow, quoteMessage, LeadInboxError } from '@/lib/lead-inbox-store';
import { createLeadHandoff } from '@/lib/lead-handoff';
import { reviewLeadDay } from '@/lib/lead-routing';
import { getRuntimeEnv } from '@/lib/cloudflare';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function GET(request,{params}){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  const id=normalizeGrowthSubmissionId((await params).leadId);if(!id)return Response.json({error:'Invalid lead.'},{status:400,headers:privateHeaders});
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  const rate=await checkRateLimit(request,{scope:'admin_lead_detail',identity:auth.email,limit:120,windowSeconds:60,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
  try{const desk=await listGrowthDesk(1,{id});if(!desk.leads[0])return Response.json({error:'Lead not found.'},{status:404,headers:privateHeaders});return Response.json({ok:true,lead:desk.leads[0]},{headers:privateHeaders});}
  catch{return Response.json({error:'Lead could not be loaded.'},{status:500,headers:privateHeaders});}
}
export async function PATCH(request,{params}){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  if(request.headers.get('origin')!==new URL(request.url).origin||!['same-origin',null].includes(request.headers.get('sec-fetch-site')))return Response.json({error:'Cross-site request blocked.'},{status:403,headers:privateHeaders});
  const id=normalizeGrowthSubmissionId((await params).leadId);if(!id)return Response.json({error:'Invalid lead.'},{status:400,headers:privateHeaders});
  const protectedRequest=await protectJsonRequest(request,{scope:`admin_lead_change:${auth.email}`,limit:120,windowSeconds:3600,maxBytes:12288,turnstile:false,failClosed:true});if(protectedRequest.response)return protectedRequest.response;
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  try{
    let context={};
    if(protectedRequest.body.action==='approve_day'){
      const rate=await checkRateLimit(request,{scope:'lead_day_review',identity:auth.email,limit:30,windowSeconds:300,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
      context={routeAudit:await reviewLeadDay(db,getRuntimeEnv(),id,protectedRequest.body,auth.email)};
    }
    const result=await saveInboxChange(db,id,protectedRequest.body,auth.email,context);
    let signup=null,draft=null;
    if(protectedRequest.body.action==='handoff')signup=await createLeadHandoff(db,id,auth.email);
    if(protectedRequest.body.action==='save_intake'&&!result.workspace.quote.custom)draft=quoteMessage(await readInboxRow(db,id),result.workspace);
    const desk=await listGrowthDesk(1,{id});return Response.json({ok:true,lead:desk.leads[0],summary:result.summary,draft,signup},{headers:privateHeaders});
  }catch(e){if(!(e instanceof LeadInboxError))console.error(JSON.stringify({event:'lead_inbox_save_failed',action:protectedRequest.body?.action}));return Response.json({error:e instanceof LeadInboxError?e.message:'The lead could not be saved. Reload to check its current state.'},{status:e instanceof LeadInboxError?e.status:500,headers:privateHeaders});}
}
