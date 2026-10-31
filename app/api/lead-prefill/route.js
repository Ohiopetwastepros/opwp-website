import { getDb } from '@/lib/db';
import { protectJsonRequest } from '@/lib/public-api-security';
import { readLeadHandoff } from '@/lib/lead-handoff';
import { LeadInboxError } from '@/lib/lead-inbox-store';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function POST(request){
  if(request.headers.get('origin')!==new URL(request.url).origin||!['same-origin',null].includes(request.headers.get('sec-fetch-site')))return Response.json({error:'Request blocked.'},{status:403,headers:privateHeaders});
  const protectedRequest=await protectJsonRequest(request,{scope:'lead_prefill',limit:30,windowSeconds:3600,maxBytes:1024,turnstile:false,failClosed:true});if(protectedRequest.response)return protectedRequest.response;
  const db=getDb();if(!db)return Response.json({error:'Signup details unavailable.'},{status:503,headers:privateHeaders});
  try{return Response.json({ok:true,prefill:await readLeadHandoff(db,protectedRequest.body.token)},{headers:privateHeaders});}
  catch(e){return Response.json({error:e instanceof LeadInboxError?e.message:'Signup details unavailable.'},{status:e instanceof LeadInboxError?e.status:503,headers:privateHeaders});}
}
