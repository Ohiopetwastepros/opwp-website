import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {salesHeaders,salesError} from '@/lib/food-sales-api';
import {foodSalesService} from '@/lib/food-sales-service';
import {linkFoodSalesInvoice,linkFoodSalesExistingPayment,retryFoodSalesSng} from '@/lib/food-sales-sng.mjs';
import {FoodError,text} from '@/lib/dog-food-operations.mjs';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
export const dynamic='force-dynamic';
async function context(request,write=false) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return {response:Response.json({error:'Owner MFA session required.'},{status:401,headers:salesHeaders})};
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({error:'Cross-site request rejected.'},{status:403,headers:salesHeaders})};
  const env=getRuntimeEnv();if(env.FOOD_SALES_NATIVE_ENABLED!=='true'||!env.DB)return {response:Response.json({error:'Native food-sales rollout is not enabled.'},{status:503,headers:salesHeaders})};
  const rate=await checkRateLimit(request,{scope:'food_sales_office_review',identity:auth.email,limit:write?20:60,windowSeconds:60,failClosed:true});
  return rate.allowed?{env,auth}:{response:rateLimitResponse(rate)};
}
export async function GET(request) {
  try {
    const c=await context(request);if(c.response)return c.response;
    const db=c.env.DB;
    const [reviews,events,orders]=await Promise.all([
      db.prepare("SELECT * FROM dog_food_sales_review ORDER BY status='pending' DESC,created_at DESC LIMIT 100").all(),
      db.prepare('SELECT event_id,evidence,status,result,created_at FROM dog_food_sales_sng_events ORDER BY created_at DESC LIMIT 100').all(),
      db.prepare(`SELECT o.id,o.order_number,c.first_name,c.last_name,o.total_cents,m.billing_provider,
        (SELECT json_group_array(json_object('id',p.id,'provider',p.provider,'reference',p.provider_transaction_id,'amount',p.amount_cents,'refunded',p.refunded_amount_cents)) FROM dog_food_payments p WHERE p.order_id=o.id) payments,
        (SELECT json_group_array(json_object('id',a.lot_id,'quantity',a.quantity,'consumed',a.consumed_at)) FROM dog_food_lot_allocations a WHERE a.order_id=o.id) lots
        FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id JOIN dog_food_sales_order_metadata m ON m.order_id=o.id ORDER BY o.created_at DESC LIMIT 100`).all(),
    ]);
    return Response.json({ok:true,reviews:reviews.results||[],events:events.results||[],orders:orders.results||[]},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
export async function POST(request) {
  try {
    const c=await context(request,true);if(c.response)return c.response;
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,16384))),db=c.env.DB;
    let result;
    if(body.action==='link_invoice')result=await linkFoodSalesInvoice(db,body,c.auth.email);
    else if(body.action==='link_existing_payment')result=await linkFoodSalesExistingPayment(db,body,c.auth.email);
    else if(body.action==='retry_sng')result=await retryFoodSalesSng(db);
    else if(['receipt','refund','return','correction'].includes(body.action))result=await foodSalesService.command(db,body,c.auth.email,{office:true});
    else if(body.action==='resolve_review') {
      if(!text(body.note,1000)||!['resolved','dismissed'].includes(body.status))throw new FoodError('Provide a review outcome and office note.');
      const row=await db.prepare("SELECT id FROM dog_food_sales_review WHERE id=? AND status='pending'").bind(body.reviewId).first();if(!row)throw new FoodError('Pending review not found.',404);
      await db.batch([db.prepare("UPDATE dog_food_sales_review SET status=?,office_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(body.status,text(body.note,1000),c.auth.email,row.id),db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'food_sales_reviewed',?,?)").bind(crypto.randomUUID(),c.auth.email,row.id,JSON.stringify({status:body.status,note:text(body.note,1000)}))]);
      result={message:'Review outcome retained. Financial and stock records were not silently rewritten.'};
    } else throw new FoodError('Unsupported review action.');
    return Response.json({ok:true,result},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
