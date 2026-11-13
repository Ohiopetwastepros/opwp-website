import {runPrivateInNewContext} from './private-vm.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import schema from '../../data/dog-food-airtable-schema.json' with {type:'json'};
import workflowSchema from '../../data/dog-food-workflow-schema.json' with {type:'json'};
import * as logic from '../../lib/dog-food-operations.mjs';
import {readFoodSalesIntelligence} from '../../lib/dog-food-sales-intelligence.mjs';
import {readBoundedProviderJson} from '../../lib/bounded-body.mjs';
import * as websiteFoodStore from '../../lib/dog-food-website-store.mjs';
import * as launchHelpers from '../../lib/food-launch-readiness.mjs';
import * as sourceHelpers from '../../lib/food-source-reconciliation.mjs';
import * as intakeHelpers from '../../lib/food-customer-intake.mjs';
import * as legacyFoodPlans from '../../lib/dog-food-legacy-plans.mjs';
import {receiptStatements,foodSalesOrder} from '../../lib/food-sales-ledger.mjs';
const source=fs.readFileSync(new URL('../../lib/dog-food-ops-store.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const row=(id,fields)=>({id,fields});
function snapshot(){return {tables:{Products:[row('recPink',{'Product Name':'Chicken (Pink)','Formula Code':'22-12','Bag Weight':40,'DC Cost':30,'Retail Price':60,'Active Status':true,'Website Product ID':'edf-22-12-pink-40'})],Sales:[row('recABCDEFGH',{'Sold To':'Real Buyer',Product:['recPink'],'Bag Quantity':2,'Sale Date':'2026-10-02','Amount Collected':120,'Payment Status':'Unpaid','Fulfillment Status':'Delivered',Notes:'Collect a check'})], 'Inventory Adjustments':[row('recCount',{'Product':['recPink'],'Movement Type':'Stock Count','Counted Quantity':10,'Movement Date':'2026-10-01',Reason:'End-of-day count'})]}};}
export function fixture(seed=snapshot(),{routes=false,optionalIntake=true}={}) {
  const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0007_dog_food_foundation.sql',import.meta.url),'utf8'));sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0025_dog_food_stripe.sql',import.meta.url),'utf8'));sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0049_dog_food_operations.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0050_dog_food_collections.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0020_route_partner_foundation.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0022_technician_field_app.sql',import.meta.url),'utf8'));
  sql.exec("CREATE TABLE IF NOT EXISTS airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);");
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0051_dog_food_customer_portal.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0052_dog_food_workflow.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0053_dog_food_delivery_choices.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0054_dog_food_sales_review.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../tmp/test-migrations/0055_dog_food_experience.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../fixtures/dog-food-inventory-schema.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../../schema-proposals/0062_food_customer_hub.sql',import.meta.url),'utf8'));
  if(optionalIntake)sql.exec(fs.readFileSync(new URL('../../schema-proposals/0065_food_customer_optional_intake.sql',import.meta.url),'utf8'));
  const db={prepare:q=>{const statement={bind:(...args)=>({first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>(/\bRETURNING\b/i.test(q)||/^\s*SELECT\b/i.test(q))?({results:sql.prepare(q).all(...args),meta:sql.prepare("SELECT changes() changes").get()}):({meta:sql.prepare(q).run(...args)})}),first:async()=>sql.prepare(q).get()||null,all:async()=>({results:sql.prepare(q).all()}),run:async()=>/^\s*SELECT\b/i.test(q)?({results:sql.prepare(q).all()}):({meta:sql.prepare(q).run()})};return statement;},batch:async statements=>{sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  sql.prepare('INSERT INTO dog_food_ops_snapshots(id,payload) VALUES (?,?)').run('initial',JSON.stringify(seed));sql.exec("UPDATE dog_food_ops_state SET snapshot_id='initial',dirty=0,last_success_at=CURRENT_TIMESTAMP");
  const records=Object.fromEntries(Object.keys(schema.tables).map(name=>[name,(seed.tables[name]||[]).map(r=>({id:r.id,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[schema.tables[name].fields[k],v]))}))]));
  records['Website Workflow']=[];
  const transportSchema={...schema.tables,'Website Workflow':{id:workflowSchema.tableId,fields:workflowSchema.fields}};
  let calls=0,fail=false,loseWriteResponse=false;
  async function outboundFetch(url,options={}){calls++;if(fail)return Response.json({error:{}},{status:503});const parsed=new URL(url),segments=parsed.pathname.split('/').filter(Boolean),t=Object.entries(transportSchema).find(([,t])=>t.id===segments[2]);if(!t)return Response.json({error:{}},{status:404});const name=t[0];
    if(options.method){const body=JSON.parse(options.body);const merge=body.performUpsert?.fieldsToMergeOn?.[0];const saved=body.records.map(r=>{let v=r.id?records[name].find(v=>v.id===r.id):merge?records[name].find(v=>v.fields[merge]===r.fields[merge]):null;if(!v){v={id:'rec'+crypto.randomUUID().replaceAll('-','').slice(0,14),fields:{}};records[name].push(v);}Object.assign(v.fields,r.fields);return v;});if(loseWriteResponse){loseWriteResponse=false;return Response.json({error:{}},{status:503});}return Response.json({records:saved});}
    if(segments[3])return Response.json(records[name].find(r=>r.id===segments[3])||{}, {status:records[name].some(r=>r.id===segments[3])?200:404});
    const filter=parsed.searchParams.get('filterByFormula'),match=filter&&/^\{([^}]+)\}='([^']+)'$/.exec(filter);
    return Response.json({records:match?records[name].filter(r=>r.fields[match[1]]===match[2]):records[name]});
  }
  const context={...launchHelpers,...sourceHelpers,...websiteFoodStore,receiptStatements,foodSalesOrder,...logic,readFoodSalesIntelligence,schema,crypto,setTimeout,TextEncoder,TextDecoder,atob,URL,URLSearchParams,Response,console,outboundFetch,readBoundedProviderJson};
  const service=runPrivateInNewContext(`${source}\n({readFoodOperations,readFoodSnapshot,syncFoodOperations,foodOperation,runFoodCommand,foodAirtable,foodSchema,writeFoodRecord})`,context);
  return {sql,db,service:{...service,...websiteFoodStore,...legacyFoodPlans,...intakeHelpers,...sourceHelpers,...launchHelpers},env:{DB:db,AIRTABLE_API_KEY:'test'},records,calls:()=>calls,fail:()=>{fail=true;},recover:()=>{fail=false;},loseWrite:()=>{loseWriteResponse=true;}};
}
