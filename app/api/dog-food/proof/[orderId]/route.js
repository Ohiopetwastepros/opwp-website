import { getDb } from '@/lib/db';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { foodAccountSession } from '@/lib/dog-food-account.mjs';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function GET(request,{params}) {
  const rate=await checkRateLimit(request,{scope:'food_delivery_proof',limit:30,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return rateLimitResponse(rate);
  const db=getDb(),account=await foodAccountSession(db,request.headers);
  if(!account)return new Response('Unauthorized',{status:401,headers});
  const {orderId}=await params;
  if(!/^[a-f0-9-]{36}$/i.test(orderId||''))return new Response('Not found',{status:404,headers});
  const proof=await db.prepare(`SELECT p.object_key,p.content_type,p.storage_provider,p.image_data FROM route_partner_field_proofs p
    JOIN route_partner_tasks t ON t.id=p.task_id AND t.organization_id='org-opwp' JOIN dog_food_deliveries d ON d.id=t.dog_food_delivery_id
    JOIN dog_food_orders o ON o.id=d.order_id WHERE o.id=? AND o.customer_id=? AND o.deleted_at IS NULL AND d.status='delivered'
    AND p.organization_id='org-opwp' ORDER BY p.created_at DESC LIMIT 1`).bind(orderId,account.customer_id).first();
  if(!proof||!['image/jpeg','image/png','image/webp'].includes(proof.content_type))return new Response('Not found',{status:404,headers});
  if(proof.storage_provider==='d1')return new Response(proof.image_data,{headers:{...headers,'Content-Type':proof.content_type}});
  const object=await getRuntimeEnv().FIELD_PROOFS?.get(proof.object_key);
  if(!object)return new Response('Not found',{status:404,headers});
  return new Response(object.body,{headers:{...headers,'Content-Type':proof.content_type}});
}
