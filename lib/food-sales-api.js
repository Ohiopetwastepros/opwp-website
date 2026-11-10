import {getRuntimeEnv} from './cloudflare';
import {verifyFoodSalesRequest} from './food-sales-auth.mjs';
import {checkRateLimit,rateLimitResponse} from './rate-limit';
import {FoodError} from './dog-food-operations.mjs';
import {verifyAdminRequest} from './admin-auth';

export const salesHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function foodSalesContext(request,{write=false,login=false}={}) {
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({error:'Cross-site request rejected.'},{status:403,headers:salesHeaders})};
  const env=getRuntimeEnv();
  if(env.FOOD_SALES_NATIVE_ENABLED!=='true'||!env.DB)return {response:Response.json({error:'Food sales rollout is not enabled.'},{status:503,headers:salesHeaders})};
  let auth=login?null:await verifyFoodSalesRequest(request.headers,env.DB);
  if(!login&&request.headers.get('x-food-office')==='1'){
    const owner=await verifyAdminRequest(request.headers);
    auth=owner.authorized?{authorized:true,office:true,member:{id:'admin:'+owner.email,name:'Office'}}:{authorized:false};
  }
  if(!login&&!auth.authorized)return {response:Response.json({error:'Your food-sales session has expired.'},{status:401,headers:salesHeaders})};
  const rate=await checkRateLimit(request,{scope:login?'food_sales_login':'food_sales',identity:auth?.member.id,limit:login?15:write?30:90,windowSeconds:login?900:60,failClosed:true});
  return rate.allowed?{env,auth}:{response:rateLimitResponse(rate)};
}
export function salesError(error) {
  const status=error instanceof FoodError?error.status:error instanceof RangeError?413:error instanceof SyntaxError?400:503;
  return Response.json({error:error instanceof FoodError?error.message:status===413?'Request too large.':status===400?'Invalid request.':'Save outcome is uncertain. Keep this submission ID and check or retry it before starting another sale.',uncertain:status===503,definitive:error.definitive===true},{status,headers:salesHeaders});
}
