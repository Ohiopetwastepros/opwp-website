import {foodSalesContext,salesHeaders,salesError} from '@/lib/food-sales-api';
import {foodSalesService} from '@/lib/food-sales-service';
import {foodSalesPolicy,foodSalesOrder,salesUuid} from '@/lib/food-sales-ledger.mjs';
import {FoodError,text,foodDate} from '@/lib/dog-food-operations.mjs';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
export const dynamic='force-dynamic';
export async function GET(request) {
  try {
    const c=await foodSalesContext(request);if(c.response)return c.response;
    const db=c.env.DB,url=new URL(request.url),commandId=url.searchParams.get('submission');
    if(commandId) {
      if(!salesUuid(commandId))throw new FoodError('Invalid submission ID.');
      const saved=await db.prepare('SELECT result FROM dog_food_sales_commands WHERE id=? AND actor=?').bind(commandId,c.auth.member.id).first();
      return Response.json({ok:true,saved:Boolean(saved),result:saved?JSON.parse(saved.result):null},{headers:salesHeaders});
    }
    const policy=await foodSalesPolicy(db),q=text(url.searchParams.get('q'),100);
    const customers=q.length>=1?(await db.prepare(`SELECT id,first_name,last_name,email,phone FROM dog_food_customers WHERE deleted_at IS NULL AND status='active'
      AND (instr(lower(first_name||' '||last_name),lower(?))>0 OR instr(lower(email),lower(?))>0 OR instr(phone,?)>0) ORDER BY last_name LIMIT 20`).bind(q,q,q).all()).results||[]:[];
    const ids=(await db.prepare('SELECT order_id FROM dog_food_sales_order_metadata WHERE recorded_by=? ORDER BY created_at DESC LIMIT 20').bind(c.auth.member.id).all()).results||[];
    const recent=[];for(const row of ids){try{const o=await foodSalesOrder(db,row.order_id);recent.push({id:o.id,orderNumber:o.order_number,customerName:`${o.first_name} ${o.last_name}`,totalCents:o.total_cents,receivedCents:o.received_cents,balanceCents:o.balance_cents,paymentStatus:o.payment_status,fulfillmentMethod:o.fulfillment_method,fulfillmentStatus:o.handoff_status==='delivered'?'completed':'pending'});}catch(error){if(error.status!==404)throw error;}}
    const products=(await db.prepare('SELECT id,name,color,formula_code,bag_weight_lb,retail_price_cents FROM dog_food_products WHERE is_active=1 AND retail_price_cents>0 ORDER BY formula_code').all()).results||[];
    const addresses=customers.length?(await db.prepare(`SELECT id,customer_id,line1,city,state,postal_code FROM dog_food_addresses WHERE customer_id IN(${customers.map(()=>'?').join(',')}) AND postal_code<>'00000' ORDER BY is_primary DESC LIMIT 60`).bind(...customers.map(c=>c.id)).all()).results||[]:[];
    const inventory=await foodSalesService.inventory(db);
    return Response.json({ok:true,member:c.auth.member,policy,recordingEnabled:c.env.FOOD_SALES_RECORDING_ENABLED==='true',inventoryConfigured:inventory.configured,stockBasis:inventory.basis,customers,addresses,products:products.map(p=>({...p,available:inventory.products.find(s=>s.id===p.id)?.available??null})),recent},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
export async function POST(request) {
  try {
    const c=await foodSalesContext(request,{write:true});if(c.response)return c.response;
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,16384)));
    if(!body||typeof body!=='object'||Array.isArray(body))throw new FoodError('Invalid request.');
    if(!['quote','save','receipt','handoff','correction'].includes(body.action))throw new FoodError('Action is not permitted.',403);
    if(body.action==='save'&&c.env.FOOD_SALES_RECORDING_ENABLED!=='true')return Response.json({error:'New food-sale recording is paused while the office verifies inventory.',uncertain:false,definitive:true},{status:503,headers:salesHeaders});
    const result=body.action==='quote'?await foodSalesService.quote(c.env.DB,body):await foodSalesService.command(c.env.DB,body,c.auth.member.id);
    return Response.json({ok:true,result},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
