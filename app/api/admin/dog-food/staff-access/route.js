import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
import {salesHeaders,salesError} from '@/lib/food-sales-api';
import {prepareFoodSalesStaff,inviteFoodSalesStaff,revokeFoodSalesStaff,readFoodSalesStaff} from '@/lib/food-sales-staff.mjs';
import {sendTransactionalEmail,transactionalEmailConfig} from '@/lib/submission-notifications';
import {applicationConfig} from '@/lib/app-config';
import {FoodError} from '@/lib/dog-food-operations.mjs';
export const dynamic='force-dynamic';
async function context(request,write=false) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return {response:Response.json({error:'Owner MFA session required.'},{status:401,headers:salesHeaders})};
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({error:'Cross-site request rejected.'},{status:403,headers:salesHeaders})};
  const env=getRuntimeEnv();if(env.FOOD_SALES_NATIVE_ENABLED!=='true'||!env.DB)return {response:Response.json({error:'Food-sales rollout is not enabled.'},{status:503,headers:salesHeaders})};
  const rate=await checkRateLimit(request,{scope:'food_sales_staff_access',identity:auth.email,limit:write?10:30,windowSeconds:60,failClosed:true});
  return rate.allowed?{auth,env}:{response:rateLimitResponse(rate)};
}
export async function GET(request) {
  try{const c=await context(request);if(c.response)return c.response;
    return Response.json({ok:true,staff:await readFoodSalesStaff(c.env.DB),emailConfigured:transactionalEmailConfig(c.env).configured},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
export async function POST(request) {
  try{const c=await context(request,true);if(c.response)return c.response;
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,8192)));let result;
    if(body.action==='prepare')result=await prepareFoodSalesStaff(c.env.DB,body);
    else if(body.action==='invite')result=await inviteFoodSalesStaff(c.env.DB,body,c.auth.email,applicationConfig(c.env).siteOrigin,{email:true,sendEmail:transactionalEmailConfig(c.env).configured?message=>sendTransactionalEmail(c.env,message):null});
    else if(body.action==='revoke'&&body.confirm===true)result=await revokeFoodSalesStaff(c.env.DB,body.memberId,c.auth.email);
    else throw new FoodError('Choose a supported staff-access action.');
    return Response.json({ok:true,result},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
