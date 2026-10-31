import { headers } from 'next/headers';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { listGrowthDesk } from '@/lib/growth-desk';
import { protectJsonRequest } from '@/lib/public-api-security';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { createInboxLead, LeadInboxError } from '@/lib/lead-inbox-store';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function GET(request){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  const rate=await checkRateLimit(request,{scope:'admin_lead_reads',identity:auth.email,limit:120,windowSeconds:60,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
  const url=new URL(request.url),cursor=url.searchParams.get('cursor')||'0',query=url.searchParams.get('q')||'';
  if([...url.searchParams.keys()].some(k=>!['cursor','q'].includes(k))||!/^\d{1,7}$/.test(cursor)||query.length>120)return Response.json({error:'Invalid search or cursor.'},{status:400,headers:privateHeaders});
  try{const desk=await listGrowthDesk(100,{offset:Number(cursor),query});return Response.json({ok:true,...desk,nextCursor:desk.leads.length===100?String(Number(cursor)+100):null},{headers:privateHeaders});}
  catch{console.error(JSON.stringify({event:'lead_inbox_read_failed'}));return Response.json({error:'Leads could not be loaded.'},{status:500,headers:privateHeaders});}
}
export async function POST(request){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  if(request.headers.get('origin')!==new URL(request.url).origin||!['same-origin',null].includes(request.headers.get('sec-fetch-site')))return Response.json({error:'Cross-site request blocked.'},{status:403,headers:privateHeaders});
  const protectedRequest=await protectJsonRequest(request,{scope:`admin_lead_create:${auth.email}`,limit:30,windowSeconds:3600,maxBytes:12288,turnstile:false,failClosed:true});if(protectedRequest.response)return protectedRequest.response;
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  try{const result=await createInboxLead(db,protectedRequest.body,auth.email);const desk=await listGrowthDesk(1,{id:result.id});return Response.json({ok:true,lead:desk.leads[0],replayed:result.replayed||false},{headers:privateHeaders});}
  catch(e){return Response.json({error:e instanceof LeadInboxError?e.message:'The lead could not be created.'},{status:e instanceof LeadInboxError?e.status:500,headers:privateHeaders});}
}
