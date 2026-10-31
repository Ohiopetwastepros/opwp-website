import {headers} from 'next/headers';
import {verifyAdminRequest} from '@/lib/admin-auth';
import {getDb} from '@/lib/db';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {normalizeGrowthSubmissionId} from '@/lib/growth-desk.mjs';
import {protectJsonRequest} from '@/lib/public-api-security';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {loadQuoThread} from '@/lib/lead-quo-thread';
import {LeadInboxError} from '@/lib/lead-inbox-store';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function POST(request,{params}){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  if(request.headers.get('origin')!==new URL(request.url).origin||!['same-origin',null].includes(request.headers.get('sec-fetch-site')))return Response.json({error:'Cross-site request blocked.'},{status:403,headers:privateHeaders});
  const id=normalizeGrowthSubmissionId((await params).leadId);if(!id)return Response.json({error:'Invalid lead.'},{status:400,headers:privateHeaders});
  const protection=await protectJsonRequest(request,{scope:`admin_lead_quo_read:${auth.email}`,limit:120,windowSeconds:3600,maxBytes:3072,turnstile:false,failClosed:true});if(protection.response)return protection.response;
  const rate=await checkRateLimit(request,{scope:'admin_lead_quo_read_burst',identity:auth.email,limit:20,windowSeconds:60,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  try{return Response.json({ok:true,...await loadQuoThread(db,getRuntimeEnv(),id,protection.body)},{headers:privateHeaders});}
  catch(e){return Response.json({error:e instanceof LeadInboxError?e.message:'The Quo thread could not be loaded.'},{status:e instanceof LeadInboxError?e.status:502,headers:privateHeaders});}
}
