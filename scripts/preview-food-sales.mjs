// Loopback-only, disposable SQLite. Real components, services and route handlers;
// fabricated identities and inventory. No provider transport or production data.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {build} from 'esbuild';
import {setup} from '../tests/helpers/unified-food-sales-fixture.mjs';
import * as auth from '../lib/food-sales-auth.mjs';
import * as ledger from '../lib/food-sales-ledger.mjs';
import * as logic from '../lib/dog-food-operations.mjs';
const root=process.cwd(),port=4330,origin=`http://127.0.0.1:${port}`,f=setup();
const source=path=>fs.readFileSync(path,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
await f.db.prepare('UPDATE dog_food_sales_credentials SET password_hash=? WHERE member_id=?').bind(await auth.hashFoodSalesPassword('Demo-only!26'),'seller').run();
const limiter=async()=>({allowed:true}); // Rate-limit persistence is covered by API tests / HTTP smoke.
const api=vm.runInNewContext(source('lib/food-sales-api.js')+'\n({foodSalesContext,salesError,salesHeaders})',{getRuntimeEnv:()=>({DB:f.db,FOOD_SALES_NATIVE_ENABLED:'true',FOOD_SALES_RECORDING_ENABLED:'true'}),verifyFoodSalesRequest:auth.verifyFoodSalesRequest,checkRateLimit:limiter,rateLimitResponse:()=>Response.json({error:'limited'},{status:429}),FoodError:logic.FoodError,Response,URL});
const common={...api,...auth,...ledger,...logic,foodSalesService:f.sales,readBoundedBytes:async r=>new Uint8Array(await r.arrayBuffer()),Response,URL,TextEncoder,TextDecoder,JSON,crypto};
const routes=vm.runInNewContext(source('app/api/food-sales/route.js')+'\n({GET,POST})',common);
const NextResponse={json:(body,options)=>{const r=Response.json(body,options);r.cookies={set:c=>r.headers.set('Set-Cookie',`${c.name}=${c.value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${c.maxAge}`)};return r;}};
const session=vm.runInNewContext(source('app/api/food-sales/session/route.js')+'\n({POST,DELETE})',{...common,NextResponse,checkRateLimit:limiter});
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import App from './app/food-sales/FoodSalesClient.js';createRoot(document.getElementById('app')).render(<App/>);`,loader:'jsx',resolveDir:root},bundle:true,write:false,outdir:path.join(root,'tmp/food-sales-preview'),format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script'),css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SYNTHETIC ONLY · Food sales QA</title><style>*{box-sizing:border-box}body{margin:0}${css}</style></head><body><div style="background:#fff3d4;color:#604617;font:11px Arial;padding:7px;text-align:center">LOCAL SYNTHETIC TEST · No live charges, stock or customers</div><div id="app"></div><script>${js}</script></body></html>`;
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');
    if(['/api/food-sales/','/api/food-sales/session/'].includes(url.pathname)) {
      const buffers=[];let length=0;for await(const b of req){length+=b.length;if(length>16384){res.writeHead(413);res.end();return;}buffers.push(b);}
      const r=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(buffers)}:{})});
      const handlers=url.pathname.includes('/session/')?session:routes;
      if(!handlers[req.method]){res.writeHead(405);res.end();return;}
      const response=await handlers[req.method](r);
      // Local-only fault injection: lose a response AFTER the real handler commits.
      if(req.headers['x-opwp-qa-drop-response']==='1'&&response.ok){req.socket.destroy();return;}
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(/^\/assets\/edf\/\d{2}-\d{2}\.webp$/.test(url.pathname)){res.setHeader('Content-Type','image/webp');res.end(fs.readFileSync(path.join(root,'public',url.pathname)));return;}
    if(url.pathname==='/'||url.pathname==='/food-sales/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
    res.writeHead(404);res.end();
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Synthetic preview failed: '+error.message}));}
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic integrated preview: ${origin}/food-sales/ (seller@example.test / Demo-only!26). Disposable SQLite; no external providers.`));
