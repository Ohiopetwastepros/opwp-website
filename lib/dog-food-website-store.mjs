import {FoodError,foodDate,operationModel} from './dog-food-operations.mjs';

export const FOOD_BUSINESS_TABLES=['Products','Customers','Sales','Subscriptions','Deliveries','Restock Log','Bag Delivery Map','Stock Locations','Purchase Orders','Purchase Order Lines','Inventory Adjustments','Payment Receipts','Supplier Payments'];
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export async function foodBusinessHash(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v)))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function foodWebsiteState(db){
  if(!db||!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_food_store_settings'").first())return {backend:'airtable',writes_paused:0};
  return await db.prepare("SELECT * FROM dog_food_store_settings WHERE id='org-opwp'").first()||{backend:'airtable',writes_paused:0};
}
export async function assertFoodWritesAvailable(db){const state=await foodWebsiteState(db);if(state.writes_paused)throw new FoodError('Dog-food saves are briefly held for the verified database cutover. Keep your draft and retry shortly.',503);return state;}
export async function websiteFoodRouteSource(db){
  const rows=(await db.prepare(`SELECT c.id,c.first_name,c.last_name,c.status,a.line1,a.city,a.state,a.postal_code,a.latitude,a.longitude,r.profile_revision
    FROM dog_food_route_confirmations r JOIN dog_food_customers c ON c.id=r.customer_id JOIN dog_food_customer_reviews v ON v.customer_id=c.id AND v.revision=r.profile_revision AND v.status='reviewed'
    JOIN dog_food_addresses a ON a.customer_id=c.id AND a.is_primary=1 WHERE r.relationship='linked' AND c.status='active' AND c.deleted_at IS NULL LIMIT 5000`).all()).results||[];
  const slots=(await db.prepare("SELECT DISTINCT postal_code,service_date FROM dog_food_delivery_capacity WHERE enabled=1 AND fulfillment_method='delivery' AND service_date>=? LIMIT 5000").bind(foodDate()).all()).results||[];
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return {status:'success',stale:false,backend:'website',capturedAt:new Date().toISOString(),clients:rows.map(c=>({id:c.id,name:[c.first_name,c.last_name].join(' '),address:c.line1,city:c.city,zip:c.postal_code,lat:c.latitude,lon:c.longitude,serviceDays:[...new Set(slots.filter(s=>s.postal_code===c.postal_code).map(s=>days[new Date(s.service_date+'T12:00:00Z').getUTCDay()]))],technicians:[],duplicateProvider:false}))};
}
export async function websiteFoodSnapshot(db){
  if(db.foodBusinessContext)return {snapshot:db.foodBusinessContext.snapshot,sync:db.foodBusinessContext.sync};
  const state=await foodWebsiteState(db);if(state.backend!=='website')return null;
  if(!state.import_id)throw new FoodError('Website operating history has not been verified.',503);
  const rows=(await db.prepare("SELECT * FROM dog_food_business_records WHERE import_id=? OR source_provider='website' ORDER BY table_name,id LIMIT 60001").bind(state.import_id).all()).results||[];
  if(rows.length>60000)throw new FoodError('Operating history exceeds its reviewed bound.',503);
  const tables=Object.fromEntries(FOOD_BUSINESS_TABLES.map(t=>[t,[]]));
  for(const r of rows){if(!tables[r.table_name]||tables[r.table_name].length>=5000)throw new FoodError('Operating table exceeds its reviewed bound.',503);tables[r.table_name].push({id:r.id,fields:JSON.parse(r.fields),createdTime:r.created_at,revision:r.revision});}
  const ops=await db.prepare("SELECT * FROM dog_food_ops_state WHERE id='org-opwp'").first();
  return {snapshot:{tables,backend:'website',capturedAt:state.updated_at},sync:{...ops,backend:'website',configured:true,dirty:0,last_error:null,last_success_at:state.updated_at,capturedAt:state.updated_at,revision:state.revision,source_captured_at:state.source_captured_at}};
}
export async function websiteFoodContext(env,{commandId,actor,token}){
  const data=await websiteFoodSnapshot(env.DB);if(!data)throw new FoodError('Website ledger is not active.',409);
  await assertFoodWritesAvailable(env.DB);
  const context={commandId,actor,token,snapshot:structuredClone(data.snapshot),sync:data.sync,changes:new Map(),statements:[]};
  const db={prepare:sql=>env.DB.prepare(sql),batch:statements=>env.DB.batch(statements),foodBusinessContext:context};
  return {...env,DB:db,foodBusinessContext:context};
}
export async function stageFoodBusinessRecord(env,name,fields,id=null){
  if(!FOOD_BUSINESS_TABLES.includes(name)||!fields||Array.isArray(fields)||typeof fields!=='object'||JSON.stringify(fields).length>1000000)throw new FoodError('Invalid operating record.');
  const ctx=env.foodBusinessContext||env.DB.foodBusinessContext;
  if(!ctx)throw new FoodError('Operating writes require an atomic website command.',409);
  id=id||crypto.randomUUID();if(typeof id!=='string'||id.length>150)throw new FoodError('Invalid operating record ID.');
  const rows=ctx.snapshot.tables[name],index=rows.findIndex(r=>r.id===id),old=index>=0?rows[index]:null,key=name+':'+id;
  const record={id,fields:{...old?.fields,...fields},createdTime:old?.createdTime||new Date().toISOString(),revision:old?.revision||0};
  if(!ctx.changes.has(key))ctx.changes.set(key,{name,id,before:old?structuredClone(old):null,record});else ctx.changes.get(key).record=record;
  if(index>=0)rows[index]=record;else rows.push(record);return record;
}
export async function queueFoodStatement(db,statement){if(db.foodBusinessContext){db.foodBusinessContext.statements.push(statement);return {meta:{changes:1}};}return statement.run();}
export async function commitFoodBusinessContext(env,result,{commandBody=null,payloadHash=null}={}){
  const db=env.DB,ctx=env.foodBusinessContext||db.foodBusinessContext;if(!ctx)throw new FoodError('Missing operating transaction.',409);
  const statements=[db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_ops_state WHERE id='org-opwp' AND command_token=? AND command_until>CURRENT_TIMESTAMP)
    AND EXISTS(SELECT 1 FROM dog_food_store_settings WHERE id='org-opwp' AND backend='website' AND writes_paused=0 AND revision=?) THEN 1 ELSE 0 END)`).bind(ctx.commandId+'-store',ctx.token,ctx.sync.revision)];
  for(const {name,id,before,record} of ctx.changes.values()){
    statements.push(db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN COALESCE((SELECT revision FROM dog_food_business_records WHERE table_name=? AND id=?),0)=? THEN 1 ELSE 0 END)`).bind(ctx.commandId+':'+name+':'+id,name,id,before?.revision||0));
    statements.push(db.prepare(`INSERT INTO dog_food_business_records(table_name,id,fields,revision,source_provider,created_at) VALUES(?,?,?,1,'website',?)
      ON CONFLICT(table_name,id) DO UPDATE SET fields=excluded.fields,revision=revision+1,updated_at=CURRENT_TIMESTAMP`).bind(name,id,JSON.stringify(record.fields),record.createdTime));
    statements.push(db.prepare('INSERT INTO dog_food_business_events(id,command_id,table_name,record_id,actor,before_fields,after_fields,revision) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),ctx.commandId,name,id,ctx.actor,before?JSON.stringify(before.fields):null,JSON.stringify(record.fields),(before?.revision||0)+1));
    statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(ctx.commandId+':'+name+':'+id));
  }
  statements.push(...ctx.statements);
  if(ctx.changes.size){
    const snapshotId=crypto.randomUUID();
    statements.push(db.prepare('INSERT INTO dog_food_ops_snapshots(id,payload) VALUES(?,?)').bind(snapshotId,JSON.stringify(ctx.snapshot)),db.prepare("UPDATE dog_food_ops_state SET snapshot_id=?,dirty=0,last_error=NULL,last_success_at=CURRENT_TIMESTAMP WHERE id='org-opwp'").bind(snapshotId));
  }
  statements.push(db.prepare("UPDATE dog_food_store_settings SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id='org-opwp'"));
  if(commandBody){
    statements.push(db.prepare("INSERT INTO dog_food_ops_commands(id,actor,action,payload_hash,status,result) VALUES(?,?,?,?,'complete',?)").bind(ctx.commandId,ctx.actor,commandBody.action,payloadHash,JSON.stringify(result)));
    statements.push(db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),ctx.actor,commandBody.action,commandBody.id||commandBody.saleId||result?.id||null,JSON.stringify({commandId:ctx.commandId,backend:'website',records:ctx.changes.size})));
  }
  statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(ctx.commandId+'-store'));
  await db.batch(statements);return result;
}
export async function standaloneFoodBusinessWrite(env,name,fields,id=null){
  await assertFoodWritesAvailable(env.DB);const token=crypto.randomUUID();
  const lock=await env.DB.prepare("UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+2 minutes') WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id").bind(token).first();
  if(!lock)throw new FoodError('Another inventory operation is in progress. Retry shortly.',409);
  try{const e=await websiteFoodContext(env,{commandId:token,actor:env.foodRecordActor||'website-service',token}),r=await stageFoodBusinessRecord(e,name,fields,id);await commitFoodBusinessContext(e,r);return r;}
  finally{await env.DB.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE id='org-opwp' AND command_token=?").bind(token).run();}
}
export function foodCutoverTotals(snapshot,native={}){
  const m=operationModel(snapshot,native);
  return {records:Object.fromEntries(FOOD_BUSINESS_TABLES.map(t=>[t,(snapshot.tables[t]||[]).length])),sales:m.sales.map(s=>({id:s.id,total:s.totalCents,collected:s.collectedCents,balance:s.balanceCents,quantity:s.quantity,fulfillment:s.fulfillment,warnings:s.warnings,reportingWarnings:s.reportingWarnings})).sort((a,b)=>a.id.localeCompare(b.id)),
    stock:m.products.map(p=>({id:p.id,websiteId:p.websiteId,onHand:p.onHand,reserved:p.reserved,available:p.available,countDate:p.countDate,confirmed:p.confirmed})).sort((a,b)=>a.id.localeCompare(b.id)),plans:m.subscriptions.map(p=>({id:p.id,status:p.status,quantity:p.quantity,next:p.next})).sort((a,b)=>a.id.localeCompare(b.id)),purchaseTotals:m.pos.map(p=>({id:p.id,total:p.totalCents,paid:p.paidCents,received:p.received})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export async function importWebsiteFoodRecords(db,snapshot,{actor,sourceHash,expectedSourceHash,reconciliation,activate=false}={}){
  if(!actor||!sourceHash||sourceHash!==expectedSourceHash||await foodBusinessHash(snapshot)!==sourceHash||reconciliation?.verified!==true)throw new FoodError('A reviewed source hash and reconciled import are required.',409);
  const state=await foodWebsiteState(db);if(state.backend==='website')throw new FoodError('The website ledger is already active; it cannot be overwritten by an import.',409);
  const id=sourceHash,statements=[];
  const old=await db.prepare('SELECT id FROM dog_food_business_imports WHERE id=?').bind(id).first();if(!old)statements.push(db.prepare('INSERT INTO dog_food_business_imports(id,source_hash,manifest,reconciliation,imported_by) VALUES(?,?,?,?,?)').bind(id,sourceHash,JSON.stringify(Object.fromEntries(FOOD_BUSINESS_TABLES.map(t=>[t,(snapshot.tables[t]||[]).length]))),JSON.stringify(reconciliation),actor));
  for(const name of FOOD_BUSINESS_TABLES)for(const r of snapshot.tables[name]||[])statements.push(db.prepare(`INSERT INTO dog_food_business_records(table_name,id,fields,source_provider,source_record_id,import_id,created_at) VALUES(?,?,?,'airtable',?,?,?)
    ON CONFLICT(table_name,id) DO UPDATE SET fields=excluded.fields,import_id=excluded.import_id,updated_at=CURRENT_TIMESTAMP WHERE source_provider='airtable'`).bind(name,r.id,JSON.stringify(r.fields),r.id,id,r.createdTime||new Date().toISOString()));
  // Chunked staging is invisible until one final, guarded activation.
  for(let i=0;i<statements.length;i+=80)await db.batch(statements.slice(i,i+80));
  const rows=(await db.prepare('SELECT table_name,id,fields FROM dog_food_business_records WHERE import_id=? ORDER BY table_name,id').bind(id).all()).results||[];
  const actual={...snapshot,tables:Object.fromEntries(FOOD_BUSINESS_TABLES.map(t=>[t,rows.filter(r=>r.table_name===t).map(r=>({id:r.id,fields:JSON.parse(r.fields)}))]))};
  for(const name of FOOD_BUSINESS_TABLES){const before=[...(snapshot.tables[name]||[])].map(r=>({id:r.id,fields:r.fields})).sort((a,b)=>a.id.localeCompare(b.id));if(await foodBusinessHash(before)!==await foodBusinessHash([...actual.tables[name]].sort((a,b)=>a.id.localeCompare(b.id))))throw new FoodError('Imported rows differ from the reviewed source.',409);}
  if(activate){
    const snapshotId=crypto.randomUUID();await db.batch([
      db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_store_settings WHERE id='org-opwp' AND backend='airtable' AND writes_paused=1) AND NOT EXISTS(SELECT 1 FROM dog_food_ops_state WHERE command_until>=CURRENT_TIMESTAMP) THEN 1 ELSE 0 END)").bind('activate:'+id),
      db.prepare('INSERT INTO dog_food_ops_snapshots(id,payload) VALUES(?,?)').bind(snapshotId,JSON.stringify(snapshot)),
      db.prepare("UPDATE dog_food_store_settings SET backend='website',writes_paused=0,import_id=?,source_hash=?,source_captured_at=?,activated_by=?,activated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id='org-opwp'").bind(id,sourceHash,snapshot.capturedAt||null,actor),
      db.prepare("UPDATE dog_food_ops_state SET snapshot_id=?,dirty=0,last_error=NULL,last_success_at=CURRENT_TIMESTAMP WHERE id='org-opwp'").bind(snapshotId),
      db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'website_food_cutover','org-opwp',?)").bind(crypto.randomUUID(),actor,JSON.stringify({importId:id,sourceHash,verified:true})),
      db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind('activate:'+id),
    ]);
  }
  return {importId:id,records:rows.length,activated:activate,date:foodDate()};
}
