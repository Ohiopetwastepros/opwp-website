import {getRuntimeEnv} from '@/lib/cloudflare';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
import {normalizeQuoMessageEvent,verifyQuoSignature} from '@/lib/quo-webhook.mjs';
import {recordFoodCollectionReply,processFoodCollectionReplies,recordFoodCollectionDelivery} from '@/lib/dog-food-collections';
import {getCloudflareContext} from '@opennextjs/cloudflare';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export async function POST(request) {
  const env=getRuntimeEnv();
  if(!env.DB||!env.DOG_FOOD_QUO_WEBHOOK_SIGNING_KEY)return Response.json({ok:false},{status:503,headers});
  const rate=await checkRateLimit(request,{scope:'dog_food_staff_webhook',limit:120,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return rateLimitResponse(rate);
  try {
    const bytes=await readBoundedBytes(request,65536),raw=new TextDecoder().decode(bytes);
    if(!await verifyQuoSignature(raw,request.headers.get('openphone-signature'),env.DOG_FOOD_QUO_WEBHOOK_SIGNING_KEY))return Response.json({ok:false},{status:401,headers});
    const body=JSON.parse(raw),object=body?.data?.object;
    const event=normalizeQuoMessageEvent(body);
    if(event) {
      // Only one-to-one Tony → OPWP replies are persisted; customer messages
      // are discarded here and never call customer lead/message workflows.
      const result=await recordFoodCollectionReply(env,{...event,isGroup:!Array.isArray(object.to)||object.to.length!==1});
      if(result.queued)getCloudflareContext().ctx.waitUntil(processFoodCollectionReplies(env,{limit:1}).catch(()=>({failed:true})));
      return Response.json({ok:true,accepted:result.handled&&!result.duplicate?1:0},{headers});
    }
    if(object?.from===env.QUO_FROM_NUMBER)await recordFoodCollectionDelivery(env.DB,body);
    return Response.json({ok:true,accepted:0},{headers});
  }catch(error) {
    const status=error instanceof RangeError?413:error instanceof SyntaxError?400:503;
    console.error(JSON.stringify({event:'dog_food_staff_webhook_failed',status}));
    return Response.json({ok:false},{status,headers});
  }
}
