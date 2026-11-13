import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
import {salesHeaders,salesError} from '@/lib/food-sales-api';
import {foodCustomerCommand,readFoodCustomerHub,foodCustomerMessages} from '@/lib/food-customer-hub.mjs';
import {flushFoodCustomerMessages} from '@/lib/food-customer-service';
import {FoodError} from '@/lib/dog-food-operations.mjs';
import {readFoodOperations} from '@/lib/dog-food-ops-store';
export const dynamic='force-dynamic';
async function context(request,write=false){
  const auth=await verifyAdminRequest(request.headers);if(!auth.authorized)return {response:Response.json({error:'Unauthorized'},{status:401,headers:salesHeaders})};
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({error:'Cross-site request rejected'},{status:403,headers:salesHeaders})};
  const env=getRuntimeEnv();if(!env.DB)throw new FoodError('Customer storage is unavailable.',503);
  const rate=await checkRateLimit(request,{scope:'food_customer_hub',identity:auth.email,limit:write?20:90,windowSeconds:60,failClosed:true});if(!rate.allowed)return {response:rateLimitResponse(rate)};
  return {env,auth};
}
export async function GET(request){try{const c=await context(request);if(c.response)return c.response;const url=new URL(request.url),data=await readFoodCustomerHub(c.env.DB,{q:url.searchParams.get('q'),id:url.searchParams.get('id'),offset:url.searchParams.get('offset'),status:url.searchParams.get('status')||'all'});
  if(url.searchParams.get('id')&&data.customers.length){const customer=data.customers[0],model=await readFoodOperations(c.env.DB),ids=new Set(customer.sourceLinks.filter(l=>l.source_table==='Sales').map(l=>l.source_record_id));const direct=(await c.env.DB.prepare('SELECT sale_id FROM dog_food_direct_sale_links WHERE customer_id=?').bind(customer.id).all()).results||[];for(const row of direct)ids.add(row.sale_id);customer.legacySales=model.sales.filter(s=>(ids.has(s.id)||s.sourceCustomerId===customer.id)&&!s.orderId);const sourceIds=new Set([customer.id,customer.airtable_record_id,...customer.sourceLinks.filter(l=>l.source_table==='Customers').map(l=>l.source_record_id)].filter(Boolean));customer.legacyPlans=model.subscriptions.filter(s=>sourceIds.has(s.customer));}
  return Response.json({ok:true,...data},{headers:salesHeaders});}catch(e){return salesError(e);}}
export async function POST(request){try{
  const c=await context(request,true);if(c.response)return c.response;
  const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,16384)));
  if(!body||typeof body!=='object'||Array.isArray(body))throw new FoodError('Invalid customer request.');
  const result=await foodCustomerCommand(c.env.DB,body,c.auth.email,{office:true});
  if(body.action==='invite_customer')try{await flushFoodCustomerMessages(c.env,{customerId:result.id,limit:2});}catch{/* Saved intents are retried only while still queued. */}
  const detail=await readFoodCustomerHub(c.env.DB,{id:result.id});
  return Response.json({ok:true,result,customer:detail.customers[0],messages:await foodCustomerMessages(c.env.DB,result.id)},{headers:salesHeaders});
}catch(e){return salesError(e);}}
