import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
import {FoodError} from '@/lib/dog-food-operations.mjs';
import {reviewFoodPlanRequest,createFoodStaffCustomer} from '@/lib/dog-food-experience.mjs';
import {runFoodCommand} from '@/lib/dog-food-ops-store';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function POST(request) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return Response.json({ok:false,error:'Unauthorized'},{status:401,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({ok:false,error:'Cross-site request rejected'},{status:403,headers});
  const rate=await checkRateLimit(request,{scope:`food_experience:${auth.email}`,limit:20,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return rateLimitResponse(rate);
  try {
    const env=getRuntimeEnv();if(!env.DB)throw new FoodError('Storage unavailable.',503);
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,8192)));
    if(!body||Array.isArray(body)||!['review_plan_request','create_customer'].includes(body.action))throw new FoodError('Choose a valid office action.');
    const result=await runFoodCommand(env,body,auth.email,()=>body.action==='create_customer'?createFoodStaffCustomer(env.DB,body):reviewFoodPlanRequest(env.DB,body,auth.email));
    return Response.json({ok:true,result},{headers});
  }catch(error){return Response.json({ok:false,error:error instanceof FoodError?error.message:'The review could not be confirmed. Refresh before retrying.'},{status:error instanceof FoodError?error.status:error instanceof RangeError?413:error instanceof SyntaxError?400:503,headers});}
}
