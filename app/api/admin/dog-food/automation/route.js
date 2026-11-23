import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedBytes, readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { outboundFetch } from '@/lib/outbound-request';
import { FoodError } from '@/lib/dog-food-operations.mjs';
import { readFoodWorkflow } from '@/lib/dog-food-workflow';
import { runFoodWebsiteWorkflow } from '@/lib/dog-food-ops-automation';
import { foodFulfillmentCommand } from '@/lib/dog-food-fulfillment';
import { runFoodCommand } from '@/lib/dog-food-ops-store';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
async function context(request,write=false) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return {response:Response.json({error:'Unauthorized'},{status:401,headers})};
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({error:'Cross-site request rejected'},{status:403,headers})};
  const env=getRuntimeEnv();if(!env.DB)return {response:Response.json({error:'Storage unavailable'},{status:503,headers})};
  const rate=await checkRateLimit(request,{scope:`food_workflow:${auth.email}`,limit:write?10:60,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return {response:rateLimitResponse(rate)};
  return {auth,env};
}
export async function GET(request) {
  const c=await context(request);if(c.response)return c.response;
  try{return Response.json({ok:true,data:await readFoodWorkflow(c.env.DB)},{headers});}
  catch{return Response.json({error:'Workflow state unavailable'},{status:503,headers});}
}
async function providerReview(env) {
  const result={stripe:{configured:Boolean(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET),mode:String(env.STRIPE_SECRET_KEY||'').startsWith('sk_test_')?'test':String(env.STRIPE_SECRET_KEY||'').startsWith('sk_live_')?'live':'unknown'},email:{configured:Boolean(env.RESEND_API_KEY&&env.EMAIL_SENDING_ENABLED==='true')}};
  for(const [name,url,key] of [['stripe','https://api.stripe.com/v1/webhook_endpoints',env.STRIPE_SECRET_KEY],['email','https://api.resend.com/domains',env.RESEND_API_KEY]]) {
    if(!key)continue;
    try {
      const response=await outboundFetch(url,{headers:{Authorization:`Bearer ${key}`}},{provider:name,operation:'dog_food_configuration_review',timeoutMs:10000,retries:0});
      const data=await readBoundedProviderJson(response,128*1024);result[name].status=response.status;
      if(!response.ok)result[name].errorCode=['restricted_api_key','invalid_api_key','missing_api_key','validation_error'].includes(data.name)?data.name:'provider_lookup_failed';
      if(response.ok&&name==='stripe')result.stripe.webhooks=(data.data||[]).filter(v=>/^https:\/\/(www\.)?ohiopetwastepros\.com\/api\/stripe\/webhook\/?$/.test(v.url)).map(v=>({status:v.status,events:v.enabled_events}));
      if(response.ok&&name==='email')result.email.domains=(data.data||[]).filter(v=>v.name==='ohiopetwastepros.com').map(v=>({name:v.name,status:v.status}));
    }catch{result[name].status='unavailable';}
  }
  return result;
}
export async function POST(request) {
  const c=await context(request,true);if(c.response)return c.response;
  try {
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,8192)));
    if(!body||Array.isArray(body)||typeof body!=='object')throw new FoodError('Invalid request.');
    if(body.action==='providers')return Response.json({ok:true,providers:await providerReview(c.env)},{headers});
    if(body.action==='run')return Response.json({ok:true,result:await runFoodWebsiteWorkflow(c.env),data:await readFoodWorkflow(c.env.DB)},{headers});
    const execute=async working=>{
      if(['capacity_slot','pickup_capacity','pickup_complete','pickup_ready','pickup_arrange','lot_count','finalize_count'].includes(body.action))return foodFulfillmentCommand(working,body,c.auth.email);
      if(body.action==='settings') {
        if(body.confirm!==true||[body.posting,body.email,body.scheduling].some(v=>typeof v!=='boolean'))throw new FoodError('Confirm explicit workflow settings.');
        await working.DB.prepare("UPDATE dog_food_workflow_settings SET posting_enabled=?,email_enabled=?,scheduling_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id='org-opwp'").bind(body.posting?1:0,body.email?1:0,body.scheduling?1:0).run();
        return {message:'Workflow settings saved. Launch readiness requires provider and fulfillment evidence.'};
      }
      if(body.action==='retry_sync') {
        const key=typeof body.key==='string'?body.key:'';
        if(!/^(customer|order|payment|plan|delivery):[a-zA-Z0-9_-]{1,100}$/.test(key))throw new FoodError('Choose a valid source record.');
        await working.DB.prepare('UPDATE dog_food_sync_outbox SET attempts=0,next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL WHERE entity_key=? AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)').bind(key).run();
        return {message:'Idempotent source posting queued for retry.'};
      }
      if(body.action==='retry_email') {
        const key=typeof body.key==='string'?body.key:'';
        if(!/^(plan_request_received|plan_request_update|ordered|paid|failed|scheduled|on_way|delivered|pickup_ready|picked_up|cancelled|refunded):[a-zA-Z0-9_-]{1,100}$/.test(key))throw new FoodError('Choose a valid failed notice.');
        const row=await working.DB.prepare(`UPDATE dog_food_transactional_outbox SET attempts=0,next_attempt_at=CURRENT_TIMESTAMP,last_error=NULL
          WHERE event_key=? AND status='failed' AND first_attempt_at>=datetime('now','-23 hours') AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) RETURNING event_key`).bind(key).first();
        if(!row)throw new FoodError('This notice needs provider reconciliation before another attempt. Automatic resend outside the safe window is blocked.',409);
        return {message:'The original identical provider request is queued for safe retry.'};
      }
      throw new FoodError('Choose a valid workflow action.');
    };
    const result=await runFoodCommand(c.env,body,c.auth.email,execute);
    return Response.json({ok:true,result,data:await readFoodWorkflow(c.env.DB)},{headers});
  }catch(error){return Response.json({ok:false,error:error instanceof FoodError?error.message:'Workflow action could not be confirmed.'},{status:error instanceof FoodError?error.status:error instanceof RangeError?413:error instanceof SyntaxError?400:503,headers});}
}
