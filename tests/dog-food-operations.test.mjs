import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import schema from '../data/dog-food-airtable-schema.json' with {type:'json'};
import * as logic from '../lib/dog-food-operations.mjs';
import * as websiteStore from '../lib/dog-food-website-store.mjs';
import {readFoodSalesIntelligence} from '../lib/dog-food-sales-intelligence.mjs';
import {readBoundedBytes,readBoundedProviderJson} from '../lib/bounded-body.mjs';
const source=fs.readFileSync(new URL('../lib/dog-food-ops-store.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const row=(id,fields)=>({id,fields});
function snapshot(){return {tables:{Products:[row('recPink',{'Product Name':'Chicken (Pink)','Formula Code':'22-12','Bag Weight':40,'DC Cost':30,'Dealer Price':40,'Retail Price':60,'Active Status':true,'Website Product ID':'edf-22-12-pink-40'})],Sales:[row('recSale',{'Sold To':'Real Buyer',Product:['recPink'],'Bag Quantity':2,'Sale Date':'2026-10-02','Amount Collected':120,'Payment Status':'Unpaid',Notes:'Collect a check'})], 'Inventory Adjustments':[row('recCount',{'Product':['recPink'],'Movement Type':'Stock Count','Counted Quantity':10,'Movement Date':'2026-10-01',Reason:'End-of-day count'})]}};}
function fixture(seed=snapshot()) {
  const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0007_dog_food_foundation.sql',import.meta.url),'utf8'));sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0025_dog_food_stripe.sql',import.meta.url),'utf8'));sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0049_dog_food_operations.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0050_dog_food_collections.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0020_route_partner_foundation.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0022_technician_field_app.sql',import.meta.url),'utf8'));
  sql.exec("CREATE TABLE IF NOT EXISTS airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);");
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0051_dog_food_customer_portal.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0052_dog_food_workflow.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0053_dog_food_delivery_choices.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0054_dog_food_sales_review.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0055_dog_food_experience.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('./fixtures/dog-food-inventory-schema.sql',import.meta.url),'utf8'));
  const db={prepare:q=>{const statement={bind:(...args)=>({first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:sql.prepare(q).run(...args)})}),first:async()=>sql.prepare(q).get()||null,all:async()=>({results:sql.prepare(q).all()}),run:async()=>({meta:sql.prepare(q).run()})};return statement;},batch:async statements=>{sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  sql.prepare('INSERT INTO dog_food_ops_snapshots(id,payload) VALUES (?,?)').run('initial',JSON.stringify(seed));sql.exec("UPDATE dog_food_ops_state SET snapshot_id='initial',dirty=0,last_success_at=CURRENT_TIMESTAMP");
  const records=Object.fromEntries(Object.keys(schema.tables).map(name=>[name,(seed.tables[name]||[]).map(r=>({id:r.id,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[schema.tables[name].fields[k],v]))}))]));
  let calls=0,fail=false;
  async function outboundFetch(url,options={}){calls++;if(fail)return Response.json({error:{}},{status:503});const parsed=new URL(url),segments=parsed.pathname.split('/').filter(Boolean),t=Object.entries(schema.tables).find(([,t])=>t.id===segments[2]);if(!t)return Response.json({error:{}},{status:404});const name=t[0];
    if(options.method){const body=JSON.parse(options.body);const saved=body.records.map(r=>{let v=r.id?records[name].find(v=>v.id===r.id):null;if(!v){v={id:'rec'+crypto.randomUUID().replaceAll('-','').slice(0,14),fields:{}};records[name].push(v);}Object.assign(v.fields,r.fields);return v;});return Response.json({records:saved});}
    if(segments[3])return Response.json(records[name].find(r=>r.id===segments[3])||{}, {status:records[name].some(r=>r.id===segments[3])?200:404});
    return Response.json({records:records[name]});
  }
  const context={...websiteStore,...logic,readFoodSalesIntelligence,schema,crypto,setTimeout,TextEncoder,TextDecoder,atob,URL,URLSearchParams,Response,console,outboundFetch,readBoundedProviderJson};
  const service=runPrivateInNewContext(`${source}\n({readFoodOperations,readFoodSnapshot,syncFoodOperations,foodOperation,runFoodCommand})`,context);
  return {sql,db,service,env:{DB:db,AIRTABLE_API_KEY:'test'},records,calls:()=>calls,fail:()=>{fail=true;}};
}
test('unpaid delivered bags deduct stock, cash is independent, count excludes earlier activity',()=>{
  const s=snapshot();s.tables.Sales.push(row('old',{'Sold To':'Past Buyer',Product:['recPink'],'Bag Quantity':100,'Sale Date':'2026-09-30','Amount Collected':6000,'Payment Status':'Paid'}));
  const m=logic.operationModel(s);assert.equal(m.products[0].onHand,8);assert.equal(m.metrics.receivablesCents,12000);assert.equal(m.metrics.collectedCents,600000);assert.equal(m.metrics.stockBags,8);
});
test('unreconciled inventory stays unknown instead of displaying fabricated zero',()=>{const s=snapshot();s.tables['Inventory Adjustments']=[];const m=logic.operationModel(s);assert.equal(m.products[0].onHand,null);assert.equal(m.metrics.stockBags,null);});
test('intraday physical counts exclude prior deliveries and deduct later same-day deliveries',()=>{
  const s=snapshot(),d=logic.foodDate();s.tables['Inventory Adjustments']=[row('intraday',{Product:['recPink'],'Movement Type':'Stock Count','Counted Quantity':8,'Movement Date':d,'Counted At (Website)':`${d}T15:30:00.000Z`})];
  for(const [id,at] of [['before','15:00'],['after','16:00']])s.tables.Sales.push(row(id,{'Sold To':id,Product:['recPink'],'Bag Quantity':2,'Sale Date':d,'Sale Total':120,'Fulfillment Status':'Delivered','Stock Movement Date (Website)':d,'Stock Movement At (Website)':`${d}T${at}:00.000Z`}));
  const m=logic.operationModel(s);assert.equal(m.products[0].onHand,6);assert.equal(m.products[0].confirmed,true);
});
test('intraday counts with unknown same-day movement times fail closed',()=>{
  const s=snapshot(),d=logic.foodDate();s.tables['Inventory Adjustments']=[row('intraday',{Product:['recPink'],'Movement Type':'Stock Count','Counted Quantity':8,'Movement Date':d,'Counted At (Website)':`${d}T15:30:00.000Z`})];
  s.tables.Sales.push(row('unknown-time',{'Sold To':'Legacy Buyer',Product:['recPink'],'Bag Quantity':2,'Sale Date':d,'Sale Total':120}));
  const m=logic.operationModel(s);assert.equal(m.products[0].onHand,null);assert.equal(m.products[0].confirmed,false);assert.ok(m.issues.some(i=>i.message.includes('exact time')));
});
test('paid purchase orders add stock only at physical receipt; waste removes usable stock',()=>{const s=snapshot();s.tables['Purchase Orders']=[row('po',{'PO Number':'PO1','Amount Paid':300, 'PO Status':'Ordered'})];s.tables['Purchase Order Lines']=[row('line',{'Purchase Order':['po'],Product:['recPink'],'Ordered Quantity':10,'Received Quantity':0,'Cost Per Bag':30})];let m=logic.operationModel(s);assert.equal(m.products[0].onHand,8);assert.equal(m.metrics.supplierPaidCents,30000);
  s.tables['Purchase Order Lines'][0].fields['Received Quantity']=4;s.tables['Purchase Order Lines'][0].fields['Received Date']='2026-10-02';s.tables['Inventory Adjustments'].push(row('waste',{'Product':['recPink'],'Movement Type':'Waste','Quantity Change':-2,'Movement Date':'2026-10-03',Reason:'Expired'}));m=logic.operationModel(s);assert.equal(m.products[0].onHand,10);assert.equal(m.metrics.wasteBags,2);
});
test('partial receipts reduce balance, never deduct bags twice',()=>{const s=snapshot();s.tables['Payment Receipts']=[row('pay',{Sale:['recSale'],Amount:100,'Receipt Reference':'R1'})];const m=logic.operationModel(s);assert.equal(m.unpaid[0].balanceCents,2000);assert.equal(m.unpaid[0].paymentStatus,'Partial');assert.equal(m.products[0].onHand,8);});
test('note conflicts and duplicate receipt references are visible review flags',()=>{const s=snapshot();s.tables.Sales[0].fields.Notes='Still owes $20';s.tables['Payment Receipts']=[row('pay',{Sale:['recSale'],Amount:10,'Receipt Reference':'R1'}),row('pay2',{Sale:['recSale'],Amount:10,'Receipt Reference':'R1'})];const m=logic.operationModel(s);assert.ok(m.unpaid[0].warnings.includes('Collection note conflicts with recorded balance'));assert.ok(m.unpaid[0].warnings.includes('Duplicate payment reference'));});
test('restores and archives recalculate stock while retaining source rows',()=>{const s=snapshot();s.tables.Sales[0].fields['Record Status']='Archived';let m=logic.operationModel(s);assert.equal(m.products[0].onHand,10);assert.equal(m.sales.length,0);assert.equal(m.archived.length,1);s.tables.Sales[0].fields['Record Status']='Active';assert.equal(logic.operationModel(s).products[0].onHand,8);});
test('real SQL sync persists exact product mappings and a complete snapshot',async()=>{const f=fixture();const r=await f.service.syncFoodOperations(f.env,{force:true});assert.equal(r.configured,true);assert.equal((await f.service.readFoodOperations(f.db)).metrics.stockBags,8);assert.equal(f.sql.prepare("SELECT unit_cost_cents FROM dog_food_products WHERE id='edf-22-12-pink-40'").get().unit_cost_cents,4000);assert.equal(f.sql.prepare("SELECT retail_price_cents FROM dog_food_products WHERE id='edf-22-12-pink-40'").get().retail_price_cents,6000);});
test('failed provider read retains last verified data and marks sync dirty',async()=>{const f=fixture();f.fail();await assert.rejects(f.service.syncFoodOperations(f.env,{force:true}),/Airtable/);const s=await f.service.readFoodSnapshot(f.db);assert.equal(s.sync.snapshot_id,'initial');assert.equal(s.sync.dirty,1);});
test('idempotent payment command creates one receipt, rejects a reused reference and overpayment',async()=>{const f=fixture();const body={action:'record_payment',commandId:crypto.randomUUID(),saleId:'recSale',amount:'100',date:'2026-10-07',method:'Cash',reference:'Receipt-1'};
  const a=await f.service.runFoodCommand(f.env,body,'admin');const b=await f.service.runFoodCommand(f.env,body,'admin');assert.equal(a.id,b.id);assert.equal(f.records['Payment Receipts'].length,1);
  await f.service.syncFoodOperations(f.env,{force:true});assert.equal((await f.service.readFoodOperations(f.db)).unpaid[0].balanceCents,2000);
  await assert.rejects(f.service.runFoodCommand(f.env,{...body,commandId:crypto.randomUUID(),amount:'1'},'admin'),/already been recorded/);
  await assert.rejects(f.service.runFoodCommand(f.env,{...body,commandId:crypto.randomUUID(),reference:'Receipt-2',amount:'25'},'admin'),/outstanding balance/);
});
test('stock oversell, foreign product IDs and unchecked deletion are rejected',async()=>{const f=fixture();f.sql.exec("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES ('direct-buyer','Test','Buyer','direct@example.test','4195550100')");const base={customerId:'direct-buyer',action:'save_sale',commandId:crypto.randomUUID(),name:'Buyer',quantity:99,date:'2026-10-07',productId:'recPink',total:'60',paid:'0',method:'Cash',fulfillment:'Delivered'};
  await assert.rejects(f.service.foodOperation(f.env,base,'admin'),/not enough confirmed stock/);
  await assert.rejects(f.service.foodOperation(f.env,{...base,productId:'recOtherBusiness'},'admin'),/not found/);
  await assert.rejects(f.service.foodOperation(f.env,{action:'archive',table:'Sales',id:'recSale'},'admin'),/Confirm/);
});
test('archiving a sale requires confirmation, reflects in both systems, and can be restored',async()=>{const f=fixture();await f.service.foodOperation(f.env,{action:'archive',table:'Sales',id:'recSale',confirmed:true},'admin');await f.service.syncFoodOperations(f.env,{force:true});assert.equal((await f.service.readFoodOperations(f.db)).metrics.stockBags,10);await f.service.foodOperation(f.env,{action:'restore',table:'Sales',id:'recSale',confirmed:true},'admin');await f.service.syncFoodOperations(f.env,{force:true});assert.equal((await f.service.readFoodOperations(f.db)).metrics.stockBags,8);});
test('signed webhook rejects forged, missing or modified payloads',async()=>{const src=fs.readFileSync(new URL('../lib/dog-food-ops-automation.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');const verify=runPrivateInNewContext(`${src}\nverifyFoodWebhook`,{crypto,atob,Uint8Array});const secret=btoa('01234567890123456789012345678901'),bytes=new TextEncoder().encode('{"base":{"id":"example"}}'),k=await crypto.subtle.importKey('raw',new TextEncoder().encode(atob(secret)),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');assert.equal(await verify(bytes,'hmac-sha256='+sig,secret),true);assert.equal(await verify(new Uint8Array([1]),'hmac-sha256='+sig,secret),false);assert.equal(await verify(bytes,'',secret),false);assert.equal(await verify(bytes,'hmac-sha256='+sig,''),false);});
test('admin operations API enforces authentication, origin and streamed request bounds',async()=>{const src=fs.readFileSync(new URL('../app/api/admin/dog-food/operations/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');let authorized=false,calls=0;const ctx={Response,URL,RangeError,SyntaxError,TextDecoder,readBoundedBytes,FoodError:logic.FoodError,console,verifyAdminRequest:async()=>({authorized,email:'admin'}),getRuntimeEnv:()=>({DB:{}}),checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>Response.json({}, {status:429}),readFoodOperations:async()=>({}),runFoodCommand:async()=>{calls++;return {}},syncFoodOperations:async()=>({})};const api=runPrivateInNewContext(`${src}\n({GET,POST})`,ctx);const req=(origin,body='{}')=>new Request('https://opwp.test/api/admin/dog-food/operations/',{method:'POST',headers:{origin},body});assert.equal((await api.POST(req('https://opwp.test'))).status,401);authorized=true;assert.equal((await api.POST(req('https://evil.test'))).status,403);assert.equal((await api.POST(req('https://opwp.test','x'.repeat(20000)))).status,413);assert.equal(calls,0);});
test('strict amounts, integer quantities and real calendar dates reject malformed input',()=>{for(const v of ['-1','1.001','Infinity','1e6','NaN'])assert.throws(()=>logic.cents(v));assert.throws(()=>logic.integer('1.5','bags'));assert.throws(()=>logic.date('2026-02-30'));});
test('partial PO receipts keep their individual dates across a physical count and never double count the PO line',()=>{
  const s=snapshot();s.tables['Purchase Orders']=[row('po',{'PO Number':'PO1','PO Status':'Received'})];s.tables['Purchase Order Lines']=[row('line',{'Purchase Order':['po'],Product:['recPink'],'Ordered Quantity':10,'Received Quantity':10,'Received Date':'2026-10-03','Cost Per Bag':30})];
  s.tables['Restock Log']=[row('first',{Product:['recPink'],'Bags Received':4,'Date Received':'2026-09-30','Purchase Order ID':'po'}),row('second',{Product:['recPink'],'Bags Received':6,'Date Received':'2026-10-03','Purchase Order ID':'po'})];
  assert.equal(logic.operationModel(s).products[0].onHand,14);s.tables['Restock Log'][1].fields['Record Status']='Archived';assert.equal(logic.operationModel(s).products[0].onHand,8);
  s.tables['Restock Log'][0].fields['Record Status']='Archived';assert.equal(logic.operationModel(s).products[0].onHand,8);
});
test('latest same-day physical count uses record creation time, not random record identity',()=>{
  const s=snapshot();s.tables['Inventory Adjustments'][0].createdTime='2026-10-01T19:00:00Z';s.tables['Inventory Adjustments'].push({...row('aaa',{Product:['recPink'],'Movement Type':'Stock Count','Counted Quantity':12,'Movement Date':'2026-10-01'}),createdTime:'2026-10-01T20:00:00Z'});assert.equal(logic.operationModel(s).products[0].onHand,10);
});
test('server prevents future physical movements and replacing a sold product to bypass stock checks',async()=>{
  const s=snapshot();s.tables.Products.push(row('recBlue',{'Product Name':'Blue','Formula Code':'26-14','Bag Weight':40,'Active Status':true}));s.tables['Inventory Adjustments'].push(row('blueCount',{Product:['recBlue'],'Movement Type':'Stock Count','Counted Quantity':0,'Movement Date':'2026-10-01'}));const f=fixture(s);
  await assert.rejects(f.service.foodOperation(f.env,{action:'stock_movement',productId:'recPink',type:'Stock Count',quantity:10,date:'2099-01-01',reason:'Count'},'admin'),/future/);
  await assert.rejects(f.service.foodOperation(f.env,{action:'save_sale',id:'recSale',productId:'recBlue',quantity:1,date:'2026-10-07',total:'60',paid:'0',name:'Buyer',method:'Cash',fulfillment:'Delivered'},'admin'),/not enough confirmed stock/);
});
test('provider request budget fails closed before a network call',async()=>{
  const f=fixture(),d=new Date().toISOString().slice(0,10);f.sql.prepare('INSERT INTO dog_food_api_budget(usage_day,requests,next_request_ms) VALUES (?,1000,0)').run(d);await assert.rejects(f.service.syncFoodOperations(f.env,{force:true}),/daily request cap/);assert.equal(f.calls(),0);assert.equal((await f.service.readFoodSnapshot(f.db)).sync.snapshot_id,'initial');
});
test('native deletion is recoverable and does not erase customer history or orders',async()=>{
  const f=fixture();f.sql.exec("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,customer_type) VALUES ('test-profile','Test','Buyer','test@example.test','4195550182','on_demand')");await f.service.foodOperation(f.env,{action:'delete_native',entity:'customer',id:'test-profile',confirmed:true},'admin');assert.equal((await f.service.readFoodOperations(f.db)).native.customers.length,0);assert.ok(f.sql.prepare("SELECT deleted_at FROM dog_food_customers WHERE id='test-profile'").get().deleted_at);await f.service.foodOperation(f.env,{action:'restore_native',entity:'customer',id:'test-profile',confirmed:true},'admin');assert.equal((await f.service.readFoodOperations(f.db)).native.customers.length,1);
});
test('mixed-formula purchase totals and partial shipment increments produce exact stock movements',async()=>{
  const s=snapshot();s.tables.Products.push(row('recBlue',{'Product Name':'Blue','Formula Code':'26-14','Bag Weight':40,'Active Status':true,'DC Cost':27}));s.tables['Inventory Adjustments'].push(row('blueCount',{Product:['recBlue'],'Movement Type':'Stock Count','Counted Quantity':20,'Movement Date':'2026-10-01'}));const f=fixture(s);
  const body={action:'save_purchase',commandId:crypto.randomUUID(),number:'Mixed-1',supplier:"Example Supplier",date:'2026-10-02',freight:'10',paid:'445',lines:[{productId:'recPink',quantity:10,received:4,cost:'30',receivedDate:'2026-10-02'},{productId:'recBlue',quantity:5,received:2,cost:'27',receivedDate:'2026-10-02'}]};
  const saved=await f.service.foodOperation(f.env,body,'admin');assert.equal(saved.lineIds.length,2);await f.service.syncFoodOperations(f.env,{force:true});let data=await f.service.readFoodOperations(f.db);assert.equal(data.pos[0].totalCents,44500);assert.equal(data.pos[0].paidCents,44500);assert.equal(data.products.find(p=>p.id==='recPink').onHand,12);assert.equal(data.products.find(p=>p.id==='recBlue').onHand,22);
  await f.service.foodOperation(f.env,{...body,id:saved.id,commandId:crypto.randomUUID(),lines:body.lines.map(l=>({...l,received:l.productId==='recPink'?6:5,receivedDate:'2026-10-07'}))},'admin');await f.service.syncFoodOperations(f.env,{force:true});data=await f.service.readFoodOperations(f.db);assert.equal(f.records['Restock Log'].length,4);assert.equal(data.products.find(p=>p.id==='recPink').onHand,14);assert.equal(data.products.find(p=>p.id==='recBlue').onHand,25);assert.equal(data.pos[0].status,'Partially Received');
  await assert.rejects(f.service.foodOperation(f.env,{...body,id:saved.id,lines:[body.lines[0]]},'admin'),/Received bags cannot be reduced|cannot be removed/);
});
test('purchase validation completes before any supplier header or receipt is written',async()=>{
  const f=fixture();await assert.rejects(f.service.foodOperation(f.env,{action:'save_purchase',number:'Bad',supplier:'Supplier',date:'2026-10-07',paid:'0',lines:[{productId:'recPink',quantity:10,received:0,cost:'30'},{productId:'recForeign',quantity:1,received:0,cost:'30'}]},'admin'),/not found/);assert.equal(f.calls(),0);assert.equal(f.records['Purchase Orders'].length,0);
});
