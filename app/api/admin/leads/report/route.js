import {headers} from 'next/headers';
import {verifyAdminRequest} from '@/lib/admin-auth';
import {getDb} from '@/lib/db';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {readLeadReport} from '@/lib/lead-report';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function GET(request){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  const url=new URL(request.url),days=Number(url.searchParams.get('days')||90);
  if([...url.searchParams.keys()].some(k=>k!=='days')||![0,30,90,365].includes(days))return Response.json({error:'Invalid period.'},{status:400,headers:privateHeaders});
  const rate=await checkRateLimit(request,{scope:'admin_lead_report',identity:auth.email,limit:30,windowSeconds:60,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
  const db=getDb();if(!db)return Response.json({error:'Lead storage unavailable.'},{status:503,headers:privateHeaders});
  try{return Response.json({ok:true,report:await readLeadReport(db,days)},{headers:privateHeaders});}catch{console.error(JSON.stringify({event:'lead_report_failed'}));return Response.json({error:'The lead report could not be loaded.'},{status:500,headers:privateHeaders});}
}
