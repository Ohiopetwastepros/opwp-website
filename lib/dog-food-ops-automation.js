import { foodAirtable, foodSchema, syncFoodOperations, readFoodOperations } from './dog-food-ops-store';
import { foodDate, text } from './dog-food-operations.mjs';
import { runFoodCollectionNotifications, processFoodCollectionReplies, reconcileFoodCollections } from './dog-food-collections';
import { flushFoodProjections, flushFoodEmails, reviewFoodEmailOutcomes } from './dog-food-workflow';
import { scheduleFoodOrders } from './dog-food-fulfillment';
import {flushFoodCustomerMessages} from './food-customer-service';
import {foodWebsiteState} from './dog-food-website-store.mjs';
import {backupWebsiteFoodData} from './dog-food-backups.mjs';
export async function verifyFoodWebhook(bytes,header,secret) {
  if(!secret||!/^hmac-sha256=[a-f0-9]{64}$/i.test(header||''))return false;
  try {
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const sig=Uint8Array.from(header.slice(12).match(/../g),h=>parseInt(h,16));
    return crypto.subtle.verify('HMAC',key,sig,bytes);
  }catch{return false;}
}
export async function refreshFoodWebhook(env) {
  if((await foodWebsiteState(env.DB)).backend==='website')return {retired:true};
  const state=await env.DB.prepare("SELECT webhook_id,webhook_refreshed_at FROM dog_food_ops_state WHERE id='org-opwp'").first();
  if(!state?.webhook_id)return;
  if(state.webhook_refreshed_at&&Date.now()-Date.parse(`${state.webhook_refreshed_at.replace(' ','T')}Z`)<86400000)return;
  const r=await foodAirtable(env,`bases/${foodSchema.baseId}/webhooks/${state.webhook_id}/refresh`,{method:'POST'});
  await env.DB.prepare("UPDATE dog_food_ops_state SET webhook_expires_at=?,webhook_refreshed_at=CURRENT_TIMESTAMP WHERE id='org-opwp'").bind(r.expirationTime||null).run();
}
export async function runFoodAlerts(env,at=Date.now()) {
  return runFoodCollectionNotifications(env,{at});
}
export async function runScheduledFoodOperations(env,at=Date.now()) {
  if(!env.DB)return {configured:false};
  if((await foodWebsiteState(env.DB)).writes_paused)return {skipped:true,reason:'database_cutover'};
  try{
    try{await backupWebsiteFoodData(env);}catch{console.error(JSON.stringify({event:'dog_food_private_backup_failed'}));}
    await flushFoodCustomerMessages(env);
    await runFoodWebsiteWorkflow(env);
    await refreshFoodWebhook(env);
    await syncFoodOperations(env);
    await processFoodCollectionReplies(env);
    const model=await readFoodOperations(env.DB);
    if(!model.sync.dirty&&!model.sync.last_error)await reconcileFoodCollections(env.DB,model);
    return await runFoodAlerts(env,at);
  }
  catch(error){console.error(JSON.stringify({event:'dog_food_operations_scheduler_failed',message:text(error.message,200)}));return {failed:true};}
}
export async function runFoodWebsiteWorkflow(env) {
  const token=crypto.randomUUID(),db=env.DB;
  const claim=await db.prepare(`UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+5 minutes')
    WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id`).bind(token).first();
  if(!claim)return {skipped:true,reason:'workflow_busy'};
  try {
    const posting=await flushFoodProjections(env);
    await syncFoodOperations(env);
    const scheduling=await scheduleFoodOrders(env);
    const email=await flushFoodEmails(env);
    await reviewFoodEmailOutcomes(env);
    return {posting,scheduling,email};
  } finally {await db.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE id='org-opwp' AND command_token=?").bind(token).run();}
}
