import { getRuntimeEnv } from '@/lib/cloudflare';
import { readBoundedBytes } from '@/lib/bounded-body.mjs';
import { verifyFoodWebhook } from '@/lib/dog-food-ops-automation';
import { foodSchema, syncFoodOperations } from '@/lib/dog-food-ops-store';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {foodWebsiteState} from '@/lib/dog-food-website-store.mjs';
export const dynamic='force-dynamic';
export async function POST(request) {
  const env=getRuntimeEnv();if(!env.DB)return new Response(null,{status:503});
  if((await foodWebsiteState(env.DB)).backend==='website')return new Response(null,{status:204});
  try {
    const state=await env.DB.prepare("SELECT webhook_id FROM dog_food_ops_state WHERE id='org-opwp'").first();
    if(!state?.webhook_id||!env.DOG_FOOD_AIRTABLE_WEBHOOK_MAC)return new Response(null,{status:503});
    const bytes=await readBoundedBytes(request,4096);
    if(!await verifyFoodWebhook(bytes,request.headers.get('x-airtable-content-mac'),env.DOG_FOOD_AIRTABLE_WEBHOOK_MAC))return new Response(null,{status:401});
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(body.base?.id!==foodSchema.baseId||body.webhook?.id!==state.webhook_id)return new Response(null,{status:403});
    // Coalesce rapid record edits. The ten-minute runner reliably drains dirty
    // state; the next admin refresh can drain it immediately.
    await env.DB.prepare("UPDATE dog_food_ops_state SET dirty=1 WHERE id='org-opwp'").run();
    getCloudflareContext().ctx.waitUntil(syncFoodOperations(env).catch(()=>({failed:true})));
    return new Response(null,{status:204});
  }catch(error){return new Response(null,{status:error instanceof RangeError?413:400});}
}
