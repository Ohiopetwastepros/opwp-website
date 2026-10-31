// Contact examples in this preview use fabricated data.
// Loopback-only visual QA. Anonymized data, no API proxy, no writes, no secrets.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {operationModel} from '../lib/dog-food-operations.mjs';
import {foodSalesIntelligence} from '../lib/dog-food-sales-intelligence.mjs';
const root=process.cwd(),source=JSON.parse(fs.readFileSync('tmp/dog-food-ops/snapshot.json','utf8'));
for(const [name,rows] of Object.entries(source.tables))for(const [i,r] of rows.entries()){
  if(name==='Sales'){r.fields['Sold To']=r.fields['Sold To']?`Customer ${i+1}`:'';r.fields.Notes=r.fields['Payment Status']==='Unpaid'?'Assigned staff should collect the outstanding payment.':'';r.fields['Responsible Person']='Office';}
  if(name==='Customers'){r.fields['Customer Name']=r.fields['Customer Name']?`Customer profile ${i+1}`:'';r.fields.Email='';r.fields.Phone='';r.fields['Service Address']='';r.fields.Notes='';}
  delete r.fields['Responsible Email'];delete r.fields['Responsible Phone'];
}
const data={...operationModel(source,{orders:[{id:'example',order_number:'EDF-DEMO',order_type:'on_demand',status:'pending_payment',total_cents:6357,first_name:'Example',last_name:'Customer',items:'Green 26-18 ×1'}],customers:[{id:'example',first_name:'Example',last_name:'Customer',email:"preview.customer@example.test",phone:'',customer_type:'on_demand'}]}),sync:{last_success_at:new Date().toISOString(),dirty:0,alerts_enabled:0},audit:[],alerts:[],deleted:[]};
for(const p of data.products)p.reorderPoint=p.color==='Green'?30:20;
data.intelligence=foodSalesIntelligence(data,{accounts:[{id:'example',first_name:'Example',last_name:'Customer',email:"preview.customer@example.test",phone:'4195550100',line1:'123 Example Street',city:'Toledo',state:'OH',postal_code:'43614',placement_preference:'Front door',profile_completed_at:'2026-10-08 10:00:00',preferred_fulfillment:'delivery'}],customerReviews:[{customer_id:'example',revision:1,status:'pending'}],routeSource:{status:'success',stale:false,capturedAt:new Date().toISOString(),clients:[]}});
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import App from './app/admin/dog-food/DogFoodSalesWorkspace.js';createRoot(document.getElementById('app')).render(<App initialData={${JSON.stringify(data)}}/>);`,loader:'jsx',resolveDir:root,sourcefile:'food-preview.jsx'},bundle:true,write:false,outdir:path.join(root,'tmp/dog-food-preview'),format:'iife',minify:true,jsx:'automatic',loader:{'.js':'jsx','.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script'),css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dog food operations | Local visual QA</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7f6;font-family:Arial,sans-serif}button,input,select,textarea{font:inherit}${css}</style></head><body><div id="app"></div><script>${js}</script></body></html>`;
const port=Number(process.env.FOOD_OPS_QA_PORT||4321);
http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return;}if(req.url==='/api/admin/dog-food/operations/'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,data}));return;}if(/^\/assets\/edf\/(?:\d{2}-\d{2}\.webp|logo\.png)$/.test(req.url||'')){const f=path.join(root,'public',req.url);if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':f.endsWith('.png')?'image/png':'image/webp'});res.end(fs.readFileSync(f));return;}}if(req.url==='/'||req.url?.startsWith('/?')){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}res.writeHead(404);res.end();}).listen(port,'127.0.0.1',()=>console.log(`Anonymized read-only preview: http://127.0.0.1:${port}`));
