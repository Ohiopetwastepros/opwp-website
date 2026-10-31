import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {MfaError,mfaCookie,MFA_SESSION_COOKIE,MFA_CHALLENGE_COOKIE,CHALLENGE_SECONDS,readMfaCookie} from '../lib/admin-mfa.mjs';
const source=fs.readFileSync(new URL('../app/api/admin/session/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function handler({limited=false}={}){
 const calls=[];const api=runPrivateInNewContext(source+'\n({POST,DELETE,GET})',{NextResponse:{json(body,options){const r=Response.json(body,options);r.cookies={set(value){r.headers.append('set-cookie',value.name+'='+value.value+'; Secure; HttpOnly; Path=/; Max-Age='+value.maxAge);}};return r;}},Response,URL,Uint8Array,TextDecoder,console,MfaError,mfaCookie,MFA_SESSION_COOKIE,MFA_CHALLENGE_COOKIE,CHALLENGE_SECONDS,readMfaCookie,getRuntimeEnv:()=>({}),verifyAdminRequest:async()=>({authorized:false}),checkRateLimit:async()=>({allowed:!limited}),rateLimitResponse:()=>new Response(null,{status:429}),beginMfaLogin:async()=>{calls.push('password');return {step:'enroll',challengeToken:'a'.repeat(64),secret:'test-secret',uri:'otpauth://test'};},finishMfaLogin:async()=>{calls.push('verify');return {sessionToken:'b'.repeat(64),duration:2592000,recoveryCodes:[]};},revokeMfaSession:async()=>calls.push('logout')});return {api,calls};
}
const request=(body={},extra={})=>new Request('https://ohiopetwastepros.com/api/admin/session/',{method:'POST',headers:{origin:'https://ohiopetwastepros.com','content-type':'application/json'},body:JSON.stringify(body),...extra});
test('password step grants only a short-lived challenge, never backend access',async()=>{
 const {api}=handler();const response=await api.POST(request());assert.equal(response.status,202);assert.match(response.headers.get('set-cookie'),new RegExp(MFA_CHALLENGE_COOKIE));assert.ok(!response.headers.get('set-cookie').includes(MFA_SESSION_COOKIE));assert.equal(response.headers.get('cache-control'),'no-store');
});
test('MFA endpoint rejects cross-origin, missing-origin, abuse and oversized chunked bodies before login work',async()=>{
 for(const origin of ['https://evil.test',null]){const {api,calls}=handler();const response=await api.POST(request({}, {headers:origin?{origin}:{}}));assert.equal(response.status,403);assert.equal(calls.length,0);}
 const rate=handler({limited:true});assert.equal((await rate.api.POST(request())).status,429);assert.equal(rate.calls.length,0);
 const bounded=handler();const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(8193));c.close();}});assert.equal((await bounded.api.POST(request({}, {body,duplex:'half'}))).status,413);assert.equal(bounded.calls.length,0);
});
test('verified login sets secure session cookie and expires setup cookie; sign-out requires same origin',async()=>{
 const {api,calls}=handler();const response=await api.POST(request({action:'verify',code:'123456'}));assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie').includes(MFA_SESSION_COOKIE));assert.ok(response.headers.get('set-cookie').includes('Max-Age=2592000'));
 const wrong=await api.DELETE(new Request('https://ohiopetwastepros.com/api/admin/session/',{method:'DELETE'}));assert.equal(wrong.status,403);assert.ok(!calls.includes('logout'));
 const logout=await api.DELETE(new Request('https://ohiopetwastepros.com/api/admin/session/',{method:'DELETE',headers:{origin:'https://ohiopetwastepros.com'}}));assert.equal(logout.status,200);assert.ok(calls.includes('logout'));
});
