import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {backupWebsiteFoodData} from '@/lib/dog-food-backups.mjs';
export const dynamic='force-dynamic';
export async function POST(request){
  const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
  const auth=await verifyAdminRequest(request.headers);if(!auth.authorized)return Response.json({ok:false,error:'Unauthorized'},{status:401,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({ok:false,error:'Cross-site request rejected'},{status:403,headers});
  const rate=await checkRateLimit(request,{scope:'food_backup:'+auth.email,limit:2,windowSeconds:3600,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
  try{return Response.json({ok:true,result:await backupWebsiteFoodData(getRuntimeEnv(),{manual:true})},{headers});}catch{return Response.json({ok:false,error:'Backup could not be verified. Review recovery status.'},{status:503,headers});}
}
