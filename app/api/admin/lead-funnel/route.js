import {headers} from 'next/headers';
import {verifyAdminRequest} from '@/lib/admin-auth';
import {getDb} from '@/lib/db';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {protectJsonRequest} from '@/lib/public-api-security';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {funnelOverview,saveFunnelMode,approveFunnelInitialText,readFunnelPreview,FunnelError} from '@/lib/lead-funnel-admin.mjs';
import {runInitialQuoteSms} from '@/lib/quote-initial-sms.mjs';
import {getCloudflareContext} from '@opennextjs/cloudflare';

export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function GET(request) {
  const auth=await verifyAdminRequest(await headers());
  if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  const rate=await checkRateLimit(request,{scope:'lead_funnel_read',identity:auth.email,limit:60,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return rateLimitResponse(rate);
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  try{return Response.json({ok:true,...await funnelOverview(db,getRuntimeEnv())},{headers:privateHeaders});}
  catch{return Response.json({error:'Lead automation could not be loaded.'},{status:503,headers:privateHeaders});}
}
async function mutate(request,settingsOnly) {
  const auth=await verifyAdminRequest(await headers());
  if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  const env=getRuntimeEnv();
  if(!env.ADMIN_USERNAME || auth.email.toLowerCase()!==String(env.ADMIN_USERNAME).trim().toLowerCase())return Response.json({error:'Only Craig can change initial-text approval.'},{status:403,headers:privateHeaders});
  if(request.headers.get('origin')!==new URL(request.url).origin || !['same-origin',null].includes(request.headers.get('sec-fetch-site')))return Response.json({error:'Cross-site request blocked.'},{status:403,headers:privateHeaders});
  const input=await protectJsonRequest(request,{scope:'lead_funnel_write:'+auth.email,limit:30,windowSeconds:3600,maxBytes:2048,turnstile:false,failClosed:true});
  if(input.response)return input.response;
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  try {
    if(settingsOnly)return Response.json({ok:true,settings:await saveFunnelMode(db,input.body.initialTextMode,auth.email)},{headers:privateHeaders});
    if(env.LEAD_FUNNEL_ENABLED!=='true')throw new FunnelError('The unified lead funnel has not been released.',409);
    const id=String(input.body.leadId||'');if(!/^[a-f0-9-]{36}$/.test(id))throw new FunnelError('Choose a valid lead.');
    await readFunnelPreview(db,id);
    const result=await approveFunnelInitialText(db,id,input.body.version,auth.email);
    const task=runInitialQuoteSms(env,{submissionId:id});
    try{getCloudflareContext().ctx.waitUntil(task);}catch{await task;}
    return Response.json({ok:true,...result},{headers:privateHeaders});
  }catch(error){return Response.json({error:error instanceof FunnelError?error.message:'Initial-text action failed.'},{status:error instanceof FunnelError?error.status:500,headers:privateHeaders});}
}
export async function PATCH(request){return mutate(request,true);}
export async function POST(request){return mutate(request,false);}
