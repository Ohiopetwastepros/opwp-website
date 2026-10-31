import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../middleware.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function fixture(authorized=false){
 const authCalls=[];
 const middleware=runPrivateInNewContext(source+'\nmiddleware',{Headers,URL,Uint8Array,crypto,btoa,NextResponse:{next(options){const r=new Response(null);r.forwarded=options?.request?.headers;return r;},json:Response.json,redirect(url,options){return new Response(null,{status:307,headers:{...options?.headers,location:String(url)}});}},getDb:()=>({}),verifyAdminRequest:async()=>{authCalls.push('admin');return {authorized};},verifyFieldRequest:async()=>({authorized:false}),verifyOfficeRequest:async()=>({authorized:false})});
 return {middleware,authCalls};
}
function request(path,method='GET',headers={}){const url='https://ohiopetwastepros.com'+path;return {url,nextUrl:new URL(url),method,headers:new Headers(headers)};}
test('all admin mutations reject absent or hostile origins even with valid MFA',async()=>{
 const {middleware,authCalls}=fixture(true);
 for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/api/admin/session/','/api/admin/office-access/','/admin/quickbooks/disconnect/confirm/'])for(const headers of [{},{origin:'null'},{origin:'https://evil.test'},{origin:'https://ohiopetwastepros.com','sec-fetch-site':'cross-site'}])assert.equal((await middleware(request(path,method,headers))).status,403);
 assert.equal(authCalls.length,0);
});
test('only exact login endpoints are public and alternate sessions or framework headers cannot bypass authorization',async()=>{
 const {middleware}=fixture();
 for(const path of ['/admin/','/admin/security/','/api/admin/quickbooks-cleanup/','/admin/login/extra','/api/admin/session/extra']){
  const r=await middleware(request(path,'GET',{'x-middleware-subrequest':'middleware:middleware:middleware:middleware:middleware',cookie:'opwp_office_session=other'}));
  assert.equal(r.status,path.startsWith('/api/')?401:307);
 }
});
test('admin CSP uses a fresh server nonce, forbids scripts without it, and prevents framing and caching',async()=>{
 const {middleware}=fixture(true);const first=await middleware(request('/admin/security/','GET',{'x-nonce':'attacker','content-security-policy':"script-src * 'unsafe-inline'"}));
 const second=await middleware(request('/admin/security/'));
 const policy=first.headers.get('content-security-policy');const scripts=policy.split(';').map(v=>v.trim()).find(v=>v.startsWith('script-src '));
 assert.match(scripts,/'nonce-[A-Za-z0-9+/]{32}' 'strict-dynamic'/);assert.ok(!scripts.includes('unsafe-inline'));assert.ok(!scripts.includes('unsafe-eval'));
 assert.match(policy,/frame-ancestors 'none'/);assert.match(policy,/base-uri 'none'/);assert.equal(first.headers.get('x-frame-options'),'DENY');assert.match(first.headers.get('cache-control'),/no-store/);assert.equal(first.headers.get('referrer-policy'),'no-referrer');
 assert.equal(first.forwarded.get('content-security-policy'),policy);assert.notEqual(first.forwarded.get('x-nonce'),'attacker');assert.notEqual(policy,second.headers.get('content-security-policy'));
});
test('only the call guide permits the Google Maps origins and sends an origin referrer',async()=>{
 const {middleware}=fixture(true);
 const callGuide=await middleware(request('/admin/call-guide/'));
 const callGuidePolicy=callGuide.headers.get('content-security-policy');
 assert.equal(callGuide.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 assert.match(callGuidePolicy,/img-src[^;]*https:\/\/\*\.googleapis\.com/);
 assert.match(callGuidePolicy,/connect-src[^;]*https:\/\/\*\.googleapis\.com/);

 const otherAdmin=await middleware(request('/admin/security/'));
 const otherPolicy=otherAdmin.headers.get('content-security-policy');
 assert.equal(otherAdmin.headers.get('referrer-policy'),'no-referrer');
 assert.ok(!otherPolicy.includes('googleapis.com'));
});

test('only acquisition permits OSM map images; scripts, connections and other pages remain restricted',async()=>{
 const {middleware}=fixture(true);
 const acquisition=await middleware(request('/admin/acquisition/'));
 const policy=acquisition.headers.get('content-security-policy');
 assert.match(policy,/img-src[^;]*https:\/\/tile\.openstreetmap\.org/);
 assert.ok(!policy.split(';').find(s=>s.trim().startsWith('connect-src')).includes('openstreetmap'));
 assert.ok(!policy.split(';').find(s=>s.trim().startsWith('script-src ')).includes('openstreetmap'));
 assert.equal(acquisition.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 assert.ok(!(await middleware(request('/admin/security/'))).headers.get('content-security-policy').includes('openstreetmap'));
});
test('valid same-origin MFA requests pass and office/field sessions cannot become admin sessions',async()=>{
 const good=fixture(true);assert.equal((await good.middleware(request('/api/admin/office-access/','POST',{origin:'https://ohiopetwastepros.com'}))).status,200);
 const bad=fixture(false);for(const path of ['/api/office/route-assignment/','/api/field/today/'])assert.equal((await bad.middleware(request(path))).status,401);
 for(const path of ['/admin/login/','/api/admin/session/'])assert.equal((await bad.middleware(request(path))).status,200);
});
