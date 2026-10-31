import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {demoFiles,demoFingerprint} from '../scripts/field-demo-project.mjs';
import {verifyDemoRelease} from '../scripts/deploy-field-demo.mjs';
test('standalone demo deployment includes no live app routes, adapters or secrets',()=>{
  const config=JSON.parse(fs.readFileSync(new URL('../wrangler.field-demo.jsonc',import.meta.url),'utf8'));
  const live=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.name,'opwp-field-demo');assert.equal(config.d1_databases.length,1);assert.notEqual(config.d1_databases[0].database_id,live.d1_databases[0].database_id);
  for(const name of ['secrets','r2_buckets','triggers','services','routes'])assert.equal(config[name],undefined);
  assert.deepEqual(config.vars,{FIELD_SANDBOX_ONLY:'true'});
  assert.deepEqual(demoFiles.filter(p=>p.startsWith('app/')),['app/field-demo','app/api/field-demo','app/field-sandbox','app/api/field-sandbox','app/field/app/WorkdayApp.js','app/field/app/workday.module.css','app/admin/route-partner/workdays/WorkdayOffice.js','app/admin/route-partner/workdays/office.module.css']);
  for(const name of ['lib/field-workday-store.mjs','lib/field-workday-office.mjs','lib/field-messages.js','lib/field-auth.js','app/field/app/page.js','app/admin/route-partner/workdays/page.js'])assert.equal(demoFiles.includes(name),false);
  assert.equal(demoFiles.some(p=>/\.env|\.dev\.vars|sweepandgo|admin\/marketing/.test(p)),false);assert.match(demoFingerprint(),/^[a-f\d]{64}$/);
});
function fake(id,{origin=403,admin=404,ownership=401}={}){return async url=>url.includes('/api/demo-release/')?Response.json({id}):url.includes('/api/field-demo/')||url.includes('/api/field-sandbox/session/')?new Response(null,{status:origin}):url.includes('/api/field-sandbox/workday/')?new Response(null,{status:ownership}):url.includes('/admin/')||url.includes('/api/field/workday/')?new Response(null,{status:admin}):new Response('Demo');}
test('demo release is not verified unless build identity and security boundaries match',async()=>{
  assert.equal((await verifyDemoRelease('demo',fake('demo'),{attempts:1})).productionRoutesAbsent,true);
  await assert.rejects(verifyDemoRelease('demo',fake('old'),{attempts:1}),/verification failed/);
  await assert.rejects(verifyDemoRelease('demo',fake('demo',{origin:200}),{attempts:1}),/verification failed/);
  await assert.rejects(verifyDemoRelease('demo',fake('demo',{admin:200}),{attempts:1}),/verification failed/);
  await assert.rejects(verifyDemoRelease('demo',fake('demo',{ownership:200}),{attempts:1}),/verification failed/);
});
