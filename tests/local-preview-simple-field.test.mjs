import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {previewConfig} from '../scripts/local-preview.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
function workspace(t,{running=false,legacyOrigin=false}={}){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'opwp-simple-refresh-test-'));
  t.after(()=>{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(base).startsWith('opwp-simple-refresh-test-'));fs.rmSync(base,{recursive:true,force:true});});
  const root=path.join(base,'source'),local=path.join(base,'local'),main=path.join(local,'CodexBuildCaches','main'),build=path.join(local,'CodexBuildCaches','opwp-route-os-simple-field-20261121'),state=path.join(root,'.wrangler','route-os-simple-field-review');
  const origin=legacyOrigin?'http://127.0.0.1:8797':'http://localhost:8797';
  const wrapper="globalThis.fetch = async () => { throw Error('LOCAL_PREVIEW_OUTBOUND_BLOCKED'); };\nconst local = env.CRM_PAYMENTS_PROVIDER === 'fake' && env.APP_ENV === 'development' && url.port === '8787';\nconst worker = {async scheduled(){}};\n";
  for(const directory of ['.open-next','public','lib','data']){write(path.join(main,directory,'fixture.txt'),'new '+directory);write(path.join(build,directory,'fixture.txt'),'old '+directory);}
  write(path.join(main,'lib','synthetic.json'),'fake input');
  write(path.join(main,'tmp','private-build-inputs-manifest.json'),JSON.stringify({mode:'synthetic',files:[{path:'lib/synthetic.json',sha256:hash('fake input')}]}));
  write(path.join(main,'.open-next','worker.js'),'new compiled worker');write(path.join(main,'.open-next','local-preview-worker.mjs'),wrapper);
  write(path.join(main,'node_modules','wrangler','bin','wrangler.js'),'must never execute');
  write(path.join(main,'app','free-quote','pricing.js'),'new pricing source');
  write(path.join(build,'.open-next','worker.js'),'old compiled worker');write(path.join(build,'.open-next','local-preview-worker.mjs'),wrapper.replace("url.port === '8787'","url.port === '8797'"));
  write(path.join(state,'v3','d1','existing.sqlite'),'existing fake database bytes');write(path.join(state,'v3','r2','proof.bin'),'existing proof');
  const config=previewConfig();config.name='opwp-route-os-simple-field-review';Object.assign(config.vars,{LOCAL_PREVIEW_ORIGIN:origin,SITE_ORIGIN:origin,WORKER_ORIGIN:origin});Object.assign(config.dev,{ip:'127.0.0.1',port:8797});config.d1_databases=[{...config.d1_databases[0],database_name:'opwp-route-os-simple-field-review',database_id:'00000000-0000-4000-8000-000000000097',migrations_dir:path.join(main,'tmp','local-preview','migrations')}];
  config.r2_buckets=[{...config.r2_buckets[0],bucket_name:'opwp-simple-field-review-proofs'}];
  write(path.join(root,'scripts','local-preview-mark-field-stage.mjs'),"const ORIGIN='http://localhost:8787';\nassert.equal(url.hostname,'localhost');\nconst report='tmp/mark-v2-field-stage.json';\n");
  write(path.join(root,'tmp','simple-ui-field-stage.mjs'),'original stage helper');
  const configFile=path.join(build,'wrangler.simple-field.json'),envFile=path.join(build,'tmp','simple-field','no-secrets.env'),manifestFile=path.join(build,'tmp','simple-field-workspace.json');
  write(configFile,JSON.stringify(config));write(envFile,'# no credentials');write(path.join(build,'tmp','simple-field','seed.sql'),'original seed must stay untouched');
  const manifest={mode:'synthetic',origin,build,persist:state,database:'opwp-route-os-simple-field-review',seeded:true,seededAt:'2026-11-21T12:00:00Z',date:'2026-11-21',counts:{crm_subscription_customers:25,route_partner_locations:12},migrations:[{name:'old-schema',sha256:'unchanged'}],stageHelper:{path:'unchanged-stage'},source:{workerSha256:hash('old compiled worker')},wrapperSha256:hash(fs.readFileSync(path.join(build,'.open-next','local-preview-worker.mjs')))};write(manifestFile,JSON.stringify(manifest));
  const facade={...fs};let processCalls=0;
  let source=fs.readFileSync(new URL('../scripts/local-preview-simple-field.mjs',import.meta.url),'utf8');
  source=source.slice(0,source.indexOf("if(process.argv[1]&&"));
  source=source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace("const ROOT=fileURLToPath(new URL('../',import.meta.url));",'const ROOT=TEST_ROOT;').replace(/^async function listening\(\).*$/m,'async function listening(){return TEST_RUNNING;}');
  source+='\nglobalThis.api={refreshSimpleField,startSimpleField,rebindSimpleFieldOrigin};';
  const context={assert,fs:facade,path,net:{},spawnSync:()=>{processCalls++;throw Error('No process/database command permitted');},createHash,fileURLToPath,pathToFileURL,previewBuild:main,previewConfig,assertPreviewBranch:()=>{},TEST_ROOT:root,TEST_RUNNING:running,process:{env:{LOCALAPPDATA:local},argv:[],execPath:process.execPath},URL,console};
  vm.runInNewContext(source,context,{filename:'local-preview-simple-field.test.mjs'});
  return {base,root,main,build,state,manifestFile,configFile,envFile,manifest,context,facade,api:context.api,get processCalls(){return processCalls;}};
}

