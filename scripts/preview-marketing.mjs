// Aggregate-only loopback preview. No credentials, customer PII, API proxy or auth bypass.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../',import.meta.url));
const output = path.join(root,'output/meta-audit'); fs.mkdirSync(output,{recursive:true});
const photo = `data:image/webp;base64,${fs.readFileSync(path.join(root,'public/assets/photos/team-founders-sign-640.webp')).toString('base64')}`;
const bundle = await build({
  stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import MarketingClient from './app/admin/marketing/MarketingClient.js'; import seed from './data/meta-ads-audit-2026-10-06.json'; import {FALL_CREATIVE_BRIEFS} from './data/fall-meta-creative-briefs.mjs'; createRoot(document.getElementById('app')).render(<MarketingClient seed={seed} briefs={FALL_CREATIVE_BRIEFS} initialSnapshot={{revision:'',daily:[],outcomes:[]}} storageAvailable={false} teamPhoto={${JSON.stringify(photo)}}/>);`,resolveDir:root,sourcefile:'marketing-preview.jsx',loader:'jsx'},
  bundle:true,write:false,outdir:path.join(root,'tmp/marketing-preview'),format:'iife',minify:true,jsx:'automatic',loader:{'.js':'jsx','.css':'local-css'},alias:{'@':root},
  define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'local-link',setup(api){api.onResolve({filter:/^next\/link$/},()=>({path:'local-link',namespace:'preview'}));api.onLoad({filter:/.*/,namespace:'preview'},()=>({contents:`import React from 'react';export default function Link(props){return React.createElement('a',props)}`,loader:'js',resolveDir:root}));}}],
});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>OPWP acquisition audit | Local review</title><style>body{margin:0;background:#f5f8fb;font-family:Arial,sans-serif}main{padding:26px 32px}header{max-width:1500px;margin:auto;color:#153854}header h1{font-size:34px;margin:15px 0 8px}header p{line-height:1.6;color:#496176}.local-note{font-size:13px;background:#fff0db;border:1px solid #e4c69c;padding:12px;border-radius:8px}*{box-sizing:border-box}@media(max-width:600px){main{padding:16px}}${css}</style></head><body><main><header><div class="local-note">LOCAL REVIEW COPY • This file contains private aggregate ad data. Production publication is pending concurrent SNG cutover work. Filters, creative briefs and analysis work here; saved imports require the protected OPWP deployment.</div><h1>Ad acquisition</h1><p>Ohio Pet Waste Pros • Historical evidence, paying-customer measurement and fall creative production.</p></header><div id="app"></div></main><script>${js}</script></body></html>`;
fs.writeFileSync(path.join(output,'opwp-acquisition-view.html'),html);
console.log('Standalone review copy saved: output/meta-audit/opwp-acquisition-view.html');
if(process.argv.includes('--serve')) {
  const server=http.createServer((request,response)=>{
    if(request.method!=='GET' || !['/','/opwp-acquisition-view.html'].includes(request.url)){response.writeHead(404);response.end('Not found');return;}
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(html);
  });server.listen(4317,'127.0.0.1',()=>console.log('Aggregate-only preview: http://127.0.0.1:4317'));
}
