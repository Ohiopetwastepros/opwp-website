// Phase-one prototype: loopback only, public assets + fictional browser state.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {previewCatalog} from '../design/my-dog-food/catalog.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicCatalog=JSON.parse(fs.readFileSync(path.join(root,'design/my-dog-food/public-catalog.json'),'utf8'));
const catalog=previewCatalog(fs.readFileSync(path.join(root,'lib/dog-food-catalog.mjs'),'utf8'),fs.readFileSync(path.join(root,'tmp/test-migrations/0024_dog_food_price_59.sql'),'utf8'),publicCatalog.products);
const port=Number(process.env.FOOD_DESIGN_PORT || 4330);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid preview port');
const output=path.join(root,'output/my-dog-food-design');
fs.mkdirSync(output,{recursive:true});
const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import App from './design/my-dog-food/App.jsx';createRoot(document.getElementById('app')).render(<App catalog={${JSON.stringify(catalog)}}/>);`,loader:'jsx',resolveDir:root},bundle:true,write:false,outdir:output,format:'iife',jsx:'automatic',minify:true,loader:{'.js':'jsx','.css':'css'},define:{'process.env.NODE_ENV':'"production"'}});
let fontCss='';
const cssRoot=path.join(root,'.next/static/css');
if(fs.existsSync(cssRoot))fontCss=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).flatMap(f=>fs.readFileSync(path.join(cssRoot,f),'utf8').match(/@font-face\{[^}]+\}/g)||[]).filter(r=>r.includes('-s.p.woff2')&&/Hanken Grotesk/.test(r)).map(r=>r.replace(/;unicode-range:[^}]+/,'')).join('');
const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=bundled.outputFiles.find(f=>f.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>My Dog Food · Design review</title><style>${fontCss}\n${css}</style></head><body><div id="app"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`;
fs.writeFileSync(path.join(output,'preview.html'),html);
const assetFiles=new Map(catalog.map(p=>[p.image,path.join(root,'public',p.image)]));
for(const name of ['edf/logo.png','opwp-logo.webp'])assetFiles.set(`/assets/${name}`,path.join(root,'public/assets',name));
const media=path.join(root,'.next/static/media');
if(fs.existsSync(media))for(const name of fs.readdirSync(media).filter(f=>f.endsWith('.woff2')))assetFiles.set(`/_next/static/media/${name}`,path.join(media,name));
// Also make a portable offline copy using only the allowlisted public files.
for(const [url,file] of assetFiles){if(!fs.existsSync(file))continue;const target=path.join(output,url.replace(/^\//,''));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
fs.writeFileSync(path.join(output,'index.html'),html.replaceAll('/assets/','./assets/').replaceAll('/_next/','./_next/'));
http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if(req.method!=='GET'){res.writeHead(405);res.end('Design preview only. No writes.');return;}
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  const file=assetFiles.get(url.pathname);
  if(file&&fs.existsSync(file)){res.setHeader('Content-Type',file.endsWith('.woff2')?'font/woff2':file.endsWith('.png')?'image/png':'image/webp');res.end(fs.readFileSync(file));return;}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
  res.writeHead(404);res.end('Preview route unavailable.');
}).listen(port,'127.0.0.1',()=>console.log(`Local design review: http://127.0.0.1:${port}/\nOffline review: ${path.join(output,'index.html')}`));
