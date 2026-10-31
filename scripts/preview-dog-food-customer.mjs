// Contact examples in this preview use fabricated data.
// Loopback-only customer journey QA. Public catalog fixture; no auth bypass,
// provider connections, customer data, payment actions or writes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
const root = process.cwd();
const previewPort=Number(process.env.FOOD_QA_PORT||4322);
const routeChoices={status:'available',deliveryAvailable:true,pickupAvailable:true,message:'Recommended from current OPWP routes in your ZIP. Sample data for local visual QA.',capturedAt:new Date().toISOString(),days:[{day:'Tuesday',weekday:2}],tonyDates:['2026-10-09']};
// Reuse the installed production fonts for accurate visual QA, when a build exists.
const cssRoot=path.join(root,'.next/static/css');
const fontRules=fs.existsSync(cssRoot)?fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).flatMap(f=>fs.readFileSync(path.join(cssRoot,f),'utf8').match(/@font-face\{[^}]+\}/g)||[]).filter(r=>r.includes('-s.p.woff2')&&/Bricolage Grotesque|Hanken Grotesk/.test(r)).map(r=>r.replace(/;unicode-range:[^}]+/,'')):[];
const fontCss=fontRules.join('');
const products = [
  ['22-12','pink','Chicken & Brown Rice'],['26-14','blue','Puppies & Active Dogs'],
  ['26-18','green','Active Dogs'],['30-20','red','Pro Athlete'],
].map(([formula_code,color,name]) => ({id:`edf-${formula_code}-${color}-40`,formula_code,color,name,bag_weight_lb:40,retail_price_cents:5900}));
const sampleItems = [{product_id:products[0].id,formula_code:'22-12',color:'pink',name:'Chicken & Brown Rice',bag_weight_lb:40,quantity:2,unit_price_cents:5900}];
const sampleCustomer = {first_name:"Example",last_name:"Customer",email:"preview.customer@example.test",phone:'4195550100'};
const sampleAddress = {id:'sample-address',line1:"123 Example Street",city:'Toledo',state:'OH',postal_code:'43614',placement_preference:'Front door'};
function sampleAccount(scenario) {
  const base={ok:true,profileRequired:scenario==='new',preferredFulfillment:'delivery',deliveryChoices:routeChoices,authenticated:true,products,emailConfigured:true,paymentConfigured:true,customer:sampleCustomer,addresses:[sampleAddress],orders:[],subscriptions:[]};
  if(scenario==='new')return {...base,customer:{...sampleCustomer,first_name:"Example",last_name:"Customer",phone:''},addresses:[]};
  if(scenario==='empty')return base;
  base.orders=[{id:'sample-order',order_number:'EDF-1042',status:'paid',paid_provider:'stripe',delivery_status:'scheduled',delivery_date:'2026-10-15',placed_at:'2026-10-04',order_type:'on_demand',total_cents:12714,items:sampleItems}];
  base.subscriptions=[{id:'sample-plan',status:'active',payment_provider:'stripe',next_delivery_date:'2026-11-15',next_charge_at:'2026-11-13',delivery_cadence:'fixed_day',billing_anchor_day:15,card_brand:'Visa',card_last_four:'4242',total_cents:12714,items:sampleItems}];
  if(scenario==='paused'){base.orders=[];base.subscriptions[0].status='paused';}
  if(scenario==='unconfirmed'){base.orders[0].delivery_date=null;base.orders[0].delivery_status=null;}
  if(scenario==='unpaid'){base.orders[0].paid_provider=null;base.orders[0].status='pending_payment';}
  if(scenario==='external')base.subscriptions[0].payment_provider='sng';
  return base;
}
async function page(account) {
  const bundled = await build({
    stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import './app/globals.css';import App from './app/dog-food/${account?'account/FoodAccountClient':'page'}.js';createRoot(document.getElementById('app')).render(<App/>);`,loader:'jsx',resolveDir:root},
    bundle:true,write:false,outdir:path.join(root,'tmp/food-customer-preview'),format:'iife',jsx:'automatic',
    loader:{'.js':'jsx','.css':'local-css'},define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY':'""'},
    plugins:[{name:'public-qa-only',setup(b){
      b.onResolve({filter:/^@\/lib\/stripe$/},()=>({path:'qa-stripe',namespace:'qa'}));
      b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const stripeConfigured=()=>true;',loader:'js'}));
      b.onResolve({filter:/^@\//},args=>({path:path.join(root,args.path.slice(2)+(path.extname(args.path)?'':'.js'))}));
    }}],
  });
  const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
  const css=bundled.outputFiles.find(f=>f.path.endsWith('.css')).text;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dog food customer journey | Local QA sample data</title><style>${fontCss}:root{--font-hanken:'Hanken Grotesk',Arial;--font-bricolage:'Bricolage Grotesque',Arial}${css}</style></head><body><div id="app"></div><script>const originalFetch=window.fetch;window.fetch=(url,options)=>originalFetch(url==='/api/dog-food/session/'?url+'?preview='+encodeURIComponent(new URLSearchParams(location.search).get('preview')||'login'):url,options);${js}</script></body></html>`;
}
const [finder,account]=await Promise.all([page(false),page(true)]);
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4322');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='POST'&&url.pathname==='/api/dog-food/account/'){let body='';req.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy();});req.on('end',()=>{if(JSON.parse(body||'{}').action!=='delivery_choices'){res.writeHead(405);res.end('Read-only sample preview.');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,deliveryChoices:routeChoices}));});return;}
  if(req.method!=='GET'){res.writeHead(405);res.end('Visual preview does not create accounts or orders.');return;}
  if(/^\/_next\/static\/media\/[a-f0-9-]+-s\.p\.woff2$/.test(url.pathname)){
    const file=path.join(root,'.next/static/media',path.basename(url.pathname));
    if(fs.existsSync(file)){res.setHeader('Content-Type','font/woff2');res.end(fs.readFileSync(file));return;}
  }
  if(url.pathname==='/api/dog-food/session/'){res.setHeader('Content-Type','application/json');const scenario=url.searchParams.get('preview');res.end(JSON.stringify(['new','empty','member','paused','unconfirmed','unpaid','external'].includes(scenario)?sampleAccount(scenario):{ok:true,authenticated:false,products,emailConfigured:true,paymentConfigured:true}));return;}
  if(url.pathname==='/dog-food/account/'||url.pathname==='/dog-food/'||url.pathname==='/'){
    res.setHeader('Content-Type','text/html;charset=utf-8');res.end(url.pathname==='/dog-food/account/'?account:finder);return;
  }
  if(/^\/assets\/[a-zA-Z0-9\/_-]+\.(png|webp|woff2)$/.test(url.pathname)){
    const file=path.join(root,'public',url.pathname);
    if(fs.existsSync(file)){res.setHeader('Content-Type',file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'font/woff2');res.end(fs.readFileSync(file));return;}
  }
  res.writeHead(404);res.end();
}).listen(previewPort,'127.0.0.1',()=>console.log(`Read-only journey preview: http://127.0.0.1:${previewPort}/dog-food/`));