test('refresh copies only compiled assets, reapplies loopback guard, and preserves all fake state and seed metadata',async t=>{
  const w=workspace(t),db=path.join(w.state,'v3','d1','existing.sqlite'),beforeDb=fs.readFileSync(db),beforeConfig=fs.readFileSync(w.configFile),beforeEnv=fs.readFileSync(w.envFile);
  const result=await w.api.refreshSimpleField(),manifest=JSON.parse(fs.readFileSync(w.manifestFile,'utf8'));
  assert.equal(result.refreshed,true);assert.equal(result.databaseUnchanged,true);assert.deepEqual(fs.readFileSync(db),beforeDb);assert.deepEqual(fs.readFileSync(w.configFile),beforeConfig);assert.deepEqual(fs.readFileSync(w.envFile),beforeEnv);
  for(const field of ['seeded','seededAt','date','counts','migrations','stageHelper'])assert.deepEqual(manifest[field],w.manifest[field],field);
  assert.equal(fs.readFileSync(path.join(w.build,'tmp','simple-field','seed.sql'),'utf8'),'original seed must stay untouched');assert.equal(w.processCalls,0);
  assert.equal(fs.readFileSync(path.join(w.build,'.open-next','worker.js'),'utf8'),'new compiled worker');assert.equal(manifest.source.workerSha256,hash('new compiled worker'));assert.equal(manifest.refreshInProgress,false);
  const wrapper=fs.readFileSync(path.join(w.build,'.open-next','local-preview-worker.mjs'),'utf8');assert.ok(wrapper.includes("url.port === '8797'"));assert.ok(!wrapper.includes("url.port === '8787'"));assert.ok(wrapper.includes('LOCAL_PREVIEW_OUTBOUND_BLOCKED'));assert.equal(manifest.wrapperSha256,hash(wrapper));
  for(const directory of ['public','lib','data'])assert.equal(fs.readFileSync(path.join(w.build,directory,'fixture.txt'),'utf8'),'new '+directory);
  assert.equal(fs.readFileSync(path.join(w.build,'app','free-quote','pricing.js'),'utf8'),'new pricing source');
});

test('refresh refuses a running workspace or missing ownership without touching its manifest or database',async t=>{
  const w=workspace(t,{running:true}),before=fs.readFileSync(w.manifestFile);await assert.rejects(w.api.refreshSimpleField(),/Stop the owned review server/);assert.deepEqual(fs.readFileSync(w.manifestFile),before);assert.equal(w.processCalls,0);
  w.context.TEST_RUNNING=false;fs.unlinkSync(w.manifestFile);await assert.rejects(w.api.refreshSimpleField(),/already seeded ownership manifest/);assert.equal(fs.existsSync(w.manifestFile),false);assert.equal(w.processCalls,0);
});

