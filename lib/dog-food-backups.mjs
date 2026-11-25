import {foodWebsiteState,foodBusinessHash} from './dog-food-website-store.mjs';
import {FoodError} from './dog-food-operations.mjs';
// Operational exports supplement D1 recovery. Active credentials and session tokens
// are intentionally excluded; restore identities using the full D1 recovery point.
const excluded=/account|credential|password|session|token|challenge|rate_limit|api_budget|ops_snapshots|backup_runs|sales_write_guards|sync_outbox|email_outbox|customer_messages|commands/;
export async function exportWebsiteFoodData(db){
  const names=((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'dog_food_%' ORDER BY name").all()).results||[]).map(r=>r.name).filter(n=>/^dog_food_[a-z_]+$/.test(n)&&!excluded.test(n));
  const result=await db.batch(names.map(n=>db.prepare(`SELECT * FROM ${n} LIMIT 20001`)));
  const tables={};let count=0;
  for(let i=0;i<names.length;i++){if(!Array.isArray(result[i]?.results))throw new FoodError('Backup query was not confirmed.',503);const rows=result[i].results;if(rows.length>20000)throw new FoodError('Backup capacity requires review.',503);tables[names[i]]=rows;count+=rows.length;}
  if(count>100000)throw new FoodError('Backup capacity requires review.',503);
  const payload={format:'opwp-food-operations-v1',capturedAt:new Date().toISOString(),recovery:'Use a full D1 recovery point for accounts and credentials.',tables};
  const body=JSON.stringify(payload),bytes=new TextEncoder().encode(body).byteLength;
  if(bytes>25*1024*1024)throw new FoodError('Backup capacity requires review.',503);
  return {payload,body,bytes,sha256:await foodBusinessHash(payload),manifest:Object.fromEntries(Object.entries(tables).map(([n,r])=>[n,r.length]))};
}
export async function backupWebsiteFoodData(env,{manual=false}={}){
  const state=await foodWebsiteState(env.DB);if(state.backend!=='website'||state.writes_paused)return {skipped:true};
  if(!env.FIELD_PROOFS)throw new FoodError('Private backup storage is unavailable.',503);
  const id=manual?'manual-'+crypto.randomUUID():'daily-'+new Date().toISOString().slice(0,10);
  const claim=await env.DB.prepare("INSERT INTO dog_food_backup_runs(id,status) VALUES(?,'running') ON CONFLICT(id) DO UPDATE SET status='running',started_at=CURRENT_TIMESTAMP,error=NULL WHERE status='failed' OR (status='running' AND started_at<datetime('now','-1 hour')) RETURNING id").bind(id).first();
  if(!claim)return {skipped:true};
  try{
    const data=await exportWebsiteFoodData(env.DB),key='dog-food/backups/'+id+'.json';
    await env.FIELD_PROOFS.put(key,data.body,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:data.sha256}});
    const saved=await env.FIELD_PROOFS.get(key);if(!saved||saved.size!==data.bytes)throw Error('Backup verification failed');
    const restored=JSON.parse(await saved.text());if(await foodBusinessHash(restored)!==data.sha256)throw Error('Backup verification failed');
    await env.DB.prepare("UPDATE dog_food_backup_runs SET status='verified',storage_key=?,sha256=?,byte_size=?,manifest=?,verified_at=CURRENT_TIMESTAMP WHERE id=?").bind(key,data.sha256,data.bytes,JSON.stringify(data.manifest),id).run();
    return {id,verified:true,bytes:data.bytes,message:'Private operational backup saved and read back successfully.'};
  }catch(error){await env.DB.prepare("UPDATE dog_food_backup_runs SET status='failed',error='Private backup could not be verified. Retry or use D1 recovery.' WHERE id=?").bind(id).run();throw error;}
}
