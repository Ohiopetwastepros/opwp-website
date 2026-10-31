// Loopback-only review of production components. No providers or write proxy.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {operationModel} from '../lib/dog-food-operations.mjs';
import {foodInventoryDashboard} from '../lib/dog-food-inventory.mjs';
import {emptyFoodPlanning} from '../lib/dog-food-sales-intelligence.mjs';
import {fixture} from '../tests/helpers/dog-food-fixture.mjs';
const root=process.cwd(),port=Number(process.env.FOOD_INVENTORY_PORT||4342);
const snapshot=JSON.parse(fs.readFileSync('tmp/dog-food-ops/snapshot.json','utf8'));
for(const [i,row] of snapshot.tables.Sales.entries()){if(row.fields['Sold To'])row.fields['Sold To']=`Customer ${i+1}`;row.fields.Notes='';delete row.fields['Responsible Email'];delete row.fields['Responsible Phone'];}
snapshot.tables.Customers=[];
const f=fixture(snapshot),costs=f.sql.prepare('SELECT * FROM dog_food_cost_annotations').all();
const current=operationModel(snapshot),policy=emptyFoodPlanning();
const privateState=JSON.parse(fs.readFileSync('tmp/dog-food-ops/live-state-private.json','utf16le').replace(/^\uFEFF/,''))[0].results[0];
const sync={last_success_at:privateState.last_success_at,last_error:privateState.last_error,capturedAt:snapshot.capturedAt,dirty:privateState.dirty};
current.intelligence={policy,inventory:foodInventoryDashboard(current,{policy,costs,sync})};
const demo=structuredClone(current),demoPolicy={...policy,supplierLeadDays:7,safetyDays:7,reviewDays:21,minimumOrderBags:5,orderMultipleBags:2,mixedPalletMinimumBags:40,mixedPalletMultipleBags:10,mixedPalletMaxBags:100,freightCents:0,historyConfirmedFrom:'2026-01-01',historyConfirmedThrough:'2026-10-13'};
demo.sales=[];demo.issues=[];demo.subscriptions=[];
for(const [i,p] of demo.products.filter(p=>p.active).entries())for(let n=0;n<12;n++)demo.sales.push({id:`example-${i}-${n}`,name:'Fictional customer',productId:p.id,quantity:(i+1)*2+n%3,date:`2026-${String(n+1).padStart(2,'0')}-03`,stockDate:`2026-${String(n+1).padStart(2,'0')}-03`,inventoryEligible:true,cancelled:false,totalCents:12000,fulfillmentAssumed:false});
const exampleLots=demo.products.filter(p=>p.active).flatMap(p=>[{id:'example-early-'+p.id,product_id:p.websiteId,lot_number:'FICTIONAL-EARLY',best_before:'2026-10-20',usable_bags:Math.floor(p.onHand/2),unit_cost_cents:p.costCents,source_reference:'FICTIONAL invoice'},{id:'example-late-'+p.id,product_id:p.websiteId,lot_number:'FICTIONAL-LATER',best_before:'2027-03-08',usable_bags:p.onHand-Math.floor(p.onHand/2),unit_cost_cents:p.costCents,source_reference:'FICTIONAL invoice'}]);
demo.intelligence={policy:demoPolicy,inventory:foodInventoryDashboard(demo,{policy:demoPolicy,lots:exampleLots,costs:[],sync,now:new Date('2026-10-13T16:00:00Z')})};
const pages=new Map();
for(const [mode,data] of [['current',current],['example',demo],['profit',current]]) {
  const banner=mode!=='example'?'CURRENT SOURCE REVIEW · customer names anonymized · no production writes':'FICTIONAL PLANNING EXAMPLE · supplier terms and demand invented for demonstration only';
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import App from './app/admin/dog-food/${mode==='profit'?'SalesProfitLoss':'InventoryDashboard'}.js';createRoot(document.getElementById('app')).render(<App data={${JSON.stringify(data)}} onAction={()=>alert('Read-only local preview. No changes were saved.')} onNavigate={()=>alert('Purchasing remains in the protected production workspace. No purchase submitted.')} busy={false}/>);`,loader:'jsx',resolveDir:root},bundle:true,write:false,outdir:'tmp/food-inventory-build',format:'iife',minify:true,jsx:'automatic',loader:{'.js':'jsx','.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script'),css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  pages.set(mode,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dog-food inventory · local review</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f4;font-family:Arial,sans-serif;color:#18384b}#app{max-width:1450px;margin:auto;padding:24px}nav{background:#153c30;color:white;padding:16px 24px;font-size:13px;line-height:1.7}nav a{color:white;margin-left:20px}button,input,select,textarea{font:inherit}button{cursor:pointer}${css}</style></head><body><nav>${banner}<a href="/">Current records</a><a href="/admin/dog-food/profit-loss/">Sales &amp; profit/loss</a><a href="/?scenario=example">Fictional planning example</a></nav><div id="app"></div><script>${js}</script></body></html>`);
}
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(!['/','/admin/dog-food/profit-loss/','/admin/dog-food/inventory/'].includes(url.pathname)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/html;charset=utf-8');res.end(pages.get(url.pathname==='/admin/dog-food/profit-loss/'?'profit':url.searchParams.get('scenario')==='example'?'example':'current'));
});
server.listen(port,'127.0.0.1',()=>console.log(`Read-only inventory preview: http://127.0.0.1:${port}/`));