test('refresh rejects a changed existing worker and a non-synthetic source before any copy or reseed',async t=>{
  const w=workspace(t),before=fs.readFileSync(w.manifestFile);write(path.join(w.build,'.open-next','worker.js'),'unowned changed worker');await assert.rejects(w.api.refreshSimpleField(),/Existing compiled worker changed/);assert.deepEqual(fs.readFileSync(w.manifestFile),before);
  write(path.join(w.build,'.open-next','worker.js'),'old compiled worker');write(path.join(w.main,'tmp','private-build-inputs-manifest.json'),JSON.stringify({mode:'private',files:[]}));await assert.rejects(w.api.refreshSimpleField(),/synthetic build cache/);assert.deepEqual(fs.readFileSync(w.manifestFile),before);assert.equal(w.processCalls,0);
});

test('a failed compiled copy blocks startup until a safe refresh retry completes and never runs database commands',async t=>{
  const w=workspace(t),copy=w.facade.cpSync;w.facade.cpSync=()=>{throw Error('simulated copy failure');};await assert.rejects(w.api.refreshSimpleField(),/simulated copy failure/);
  assert.equal(JSON.parse(fs.readFileSync(w.manifestFile,'utf8')).refreshInProgress,true);await assert.rejects(w.api.startSimpleField(),/refresh did not finish/);assert.equal(w.processCalls,0);
  w.facade.cpSync=copy;assert.equal((await w.api.refreshSimpleField()).databaseUnchanged,true);assert.equal(JSON.parse(fs.readFileSync(w.manifestFile,'utf8')).refreshInProgress,false);assert.equal(w.processCalls,0);
});

test('explicit legacy-origin rebind changes only fake origin metadata and stage helper while preserving D1/R2 and compiled hashes',async t=>{
  const w=workspace(t,{legacyOrigin:true}),report=path.join(w.root,'tmp','simple-ui-field-stage.json'),oldReport=JSON.stringify({origin:'http://127.0.0.1:8797',auth:{status:403},fieldWrites:0});write(report,oldReport);
  const db=fs.readFileSync(path.join(w.state,'v3','d1','existing.sqlite')),proof=fs.readFileSync(path.join(w.state,'v3','r2','proof.bin'));
  const result=await w.api.rebindSimpleFieldOrigin(),manifest=JSON.parse(fs.readFileSync(w.manifestFile,'utf8')),config=JSON.parse(fs.readFileSync(w.configFile,'utf8'));
  assert.equal(result.origin,'http://localhost:8797');assert.equal(result.databaseUnchanged,true);assert.equal(manifest.origin,'http://localhost:8797');
  for(const key of ['LOCAL_PREVIEW_ORIGIN','SITE_ORIGIN','WORKER_ORIGIN'])assert.equal(config.vars[key],'http://localhost:8797');assert.equal(config.dev.ip,'127.0.0.1');assert.equal(config.dev.port,8797);
  for(const key of ['seeded','seededAt','date','counts','migrations','source','wrapperSha256'])assert.deepEqual(manifest[key],w.manifest[key],key);
  assert.deepEqual(fs.readFileSync(path.join(w.state,'v3','d1','existing.sqlite')),db);assert.deepEqual(fs.readFileSync(path.join(w.state,'v3','r2','proof.bin')),proof);
  const stage=fs.readFileSync(path.join(w.root,'tmp','simple-ui-field-stage.mjs'),'utf8');assert.ok(stage.includes("const ORIGIN='http://localhost:8797'"));assert.ok(stage.includes("assert.equal(url.hostname,'localhost')"));
  assert.equal(fs.existsSync(report),false);assert.equal(fs.readFileSync(result.archivedReport,'utf8'),oldReport);assert.equal(w.processCalls,0);
  assert.equal((await w.api.rebindSimpleFieldOrigin()).noOp,true);
});

test('legacy-origin rebind refuses a running or non-fake workspace before changing any metadata',async t=>{
  const w=workspace(t,{legacyOrigin:true,running:true}),before=fs.readFileSync(w.manifestFile);await assert.rejects(w.api.rebindSimpleFieldOrigin(),/Stop the owned review server/);assert.deepEqual(fs.readFileSync(w.manifestFile),before);
  w.context.TEST_RUNNING=false;const config=JSON.parse(fs.readFileSync(w.configFile,'utf8'));config.vars.CRM_PAYMENTS_PROVIDER='live';write(w.configFile,JSON.stringify(config));await assert.rejects(w.api.rebindSimpleFieldOrigin());assert.deepEqual(fs.readFileSync(w.manifestFile),before);assert.equal(w.processCalls,0);
});
