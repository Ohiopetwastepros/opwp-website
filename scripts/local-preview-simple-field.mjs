// A separate, disposable, fabricated screenshot workspace. This never builds,
// deploys, touches the main preview state, or runs a remote database command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {previewBuild,previewConfig,assertPreviewBranch} from './local-preview.mjs';

export const SIMPLE_ORIGIN='http://localhost:8797';
const LEGACY_SIMPLE_ORIGIN='http://127.0.0.1:8797';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const MAIN=path.resolve(previewBuild);
export const SIMPLE_BUILD=path.join(process.env.LOCALAPPDATA||'C:/Users/Craig/AppData/Local','CodexBuildCaches','opwp-route-os-simple-field-20261121');
export const SIMPLE_STATE=path.join(ROOT,'.wrangler','route-os-simple-field-review');
const DATABASE='opwp-route-os-simple-field-review';
const CONFIG=path.join(SIMPLE_BUILD,'wrangler.simple-field.json');
const MANIFEST=path.join(SIMPLE_BUILD,'tmp','simple-field-workspace.json');
const EMPTY_ENV=path.join(SIMPLE_BUILD,'tmp','simple-field','no-secrets.env');
const MIGRATIONS=path.join(MAIN,'tmp','local-preview','migrations');
const WRANGLER=path.join(MAIN,'node_modules','wrangler','bin','wrangler.js');
const STAGE_SOURCE=path.join(ROOT,'scripts','local-preview-mark-field-stage.mjs');
const STAGE_COPY=path.join(ROOT,'tmp','simple-ui-field-stage.mjs');
const APPLICATION_TABLES=['crm_subscription_customers','crm_subscriptions','crm_billing_invoices','route_partner_members','route_partner_locations','route_partner_tasks','route_partner_field_shifts','field_workdays'];
const normalize=value=>path.resolve(value).replaceAll('\\','/').toLowerCase();
const digest=value=>createHash('sha256').update(value).digest('hex');
const fileHash=file=>digest(fs.readFileSync(file));
const nonempty=directory=>fs.existsSync(directory)&&fs.readdirSync(directory).length>0;
function inside(parent,child){const relative=path.relative(path.resolve(parent),path.resolve(child));return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
function locations(){
  assert.equal(new URL(SIMPLE_ORIGIN).hostname,'localhost');assert.equal(new URL(SIMPLE_ORIGIN).port,'8797');
  assert.notEqual(normalize(SIMPLE_BUILD),normalize(MAIN));assert.ok(!inside(MAIN,SIMPLE_BUILD)&&!inside(SIMPLE_BUILD,MAIN));
  assert.equal(normalize(SIMPLE_STATE),normalize(path.join(ROOT,'.wrangler','route-os-simple-field-review')));
  assert.notEqual(normalize(SIMPLE_STATE),normalize(path.join(ROOT,'.wrangler','route-os-ui-preview')));
  assert.ok(inside(path.join(process.env.LOCALAPPDATA||'C:/Users/Craig/AppData/Local','CodexBuildCaches'),SIMPLE_BUILD));
}
function syntheticMain(){
  locations();const file=path.join(MAIN,'tmp','private-build-inputs-manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(manifest.mode,'synthetic','Only the existing synthetic build cache is permitted.');assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0);
  for(const entry of manifest.files){const target=path.join(MAIN,entry.path);assert.ok(inside(MAIN,target));assert.equal(fileHash(target),entry.sha256,`Synthetic build input changed: ${entry.path}`);}
  assert.ok(fs.existsSync(path.join(MAIN,'.open-next','worker.js')),'The root agent must finish the main build first.');assert.ok(fs.existsSync(path.join(MAIN,'.open-next','local-preview-worker.mjs')));assert.ok(fs.existsSync(WRANGLER));assert.equal(fs.lstatSync(path.join(MAIN,'node_modules')).isSymbolicLink(),false,'The main cache must own physical node_modules.');
  return {mode:manifest.mode,manifestSha256:fileHash(file),workerSha256:fileHash(path.join(MAIN,'.open-next','worker.js'))};
}
function syntheticMigrations(){
  const names=fs.readdirSync(MIGRATIONS).filter(name=>name.endsWith('.sql')).sort();assert.ok(names.length>0);return names.map(name=>{assert.match(name,/^\d{4}_[a-z0-9_]+\.sql$/);const rendered=path.join(MAIN,'tmp','test-migrations',name),proposal=path.join(MAIN,'schema-proposals',name),source=fs.existsSync(rendered)?rendered:/^00(?:6\d|7[01])_.*\.sql$/.test(name)&&fs.existsSync(proposal)?proposal:null;assert.ok(source,`Migration has no public synthetic template source: ${name}`);assert.equal(fileHash(path.join(MIGRATIONS,name)),fileHash(source),`Synthetic migration bytes differ: ${name}`);return {name,sha256:fileHash(source)};});
}
function environment(){const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(?:CLOUDFLARE_|CF_API|AIRTABLE_|QUO_|OPENPHONE_|RESEND_|SENDGRID_|SNG_|STRIPE_|QBO_|QUICKBOOKS_|CARDPOINTE_|ADMIN_|FIELD_AUTH_SECRET|OFFICE_SESSION_SECRET|FOOD_SALES_AUTH_SECRET)/i.test(key)));return {...env,CI:'true',WRANGLER_SEND_METRICS:'false'};}
function config(){const value=previewConfig();value.name='opwp-route-os-simple-field-review';value.vars={...value.vars,LOCAL_PREVIEW_ORIGIN:SIMPLE_ORIGIN,SITE_ORIGIN:SIMPLE_ORIGIN,WORKER_ORIGIN:SIMPLE_ORIGIN};value.dev={...value.dev,ip:'127.0.0.1',port:8797,local_protocol:'http'};value.d1_databases=[{...value.d1_databases[0],database_name:DATABASE,database_id:'00000000-0000-4000-8000-000000000097',migrations_dir:MIGRATIONS}];value.r2_buckets=[{...value.r2_buckets[0],bucket_name:'opwp-simple-field-review-proofs'}];value.triggers={crons:[]};return value;}
function verifyConfig(expectedOrigin=SIMPLE_ORIGIN){assert.ok([SIMPLE_ORIGIN,LEGACY_SIMPLE_ORIGIN].includes(expectedOrigin));const value=JSON.parse(fs.readFileSync(CONFIG,'utf8'));assert.equal(value.name,'opwp-route-os-simple-field-review');assert.equal(value.vars.LOCAL_PREVIEW_ORIGIN,expectedOrigin);assert.equal(value.vars.SITE_ORIGIN,expectedOrigin);assert.equal(value.vars.WORKER_ORIGIN,expectedOrigin);assert.equal(value.vars.APP_ENV,'development');assert.equal(value.vars.LOCAL_PREVIEW_ENABLED,'true');assert.equal(value.vars.CRM_PAYMENTS_PROVIDER,'fake');assert.equal(value.vars.CRM_PAYMENTS_ENV,'uat');assert.equal(value.vars.EMAIL_SENDING_ENABLED,'false');assert.equal(value.vars.EMAIL_PROVIDER,'disabled');assert.equal(value.vars.SMS_PROVIDER,'disabled');assert.equal(value.vars.FIELD_NOTIFICATIONS_ENABLED,'false');assert.equal(value.dev.ip,'127.0.0.1');assert.equal(value.dev.port,8797);assert.deepEqual(value.triggers.crons,[]);assert.equal(value.d1_databases.length,1);assert.equal(value.d1_databases[0].database_name,DATABASE);assert.equal(value.d1_databases[0].database_id,'00000000-0000-4000-8000-000000000097');assert.equal(value.r2_buckets.length,1);assert.equal(value.r2_buckets[0].bucket_name,'opwp-simple-field-review-proofs');assert.equal(normalize(value.d1_databases[0].migrations_dir),normalize(MIGRATIONS));return value;}
function wrangler(args,{capture=false}={}){
  locations();verifyConfig();assert.ok(!args.includes('--remote'));assert.ok(args.includes('--local'));const persist=args.indexOf('--persist-to');assert.ok(persist>=0);assert.equal(normalize(args[persist+1]),normalize(SIMPLE_STATE));
  const result=spawnSync(process.execPath,[WRANGLER,...args],{cwd:SIMPLE_BUILD,env:environment(),windowsHide:true,encoding:'utf8',stdio:capture?'pipe':'inherit',maxBuffer:16*1024*1024});if(result.error)throw result.error;if(result.status!==0)throw Error(`Isolated local Wrangler command failed (${result.status}).${capture?` ${result.stderr||''}`:''}`);return result.stdout||'';
}
const localArgs=()=>['--config',CONFIG,'--env-file',EMPTY_ENV,'--local','--persist-to',SIMPLE_STATE];
function rows(sql){const output=wrangler(['d1','execute',DATABASE,'--command',sql,'--json',...localArgs()],{capture:true});let result;try{result=JSON.parse(output);}catch{const start=output.indexOf('['),end=output.lastIndexOf(']');assert.ok(start>=0&&end>=start,'The local Wrangler query did not return JSON.');result=JSON.parse(output.slice(start,end+1));}assert.ok(Array.isArray(result));for(const entry of result)assert.equal(entry.success,true);return result.flatMap(entry=>entry.results||[]);}
function counts(){const present=new Set(rows("SELECT name FROM sqlite_master WHERE type='table'").map(row=>row.name));return Object.fromEntries(APPLICATION_TABLES.map(table=>[table,present.has(table)?Number(rows(`SELECT COUNT(*) n FROM ${table}`)[0].n):0]));}
function writeManifest(value){fs.mkdirSync(path.dirname(MANIFEST),{recursive:true});fs.writeFileSync(MANIFEST,`${JSON.stringify(value,null,2)}\n`);}
function owner({allowLegacyOrigin=false}={}){if(!fs.existsSync(MANIFEST))return null;const value=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));assert.equal(value.mode,'synthetic');assert.ok(value.origin===SIMPLE_ORIGIN||allowLegacyOrigin&&value.origin===LEGACY_SIMPLE_ORIGIN,'The ownership manifest origin is not allowed.');assert.equal(normalize(value.persist),normalize(SIMPLE_STATE));assert.equal(normalize(value.build),normalize(SIMPLE_BUILD));return value;}
async function listening(){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port:8797});const finish=value=>{socket.destroy();resolve(value);};socket.setTimeout(1000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));});}
function stageCopy(){
  const original=fs.readFileSync(STAGE_SOURCE,'utf8');assert.equal((original.match(/const ORIGIN='http:\/\/localhost:8787';/g)||[]).length,1);assert.equal((original.match(/assert\.equal\(url\.hostname,'localhost'\)/g)||[]).length,1);assert.equal((original.match(/tmp\/mark-v2-field-stage\.json/g)||[]).length,1);
  const hostname=new URL(SIMPLE_ORIGIN).hostname;
  const adapted=original.replace("const ORIGIN='http://localhost:8787';",`const ORIGIN='${SIMPLE_ORIGIN}';`).replace("assert.equal(url.hostname,'localhost')",`assert.equal(url.hostname,'${hostname}')`).replace('tmp/mark-v2-field-stage.json','tmp/simple-ui-field-stage.json');
  const reversed=adapted.replace(`const ORIGIN='${SIMPLE_ORIGIN}';`,"const ORIGIN='http://localhost:8787';").replace(`assert.equal(url.hostname,'${hostname}')`,"assert.equal(url.hostname,'localhost')").replace('tmp/simple-ui-field-stage.json','tmp/mark-v2-field-stage.json');assert.equal(reversed,original);fs.mkdirSync(path.dirname(STAGE_COPY),{recursive:true});fs.writeFileSync(STAGE_COPY,adapted);return {path:STAGE_COPY,sha256:digest(adapted),sourceSha256:digest(original)};
}
export async function rebindSimpleFieldOrigin(){
  assertPreviewBranch();locations();assert.equal(await listening(),false,'Stop the owned review server on port 8797 before changing its origin.');
  const previous=owner({allowLegacyOrigin:true});assert.equal(previous?.seeded,true,'Origin rebind requires the already seeded, owned synthetic workspace.');assert.notEqual(previous.refreshInProgress,true,'Finish the existing compiled refresh before changing origin.');verifyConfig(previous.origin);
  if(previous.origin===SIMPLE_ORIGIN)return {rebound:true,noOp:true,origin:SIMPLE_ORIGIN,build:SIMPLE_BUILD,persist:SIMPLE_STATE,databaseUnchanged:true};
  assert.equal(previous.origin,LEGACY_SIMPLE_ORIGIN,'Only the exact legacy loopback origin can transition.');
  const beforeState=stateFingerprint(),beforeConfig=fs.readFileSync(CONFIG),beforeManifest=fs.readFileSync(MANIFEST),beforeStage=fs.existsSync(STAGE_COPY)?fs.readFileSync(STAGE_COPY):null;
  const worker=compiledTarget('.open-next/worker.js'),wrapper=compiledTarget('.open-next/local-preview-worker.mjs');assert.equal(fileHash(worker),previous.source.workerSha256);assert.equal(fileHash(wrapper),previous.wrapperSha256);
  const report=path.resolve(ROOT,'tmp','simple-ui-field-stage.json'),archive=path.resolve(ROOT,'tmp','simple-ui-field-stage-auth403-127-origin-'+new Date().toISOString().replaceAll(/[^0-9A-Za-z]/g,'')+'.json');
  assert.ok(inside(path.join(ROOT,'tmp'),report)&&inside(path.join(ROOT,'tmp'),archive));if(fs.existsSync(report))assert.equal(fs.lstatSync(report).isSymbolicLink(),false);assert.equal(fs.existsSync(archive),false);
  try{
    const stageHelper=stageCopy(),nextConfig=JSON.parse(beforeConfig.toString('utf8'));for(const key of ['LOCAL_PREVIEW_ORIGIN','SITE_ORIGIN','WORKER_ORIGIN'])nextConfig.vars[key]=SIMPLE_ORIGIN;
    fs.writeFileSync(CONFIG,JSON.stringify(nextConfig,null,2)+String.fromCharCode(10));verifyConfig();
    const next={...previous,origin:SIMPLE_ORIGIN,previousOrigin:LEGACY_SIMPLE_ORIGIN,originReboundAt:new Date().toISOString(),stageHelper};
    for(const key of ['seeded','seededAt','date','counts','migrations','source','wrapperSha256'])assert.deepEqual(next[key],previous[key]);
    assert.equal(stateFingerprint(),beforeState,'The fake database/state changed during origin rebind.');assert.equal(await listening(),false,'The review server must stay stopped during origin rebind.');writeManifest(next);
    let archivedReport=null;if(fs.existsSync(report)){fs.renameSync(report,archive);archivedReport=archive;}
    return {rebound:true,noOp:false,previousOrigin:LEGACY_SIMPLE_ORIGIN,origin:SIMPLE_ORIGIN,build:SIMPLE_BUILD,persist:SIMPLE_STATE,manifest:MANIFEST,stageHelper:STAGE_COPY,archivedReport,databaseUnchanged:true,date:next.date,counts:next.counts};
  }catch(error){fs.writeFileSync(CONFIG,beforeConfig);fs.writeFileSync(MANIFEST,beforeManifest);if(beforeStage)fs.writeFileSync(STAGE_COPY,beforeStage);else if(fs.existsSync(STAGE_COPY)){assert.ok(inside(path.join(ROOT,'tmp'),STAGE_COPY));fs.unlinkSync(STAGE_COPY);}throw error;}
}
function compiledTarget(relative){
  const target=path.resolve(SIMPLE_BUILD,relative);assert.ok(inside(SIMPLE_BUILD,target),'Compiled target must stay inside the owned review cache.');
  assert.equal(normalize(fs.realpathSync(SIMPLE_BUILD)),normalize(SIMPLE_BUILD),'The review build root cannot be a link.');
  let cursor=path.resolve(SIMPLE_BUILD);for(const part of path.relative(SIMPLE_BUILD,target).split(path.sep)){cursor=path.join(cursor,part);if(fs.existsSync(cursor))assert.equal(fs.lstatSync(cursor).isSymbolicLink(),false,'Compiled target cannot pass through a link.');}
  return target;
}
function stateFingerprint(){
  assert.ok(nonempty(SIMPLE_STATE),'A seeded review workspace must have existing local state.');
  assert.equal(normalize(fs.realpathSync(SIMPLE_STATE)),normalize(SIMPLE_STATE),'Local fake state cannot be a link.');
  const files=[];const visit=directory=>{for(const name of fs.readdirSync(directory).sort()){const file=path.join(directory,name),stat=fs.lstatSync(file);assert.equal(stat.isSymbolicLink(),false,'Local state cannot contain a link.');if(stat.isDirectory())visit(file);else if(stat.isFile())files.push([path.relative(SIMPLE_STATE,file).split(path.sep).join('/'),stat.size,fileHash(file)]);}};visit(SIMPLE_STATE);return digest(JSON.stringify(files));
}
function wrapperForSimpleField(wrapper){
  const guard="url.port === '8787'";assert.equal(wrapper.split(guard).length-1,1,'Expected exactly one main-preview port guard.');
  for(const required of ['globalThis.fetch = async () =>','LOCAL_PREVIEW_OUTBOUND_BLOCKED','async scheduled()',"env.CRM_PAYMENTS_PROVIDER === 'fake'","env.APP_ENV === 'development'"])assert.ok(wrapper.includes(required),'Main wrapper must retain every local fake/egress/scheduler guard.');
  const isolated=wrapper.replace(guard,"url.port === '8797'");assert.equal(isolated.replace("url.port === '8797'",guard),wrapper);return isolated;
}
export async function refreshSimpleField(){
  assertPreviewBranch();locations();assert.equal(await listening(),false,'Stop the owned review server on port 8797 before refreshing compiled files.');
  const previous=owner();assert.equal(previous?.seeded,true,'Refresh requires this helper\'s already seeded ownership manifest. It never prepares or seeds a workspace.');verifyConfig();
  const main=syntheticMain(),mainWrapper=path.join(MAIN,'.open-next','local-preview-worker.mjs'),mainWrapperHash=fileHash(mainWrapper),isolated=wrapperForSimpleField(fs.readFileSync(mainWrapper,'utf8'));
  const worker=compiledTarget('.open-next/worker.js'),wrapper=compiledTarget('.open-next/local-preview-worker.mjs');
  if(!previous.refreshInProgress){assert.equal(fileHash(worker),previous.source.workerSha256,'Existing compiled worker changed outside the owned helper.');assert.equal(fileHash(wrapper),previous.wrapperSha256,'Existing local wrapper changed outside the owned helper.');}
  const beforeState=stateFingerprint(),beforeConfig=fileHash(CONFIG),beforeEnv=fileHash(EMPTY_ENV),preserved={seeded:previous.seeded,seededAt:previous.seededAt,date:previous.date,counts:previous.counts};
  const refreshing={...previous,refreshInProgress:true,refreshStartedAt:new Date().toISOString()};writeManifest(refreshing);
  try{
    for(const relative of ['.open-next','public','lib','data']){const from=path.resolve(MAIN,relative),to=compiledTarget(relative);assert.ok(inside(MAIN,from));assert.equal(fs.lstatSync(from).isSymbolicLink(),false);fs.cpSync(from,to,{recursive:true,force:true,filter:file=>{assert.equal(fs.lstatSync(file).isSymbolicLink(),false,'Compiled sources cannot contain links.');return true;}});}
    const pricing=compiledTarget('app/free-quote/pricing.js');fs.mkdirSync(path.dirname(pricing),{recursive:true});fs.copyFileSync(path.join(MAIN,'app','free-quote','pricing.js'),pricing);
    fs.writeFileSync(wrapper,isolated);
    assert.deepEqual(syntheticMain(),main,'The main compiled build changed during refresh. Finish its build before retrying.');assert.equal(fileHash(mainWrapper),mainWrapperHash,'The main local wrapper changed during refresh.');
    assert.equal(fileHash(worker),main.workerSha256);assert.equal(fileHash(wrapper),digest(isolated));assert.equal(fileHash(CONFIG),beforeConfig);assert.equal(fileHash(EMPTY_ENV),beforeEnv);assert.equal(stateFingerprint(),beforeState,'The existing fake database/state changed during refresh.');assert.equal(await listening(),false,'The review server must remain stopped until refresh finishes.');verifyConfig();
    const next={...previous,source:main,wrapperSha256:fileHash(wrapper),refreshInProgress:false,refreshedAt:new Date().toISOString(),refreshCount:(previous.refreshCount||0)+1};delete next.refreshError;
    assert.deepEqual({seeded:next.seeded,seededAt:next.seededAt,date:next.date,counts:next.counts},preserved);writeManifest(next);
    return {refreshed:true,origin:SIMPLE_ORIGIN,build:SIMPLE_BUILD,persist:SIMPLE_STATE,manifest:MANIFEST,seeded:true,date:next.date,counts:next.counts,databaseUnchanged:true,workerSha256:next.source.workerSha256,wrapperSha256:next.wrapperSha256};
  }catch(error){writeManifest({...refreshing,refreshError:error.message});throw error;}
}
export async function prepareSimpleField(){
  assertPreviewBranch();const main=syntheticMain(),migrations=syntheticMigrations();assert.equal(await listening(),false,'Port 8797 is in use; do not copy over a running review workspace.');const previous=owner();
  if(previous?.seeded){verifyConfig();return {prepared:true,noOp:true,reason:'The isolated fake workspace is already seeded and will not be reseeded.',origin:SIMPLE_ORIGIN,build:SIMPLE_BUILD,persist:SIMPLE_STATE,manifest:MANIFEST};}
  if(!previous){assert.equal(nonempty(SIMPLE_STATE),false,'Refusing to seed nonempty state without this helper’s ownership manifest.');assert.equal(nonempty(SIMPLE_BUILD),false,'Refusing to overwrite an unowned build cache.');}else{verifyConfig();assert.ok(Object.values(counts()).every(count=>count===0),'Refusing to reseed nonempty or partially seeded application tables.');}
  fs.mkdirSync(SIMPLE_BUILD,{recursive:true});
  fs.cpSync(path.join(MAIN,'.open-next'),path.join(SIMPLE_BUILD,'.open-next'),{recursive:true});
  for(const directory of ['public','lib','data'])fs.cpSync(path.join(MAIN,directory),path.join(SIMPLE_BUILD,directory),{recursive:true});
  const pricing=path.join(SIMPLE_BUILD,'app','free-quote','pricing.js');fs.mkdirSync(path.dirname(pricing),{recursive:true});fs.copyFileSync(path.join(MAIN,'app','free-quote','pricing.js'),pricing);
  const modules=path.join(SIMPLE_BUILD,'node_modules'),physical=fs.realpathSync(path.join(MAIN,'node_modules'));if(fs.existsSync(modules))assert.equal(normalize(fs.realpathSync(modules)),normalize(physical));else fs.symlinkSync(physical,modules,'junction');
  const wrapperFile=path.join(SIMPLE_BUILD,'.open-next','local-preview-worker.mjs'),wrapper=fs.readFileSync(wrapperFile,'utf8'),guard="url.port === '8787'";assert.equal(wrapper.split(guard).length-1,1,'Expected exactly one main-preview port guard.');assert.ok(wrapper.includes('globalThis.fetch = async () =>'));assert.ok(wrapper.includes('LOCAL_PREVIEW_OUTBOUND_BLOCKED'));assert.ok(wrapper.includes('async scheduled()'));const isolated=wrapper.replace(guard,"url.port === '8797'");assert.equal(isolated.replace("url.port === '8797'",guard),wrapper);fs.writeFileSync(wrapperFile,isolated);
  fs.mkdirSync(path.dirname(EMPTY_ENV),{recursive:true});fs.writeFileSync(EMPTY_ENV,'# Empty. Only explicit fabricated bindings from wrangler.simple-field.json are used.\n');fs.writeFileSync(CONFIG,`${JSON.stringify(config(),null,2)}\n`);verifyConfig();
  const state={mode:'synthetic',origin:SIMPLE_ORIGIN,build:SIMPLE_BUILD,persist:SIMPLE_STATE,database:DATABASE,preparedAt:new Date().toISOString(),seeded:false,source:main,migrations,wrapperSha256:fileHash(wrapperFile),stageHelper:stageCopy()};writeManifest(state);
  wrangler(['d1','migrations','apply',DATABASE,...localArgs()]);const empty=counts();assert.ok(Object.values(empty).every(count=>count===0),'Refusing to seed nonempty application records.');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const {createLocalPreviewCrmSeed}=await import(pathToFileURL(path.join(MAIN,'scripts','local-preview-crm-seed.mjs')).href),{createLocalPreviewFieldSeed}=await import(pathToFileURL(path.join(MAIN,'scripts','local-preview-field-seed.mjs')).href),{localPreviewAdminSeed}=await import(pathToFileURL(path.join(MAIN,'lib','local-preview-admin.mjs')).href);const vars=config().vars;
  const crm=await createLocalPreviewCrmSeed({today}),field=await createLocalPreviewFieldSeed({today,fieldSecret:vars.FIELD_AUTH_SECRET}),admin=await localPreviewAdminSeed(vars);const seed=path.join(SIMPLE_BUILD,'tmp','simple-field','seed.sql');fs.writeFileSync(seed,[crm.sql,field.sql,admin.sql].join('\n'));wrangler(['d1','execute',DATABASE,'--file',seed,'--yes',...localArgs()]);
  const seeded=counts();assert.equal(seeded.crm_subscription_customers,25);assert.equal(seeded.crm_subscriptions,24);assert.equal(seeded.crm_billing_invoices,45);assert.equal(seeded.route_partner_members,2);assert.equal(seeded.route_partner_locations,12);assert.equal(seeded.route_partner_field_shifts,2);assert.equal(seeded.field_workdays,0);assert.equal(seeded.route_partner_tasks,field.manifest.taskCount);Object.assign(state,{seeded:true,seededAt:new Date().toISOString(),date:today,counts:seeded});writeManifest(state);
  return {prepared:true,noOp:false,origin:SIMPLE_ORIGIN,build:SIMPLE_BUILD,persist:SIMPLE_STATE,manifest:MANIFEST,stageHelper:STAGE_COPY,counts:seeded};
}
export async function simpleFieldStatus(){locations();const manifest=owner(),running=await listening(),status={origin:SIMPLE_ORIGIN,build:SIMPLE_BUILD,persist:SIMPLE_STATE,prepared:!!manifest?.seeded,running,manifest:manifest?MANIFEST:null,stageHelper:fs.existsSync(STAGE_COPY)?STAGE_COPY:null};if(running){const response=await fetch(`${SIMPLE_ORIGIN}/local-preview/health/`,{redirect:'error',signal:AbortSignal.timeout(3000)}),body=await response.json();assert.equal(response.status,200);assert.equal(body.origin,SIMPLE_ORIGIN);assert.equal(body.localOnly,true);assert.equal(body.processor,'fake');assert.equal(body.outboundFetch,'blocked');assert.equal(body.scheduledProcessors,'disabled');status.health=body;}return status;}
export async function startSimpleField(){assertPreviewBranch();syntheticMain();const manifest=owner();assert.equal(manifest?.seeded,true,'Run prepare on the finished synthetic main build first.');assert.notEqual(manifest.refreshInProgress,true,'A compiled refresh did not finish. Run refresh after the main build is stable before starting.');verifyConfig();assert.equal(fileHash(path.join(SIMPLE_BUILD,'.open-next','worker.js')),manifest.source.workerSha256);assert.equal(fileHash(path.join(SIMPLE_BUILD,'.open-next','local-preview-worker.mjs')),manifest.wrapperSha256);assert.equal(await listening(),false,'The isolated review server is already running on port 8797.');wrangler(['dev','--ip','127.0.0.1','--port','8797','--inspector-port','9248','--show-interactive-dev-session=false',...localArgs()]);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const action=process.argv[2];if(action==='prepare')console.log(JSON.stringify(await prepareSimpleField(),null,2));else if(action==='rebind-origin')console.log(JSON.stringify(await rebindSimpleFieldOrigin(),null,2));else if(action==='refresh')console.log(JSON.stringify(await refreshSimpleField(),null,2));else if(action==='start')await startSimpleField();else if(action==='status')console.log(JSON.stringify(await simpleFieldStatus(),null,2));else throw Error('Use prepare, rebind-origin, refresh, start or status. Prepare, rebind-origin, refresh and start require the root agent’s explicit timing instruction.');}catch(error){console.error(JSON.stringify({ok:false,origin:SIMPLE_ORIGIN,error:error.message},null,2));process.exitCode=1;}
}
