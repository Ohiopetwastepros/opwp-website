import {headers} from 'next/headers';
import {verifyAdminRequest} from '@/lib/admin-auth';
import {getDb} from '@/lib/db';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {normalizeGrowthSubmissionId} from '@/lib/growth-desk.mjs';
import {readInboxRow,quoteMessage,intakeQuote,LeadInboxError} from '@/lib/lead-inbox-store';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function GET(request,{params}){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  const id=normalizeGrowthSubmissionId((await params).leadId);if(!id)return Response.json({error:'Invalid lead.'},{status:400,headers:privateHeaders});
  const rate=await checkRateLimit(request,{scope:'admin_lead_quote_draft',identity:auth.email,limit:60,windowSeconds:60,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  try{const row=await readInboxRow(db,id);if(!row)return Response.json({error:'Lead not found.'},{status:404,headers:privateHeaders});const ws=JSON.parse(row.workspace_payload||'{}');if(ws.intake)ws.quote=intakeQuote(ws.intake);return Response.json({ok:true,draft:quoteMessage(row,ws)},{headers:privateHeaders});}catch(e){return Response.json({error:e instanceof LeadInboxError?e.message:'Quote draft unavailable.'},{status:e instanceof LeadInboxError?e.status:500,headers:privateHeaders});}
}
