import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
import {salesHeaders,salesError} from '@/lib/food-sales-api';
import {prepareFoodSalesStaff,inviteFoodSalesStaff,revokeFoodSalesStaff} from '@/lib/food-sales-staff.mjs';
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
    const rows=await c.env.DB.prepare(`SELECT m.id,m.email,m.display_name,m.role,m.status,g.enabled,g.approved_at,
      CASE WHEN p.password_hash IS NOT NULL THEN 1 ELSE 0 END password_set,p.last_login_at
      FROM dog_food_sales_grants g JOIN route_partner_members m ON m.id=g.member_id
      LEFT JOIN dog_food_sales_credentials p ON p.member_id=m.id WHERE g.organization_id='org-opwp' ORDER BY m.display_name LIMIT 100`).all();
    return Response.json({ok:true,staff:rows.results||[]},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
export async function POST(request) {
  try{const c=await context(request,true);if(c.response)return c.response;
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,8192)));let result;
    if(body.action==='prepare')result=await prepareFoodSalesStaff(c.env.DB,body);
    else if(body.action==='invite')result=await inviteFoodSalesStaff(c.env.DB,body,c.auth.email,new URL(request.url).origin);
    else if(body.action==='revoke'&&body.confirm===true)result=await revokeFoodSalesStaff(c.env.DB,body.memberId,c.auth.email);
    else throw new FoodError('Choose a supported staff-access action.');
    return Response.json({ok:true,result},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
