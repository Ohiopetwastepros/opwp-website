// Read-only by default; --apply installs the verified snapshot into private D1.
// --webhook registers signed notifications after the production endpoint exists.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import schema from '../data/dog-food-airtable-schema.json' with {type:'json'};
import {operationModel} from '../lib/dog-food-operations.mjs';
const source=fs.existsSync('.dev.vars')?fs.readFileSync('.dev.vars','utf8'):'';
const key=process.env.DOG_FOOD_AIRTABLE_TOKEN||process.env.AIRTABLE_TOKEN||source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1];
if(!key)throw new Error('Airtable credentials unavailable');
const args=process.argv.slice(2),apply=args.includes('--apply'),webhook=args.includes('--webhook');
const privateDir=path.resolve('tmp/dog-food-ops');fs.mkdirSync(privateDir,{recursive:true});
async function api(uri,options={}) {
  const r=await fetch(`https://api.airtable.com/v0/${uri}`,{...options,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
  const data=await r.json();if(!r.ok)throw new Error(`Airtable ${r.status}: ${data.error?.type||'request failed'}`);return data;
}
const tables={};for(const [name,t] of Object.entries(schema.tables)){let offset;const rows=[];do{const p=new URLSearchParams({returnFieldsByFieldId:'true',pageSize:'100'});if(offset)p.set('offset',offset);const d=await api(`${schema.baseId}/${t.id}?${p}`);rows.push(...d.records.map(r=>({id:r.id,createdTime:r.createdTime,fields:Object.fromEntries(Object.entries(t.fields).map(([n,f])=>[n,r.fields[f]]).filter(([,v])=>v!==undefined))})));offset=d.offset;if(rows.length>5000)throw new Error('Record bound exceeded');}while(offset);tables[name]=rows;}
const snapshot={baseId:schema.baseId,capturedAt:new Date().toISOString(),tables},model=operationModel(snapshot),report={checkedAt:snapshot.capturedAt,counts:Object.fromEntries(Object.entries(tables).map(([n,r])=>[n,r.length])),metrics:model.metrics,unpaid:model.unpaid.map(s=>({name:s.name,balanceCents:s.balanceCents,notes:s.notes,responsible:s.responsible})),issues:model.issues};
fs.writeFileSync(path.join(privateDir,'snapshot.json'),JSON.stringify(snapshot));fs.writeFileSync(path.join(privateDir,'review.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({checkedAt:report.checkedAt,counts:report.counts,metrics:report.metrics,issues:report.issues.length}));
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
function sql(command,name){const file=path.join(privateDir,name+'.sql');fs.writeFileSync(file,command);const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','opwp-backend','--remote','--file',file,'--yes'],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error('Private D1 write failed; inspect local output.');return r;}
if(args.includes('--migrate')){const name='0049_dog_food_operations.sql';sql(fs.readFileSync(path.join('migrations',name),'utf8')+`\nINSERT INTO d1_migrations(name) VALUES (${quote(name)});`,'migration');console.log('Dog-food operations migration applied.');}
if(apply){const id=crypto.randomUUID();sql(`INSERT INTO dog_food_ops_snapshots(id,payload) VALUES (${quote(id)},${quote(JSON.stringify(snapshot))});\nUPDATE dog_food_ops_state SET snapshot_id=${quote(id)},dirty=1,last_success_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id='org-opwp';`,'bootstrap');console.log('Verified Airtable snapshot saved to website D1.');}
if(webhook){const existing=await api(`bases/${schema.baseId}/webhooks`),url='https://www.ohiopetwastepros.com/api/webhooks/dog-food-airtable/';
  if(existing.webhooks?.some(w=>w.notificationUrl===url))throw new Error('A dog-food webhook already exists. Retain its private MAC; do not duplicate it.');
  const h=await api(`bases/${schema.baseId}/webhooks`,{method:'POST',body:JSON.stringify({notificationUrl:url,specification:{options:{filters:{dataTypes:['tableData']}}}})});
  if(!h.id||!h.macSecretBase64)throw new Error('Webhook authentication missing');
  fs.writeFileSync(path.join(privateDir,'webhook-private.json'),JSON.stringify(h));
  const secretFile=path.join(privateDir,'webhook-secret-private.json');fs.writeFileSync(secretFile,JSON.stringify({DOG_FOOD_AIRTABLE_WEBHOOK_MAC:h.macSecretBase64}));
  const secretWrite=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk',secretFile],{encoding:'utf8',windowsHide:true});
  if(secretWrite.status!==0)throw new Error('Cloudflare webhook secret write failed; private registration retained for recovery.');
  sql(`UPDATE dog_food_ops_state SET webhook_id=${quote(h.id)},webhook_mac=NULL,webhook_expires_at=${quote(h.expirationTime)},webhook_refreshed_at=CURRENT_TIMESTAMP WHERE id='org-opwp';`,'webhook-private');
  console.log(JSON.stringify({webhookId:h.id,expirationTime:h.expirationTime,signatureStored:'Cloudflare secret'}));
}
