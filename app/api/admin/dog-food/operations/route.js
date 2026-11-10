import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedBytes } from '@/lib/bounded-body.mjs';
import { FoodError } from '@/lib/dog-food-operations.mjs';
import { readFoodOperations, runFoodCommand, syncFoodOperations } from '@/lib/dog-food-ops-store';
import { foodCollectionCommand } from '@/lib/dog-food-collections';
import {saveFoodPlanning} from '@/lib/dog-food-sales-intelligence.mjs';
import {foodCustomerReview} from '@/lib/dog-food-customer-review';
import {saveInventoryCost} from '@/lib/dog-food-inventory.mjs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
async function context(request,write=false) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return {response:Response.json({ok:false,error:'Unauthorized'},{status:401,headers})};
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({ok:false,error:'Cross-site request rejected'},{status:403,headers})};
  const env=getRuntimeEnv();if(!env.DB)return {response:Response.json({ok:false,error:'Storage unavailable'},{status:503,headers})};
  const rate=await checkRateLimit(request,{scope:`dog_food_operations:${auth.email}`,limit:write?20:90,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return {response:rateLimitResponse(rate)};
  return {auth,env};
}
export async function GET(request) {
  const c=await context(request);if(c.response)return c.response;
  try{const submission=new URL(request.url).searchParams.get('submission');
    if(submission){if(!/^[a-f0-9-]{36}$/i.test(submission))return Response.json({ok:false,error:'Invalid submission.'},{status:400,headers});
      const command=await c.env.DB.prepare('SELECT status,result FROM dog_food_ops_commands WHERE id=? AND actor=?').bind(submission,c.auth.email).first();
      return Response.json({ok:true,submission:command?{status:command.status,result:command.status==='complete'?JSON.parse(command.result):null}:{status:'unconfirmed'},data:await readFoodOperations(c.env.DB)},{headers});}
    return Response.json({ok:true,data:await readFoodOperations(c.env.DB)},{headers});}
  catch{return Response.json({ok:false,error:'Dog-food operations could not be loaded.'},{status:503,headers});}
}
export async function POST(request) {
  const c=await context(request,true);if(c.response)return c.response;
  try {
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,16384)));
    if(!body||typeof body!=='object'||Array.isArray(body))throw new FoodError('Invalid request.');
    const collectionAction=['collection_settings','collection_notify','collection_approve','collection_dismiss'].includes(body.action);
    const result=await runFoodCommand(c.env,body,c.auth.email,body.action==='cost_annotation'?async e=>saveInventoryCost(e.DB,body,c.auth.email,await readFoodOperations(e.DB)):body.action==='customer_review'?e=>foodCustomerReview(e,body,c.auth.email):body.action==='planning_settings'?e=>saveFoodPlanning(e.DB,body,c.auth.email):collectionAction?e=>foodCollectionCommand(e,body,c.auth.email):null);
    let syncWarning='';if(!['cost_annotation','customer_review','planning_settings','sync','alert_settings','collection_settings','collection_dismiss','collection_notify','delete_native','restore_native'].includes(body.action)){
      try{await syncFoodOperations(c.env,{force:true});}catch{syncWarning='Saved in Airtable; website synchronization is pending. Refresh before another change.';}
    }
    return Response.json({ok:true,result,syncWarning,data:await readFoodOperations(c.env.DB)},{headers});
  }catch(error){const status=error instanceof FoodError?error.status:error instanceof RangeError?413:error instanceof SyntaxError?400:500;
    console.error(JSON.stringify({event:'dog_food_operations_failed',status}));
    return Response.json({ok:false,error:error instanceof FoodError?error.message:status===413?'Request too large.':status===400?'Invalid request.':'Operation could not be confirmed. Refresh before trying again.'},{status,headers});}
}
