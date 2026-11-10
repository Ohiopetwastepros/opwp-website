import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const route=(path,context)=>vm.runInNewContext(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\n({'+(path.includes('backup')?'POST':'GET')+'})',{Response,URL,...context});
test('private product archives require owner authorization before any storage access',async()=>{
  let touched=0;const api=route('app/api/admin/dog-food/assets/[id]/route.js',{verifyAdminRequest:async()=>({authorized:false}),getRuntimeEnv:()=>{touched++;throw Error('must not access');}});
  const r=await api.GET(new Request('https://example.test/api/admin/dog-food/assets/attTest/'),{params:Promise.resolve({id:'attTest'})});assert.equal(r.status,401);assert.equal(touched,0);
});
test('owner archive route only reads registered private image objects',async()=>{
  let touched=0;const api=route('app/api/admin/dog-food/assets/[id]/route.js',{verifyAdminRequest:async()=>({authorized:true}),getRuntimeEnv:()=>({DB:{prepare:()=>({bind:()=>({first:async()=>({storage_key:'other-business/secret',content_type:'image/png',byte_size:3})})})},FIELD_PROOFS:{get:()=>{touched++;}}})});
  const r=await api.GET(new Request('https://example.test/api/admin/dog-food/assets/attTest/'),{params:Promise.resolve({id:'attTest'})});assert.equal(r.status,404);assert.equal(touched,0);
});
test('manual backups reject unauthenticated and cross-site requests before exporting',async()=>{
  let called=0;const context={getRuntimeEnv:()=>({}),checkRateLimit:async()=>({allowed:true}),backupWebsiteFoodData:async()=>{called++;return {};}};
  let api=route('app/api/admin/dog-food/backup/route.js',{...context,verifyAdminRequest:async()=>({authorized:false})});assert.equal((await api.POST(new Request('https://example.test/api/admin/dog-food/backup/',{method:'POST'}))).status,401);
  api=route('app/api/admin/dog-food/backup/route.js',{...context,verifyAdminRequest:async()=>({authorized:true,email:'owner@example.test'})});assert.equal((await api.POST(new Request('https://example.test/api/admin/dog-food/backup/',{method:'POST',headers:{origin:'https://outside.test'}}))).status,403);assert.equal(called,0);
});
