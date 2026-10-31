import { verifyAdminRequest } from '@/lib/admin-auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { runFinancialReconciliation, getReconciliationStatus } from '@/lib/financial-reconciliation';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function GET(request) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized) return Response.json({error:'Unauthorized'},{status:401,headers});
  return Response.json(await getReconciliationStatus(auth.email),{headers});
}
export async function POST(request) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized) return Response.json({error:'Unauthorized'},{status:401,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site') return Response.json({error:'Cross-site request blocked.'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'JSON required.'},{status:415,headers});
  const rate=await checkRateLimit(request,{scope:`qbo_reconciliation:${auth.email}`,limit:6,windowSeconds:600,failClosed:true});
  if(!rate.allowed) return rateLimitResponse(rate);
  // Separate actor-wide bucket prevents bypass by rotating client IP/user-agent.
  const actorRequest=new Request(request.url,{headers:{'cf-connecting-ip':'actor','user-agent':'qbo-reconciliation'}});
  const actorRate=await checkRateLimit(actorRequest,{scope:`qbo_actor:${auth.email}`,limit:12,windowSeconds:3600,failClosed:true});
  if(!actorRate.allowed) return rateLimitResponse(actorRate);
  try {
    const body=await readBoundedProviderJson(request,2048);
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['action'].includes(k)) || body.action!=='check') return Response.json({error:'Invalid action.'},{status:400,headers});
    const result=await runFinancialReconciliation();
    return Response.json({ok:true,...result},{headers});
  } catch(error) {
    return Response.json({error:error instanceof RangeError?'Request too large.':'QuickBooks reconciliation could not complete. Check the QuickBooks connection and retry after any active check finishes.'},{status:error instanceof RangeError?413:400,headers});
  }
}
