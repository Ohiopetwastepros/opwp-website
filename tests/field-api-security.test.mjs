import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readBoundedProviderJson,readBoundedBytes } from '../lib/bounded-body.mjs';
import { FieldError,imageMatches,coordinates } from '../lib/field-policy.mjs';
import { reviewCloseoutIdentity } from '../lib/field-sync-review.mjs';
const source=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function actionFixture({authorized=true,fail=null}={}){
  let calls=0;
  const api=runPrivateInNewContext(source('../app/api/field/action/route.js')+'\n({POST})',{Response,URL,console,RangeError,FieldError,readBoundedProviderJson,getDb:()=>({}),verifyFieldRequest:async()=>({authorized,member:{id:'tech'}}),fieldQuota:async()=>true,checkRateLimit:async()=>({allowed:true}),executeFieldCommand:async()=>{calls++;if(fail)throw fail;return {message:'Saved'};},applyFieldAction:()=>{},getFieldToday:async()=>null});return {api,calls:()=>calls};
}
const request=(data,origin='https://example.com')=>new Request('https://example.com/api/field/action/',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
test('field mutation requires a session and positive same-origin evidence',async()=>{
  const f=actionFixture();for(const origin of ['', 'https://evil.example'])assert.equal((await f.api.POST(request({},origin))).status,403);assert.equal(f.calls(),0);
  assert.equal((await actionFixture({authorized:false}).api.POST(request({}))).status,401);
});
test('field action streams reject oversized bodies before calling the domain service',async()=>{
  const f=actionFixture();assert.equal((await f.api.POST(request({note:'x'.repeat(17000)}))).status,413);assert.equal(f.calls(),0);
});
test('database errors stay private while expected field errors remain actionable',async()=>{
  const internal=actionFixture({fail:new Error('SQLITE private table name')});const result=await internal.api.POST(request({}));assert.equal(result.status,500);assert.ok(!(await result.text()).includes('SQLITE'));
  const expected=await actionFixture({fail:new FieldError('Shift changed',409)}).api.POST(request({}));assert.equal(expected.status,409);
});
test('streaming upload limit rejects falsely declared lengths',async()=>{
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(700));controller.enqueue(new Uint8Array(700));controller.close();}});
  await assert.rejects(readBoundedBytes({headers:new Headers({'content-length':'1'}),body:stream},1000),RangeError);
});
test('photos require tenant-owned active tasks before reading image bytes or writing storage',async()=>{
  let writes=0;
  const db={prepare(){return {bind(){return {first:async()=>null};}};}};
  const api=runPrivateInNewContext(source('../app/api/field/photo/route.js')+'\n({PUT})',{Response,URL,crypto,readBoundedBytes,imageMatches,coordinates,getRuntimeEnv:()=>({FIELD_PROOFS:{put:async()=>writes++}}),getDb:()=>db,verifyFieldRequest:async()=>({authorized:true,member:{id:'tech',organizationId:'org'}}),fieldQuota:async()=>true,checkRateLimit:async()=>({allowed:true})});
  const r=await api.PUT(new Request('https://example.com/api/field/photo/?taskId=someone-else',{method:'PUT',headers:{Origin:'https://example.com','Content-Type':'image/jpeg'},body:Uint8Array.from([255,216,255,224])}));assert.equal(r.status,403);assert.equal(writes,0);
});
test('closeout review rejects duplicated job IDs and never enables sending',()=>{
  const source={id:'1',organization_id:'2',client_location_id:'3',assigned_to_id:'4'};
  const manifest={employeeId:'4',jobs:[{sourceJobId:'1',source,outcome:'completed'}]};
  assert.equal(reviewCloseoutIdentity(manifest,[source]).matched,1);assert.equal(reviewCloseoutIdentity(manifest,[source,source]).conflicts.length,1);assert.equal(reviewCloseoutIdentity(manifest,[source]).writeEnabled,false);
  assert.equal(reviewCloseoutIdentity({...manifest,jobs:[{...manifest.jobs[0],outcome:'exception_requires_mapping'}]},[source]).conflicts.length,1);
});
