import staffPrivate from '../lib/staff-private.json' with {type:'json'};
// Contact examples in this preview use fabricated data.
// Loopback-only visual/workflow fixture. All data is fictional and volatile; no provider credentials are loaded.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {leadTestDatabase} from '../tests/helpers/lead-inbox-fixture.mjs';
const root=process.cwd(),output=path.join(root,'tmp/lead-inbox-preview');fs.mkdirSync(output,{recursive:true});
const db=leadTestDatabase();globalThis.__leadInboxPreviewEnv={DB:db,APP_ENV:'test'};
await build({stdin:{contents:"export * from './lib/lead-inbox-store.js';export * from './lib/lead-handoff.js';export * from './lib/lead-report.js';export * from './lib/growth-desk.js';",resolveDir:root},bundle:true,platform:'node',format:'esm',alias:{'@':root},outfile:path.join(output,'services.mjs'),plugins:[{name:'isolated-env',setup(b){b.onResolve({filter:/(^|\/)(db|cloudflare)$/},a=>({path:a.path.endsWith('/db')||a.path==='./db'?'db':'env',namespace:'isolated'}));b.onLoad({filter:/.*/,namespace:'isolated'},a=>({contents:a.path==='db'?'export const getDb=()=>globalThis.__leadInboxPreviewEnv.DB;':'export const getRuntimeEnv=()=>globalThis.__leadInboxPreviewEnv;',loader:'js'}));}}]});
const api=await import(pathToFileURL(path.join(output,'services.mjs')));
const intake={firstName:"Example",lastName:"Customer",phone:"4195550100",email:"preview.customer@example.test",address:"123 Example Street",city:'Toledo',state:'OH',zip:'43615',dogs:'2',frequency:'once_a_week',lastCleaned:'one_month',yardSize:'tiny',serviceDay:'Monday',areas:['Back yard'],addons:[]};
const ids=[];
for(const [name,phone]of [['Jamie',"4195550100"],['Morgan',"4195550101"],['Riley',"4195550102"],['Alex',"4195550103"]]){const id=crypto.randomUUID();await api.createInboxLead(db,{intake:{...intake,firstName:name,phone,email:name.toLowerCase()+'@example.test'},commandId:id},'preview-owner');ids.push(id);}
async function change(id,body){const row=await api.readInboxRow(db,id);return api.saveInboxChange(db,id,{...body,version:await api.inboxVersion(row)},'preview-owner');}
await change(ids[1],{action:'remind',nextAction:'Call about weekly cleanup',dueAt:new Date(Date.now()+86400000).toISOString()});
await change(ids[3],{action:'close',reason:'price'});
const handoffRow=await api.readInboxRow(db,ids[2]),handoffState=JSON.parse(handoffRow.workspace_payload);
await api.saveInboxChange(db,ids[2],{action:'approve_day',version:await api.inboxVersion(handoffRow)},'preview-owner',{routeAudit:{actor:'preview-owner',handoffKey:handoffState.handoffKey,day:'Monday',at:new Date().toISOString()}});
await change(ids[2],{action:'handoff'});
const handoff=await api.createLeadHandoff(db,ids[2],'preview-owner');
db.sqlite.prepare("UPDATE lead_conversations SET unread_count=1,last_inbound_at=CURRENT_TIMESTAMP WHERE submission_id=?").run(ids[0]);
const conversation=db.sqlite.prepare('SELECT id FROM lead_conversations WHERE submission_id=?').get(ids[0]);
db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES (?,?,'org-opwp','inbound','quo_sms','Can we start next week? What day would you come?','fixture')").run(crypto.randomUUID(),conversation.id);
const initial=await api.listGrowthDesk(100);
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Quote from './app/free-quote/QuoteForm.js';createRoot(document.getElementById('root')).render(<Quote/>);`,resolveDir:root,loader:'jsx'},bundle:true,platform:'browser',format:'esm',jsx:'automatic',loader:{'.js':'jsx'},alias:{'@':root},define:{'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY':'""'},outfile:path.join(output,'quote.js')});
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import AdminWorkspace from './app/admin/AdminWorkspace.js';import Leads from './app/admin/quote-funnel/LeadInboxClient.js';const desk=window.__fixture;createRoot(document.getElementById('root')).render(<AdminWorkspace section="pipeline" email="preview-owner"><Leads initialLeads={desk.leads} initialAnswers={desk.answers} assistantSettings={desk.settings} initialHealth={desk.health}/></AdminWorkspace>);`,resolveDir:root,loader:'jsx'},bundle:true,platform:'browser',format:'esm',jsx:'automatic',loader:{'.js':'jsx'},alias:{'@':root},outfile:path.join(output,'app.js')});
const page=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Leads · isolated workflow preview</title><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#f2f5f3;font-family:Arial,sans-serif}#fixture-label{background:#e9efe3;color:#2f4b35;text-align:center;font:12px Arial;padding:7px}.opwp-admin-shell{font-family:Arial,sans-serif}</style></head><body><div id="fixture-label">ISOLATED PREVIEW · fictional leads · no provider credentials or messages</div><div id="root"></div><script>window.__fixture=${JSON.stringify(initial).replaceAll('<','\\u003c')}</script><script type="module" src="/app.js"></script></body></html>`;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:5198');res.setHeader('Cache-Control','no-store');
  if(['/app.js','/app.css','/quote.js'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(output,url.pathname.slice(1))));return;}
  if(url.pathname==='/assets/opwp-logo.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(root,'public/assets/opwp-logo.png')));return;}
  if(!url.pathname.startsWith('/api/')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(url.pathname==='/free-quote/'?page.replace('src="/app.js"','src="/quote.js"'):page);return;}
  let body='';for await(const part of req){body+=part;if(body.length>15000)throw new Error('Body too large');}const data=body?JSON.parse(body):{};res.setHeader('Content-Type','application/json');
  if(url.pathname==='/api/lead-prefill/'){res.end(JSON.stringify({ok:true,prefill:await api.readLeadHandoff(db,data.token)}));return;}
  if(url.pathname==='/api/admin/leads/'&&req.method==='GET'){const desk=await api.listGrowthDesk(100,{offset:Number(url.searchParams.get('cursor')||0),query:url.searchParams.get('q')||''});res.end(JSON.stringify({ok:true,...desk,nextCursor:null}));return;}
  if(url.pathname==='/api/admin/leads/report/'){res.end(JSON.stringify({ok:true,report:await api.readLeadReport(db,Number(url.searchParams.get('days')||90))}));return;}
  if(url.pathname==='/api/admin/leads/'&&req.method==='POST'){const result=await api.createInboxLead(db,data,'preview-owner');res.end(JSON.stringify({ok:true,lead:(await api.listGrowthDesk(1,{id:result.id})).leads[0]}));return;}
  if(url.pathname==='/api/admin/route-assignment/'){res.end(JSON.stringify({ok:true,recommendation:{eligible:true,requiresOwnerConfirmation:true,recommendedDay:'Monday',recommendedTechnician:staffPrivate.reliefShort,region:'Fictional test territory',confidence:'Preview only',rankedDays:[]}}));return;}
  if(/^\/api\/admin\/leads\/[a-f0-9-]{36}\/quo-thread\/$/.test(url.pathname)){const older=Boolean(data.pageToken);res.end(JSON.stringify({ok:true,messages:[{id:older?'quo:ACdemoEarlier':'quo:ACdemoLatest',provider_message_id:older?'ACdemoEarlier':'ACdemoLatest',direction:older?'inbound':'outbound',body:older?'That works for us. Thank you!':'We can review Monday availability with you.',created_at:older?'2026-10-26T14:00:00Z':'2026-10-27T14:00:00Z',delivery_status:older?'received':'delivered',media:older?[{url:'https://example.test/fixture-yard.png',type:'image/png'}]:[]}],nextPageToken:older?null:'fictional-older-page',loadedAt:new Date().toISOString()}));return;}
  const match=url.pathname.match(/^\/api\/admin\/leads\/([a-f0-9-]{36})\/(quote\/)?$/);
  if(match){const id=match[1];if(match[2]){const row=await api.readInboxRow(db,id);res.end(JSON.stringify({ok:true,draft:api.quoteMessage(row,JSON.parse(row.workspace_payload))}));return;}if(req.method==='PATCH'){const result=await api.saveInboxChange(db,id,data,'preview-owner');res.end(JSON.stringify({ok:true,...result,lead:(await api.listGrowthDesk(1,{id})).leads[0]}));return;}res.end(JSON.stringify({ok:true,lead:(await api.listGrowthDesk(1,{id})).leads[0]}));return;}
  res.statusCode=403;res.end(JSON.stringify({error:'Provider and other application actions are disabled in this isolated preview.'}));
}catch(e){res.statusCode=e.status||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}});
server.listen(5198,'127.0.0.1',()=>{console.log('Isolated lead inbox preview: http://127.0.0.1:5198/admin/quote-funnel/');console.log('Fictional signup prefill: '+handoff.url.replace('https://www.ohiopetwastepros.com','http://127.0.0.1:5198'));});
