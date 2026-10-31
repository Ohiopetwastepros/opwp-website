import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { executeFieldCommand } from '../lib/field-command.mjs';
import * as policy from '../lib/field-policy.mjs';
import { buildFieldCloseout, SNG_WRITE_BLOCKER } from '../lib/field-closeout.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync(new URL('../tmp/test-migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(new URL(`../tmp/test-migrations/${name}`,import.meta.url),'utf8'));
  const db = {prepare(query){return {bind(...args){return {query,args,async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};}};},async batch(rows){sql.exec('BEGIN');try{const results=rows.map(r=>({results:sql.prepare(r.query).all(...r.args)}));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  sql.exec(`INSERT INTO route_partner_members(id,organization_id,email,role,status,external_employee_id,display_name) VALUES ('tech','org-opwp','qa@example.invalid','technician','active','111','QA');
    INSERT INTO route_partner_route_plans(id,organization_id,service_date,technician_external_id,technician_name,source_provider,source_route_id,source_fingerprint,version,status,assigned_member_id) VALUES ('plan','org-opwp','${policy.operatingDate()}','111','QA','sweep_and_go','111','hash',1,'finalized','tech');
    INSERT INTO route_partner_field_shifts(id,organization_id,route_plan_id,technician_member_id,service_date) VALUES ('shift','org-opwp','plan','tech','${policy.operatingDate()}');
    INSERT INTO route_partner_load_checks(id,organization_id,route_plan_id,payment_validation_status) VALUES ('load','org-opwp','plan','not_required');
    INSERT INTO route_partner_locations(id,route_plan_id,organization_id,location_key,sequence,address) VALUES ('location','plan','org-opwp','address',1,'Test address');
    INSERT INTO route_partner_tasks(id,route_plan_id,location_id,organization_id,task_type,source_provider,external_task_id,customer_external_id,crm_completion_status) VALUES ('task','plan','location','org-opwp','scoop','sweep_and_go','100','200','pending');`);
  const source = fs.readFileSync(new URL('../lib/field-operations.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const {applyFieldAction,getFieldToday} = runPrivateInNewContext(`${source}\n({applyFieldAction,getFieldToday})`,{...policy,buildFieldCloseout,SNG_WRITE_BLOCKER,crypto,OPWP_ORGANIZATION_ID:'org-opwp'});
  const auth = {member:{id:'tech',organizationId:'org-opwp',email:'qa@example.invalid'}};
  const command = body => executeFieldCommand(db,auth,{requestId:crypto.randomUUID(),shiftId:'shift',date:policy.operatingDate(),...body},applyFieldAction);
  const start = async()=>{await command({action:'clock_in',startingMileage:1000,vehicleType:'personal'});await command({action:'confirm_load',items:[]});await command({action:'start_route'});};
  return {sql,db,auth,command,start,applyFieldAction,getFieldToday};
}
test('complete day stores times, private notes and exactly one blocked immutable closeout',async()=>{
  const f=fixture();await f.start();await f.command({action:'arrive',locationId:'location'});await f.command({action:'start_task',taskId:'task',safeToEnter:true});
  await f.command({action:'complete_task',taskId:'task',gateSecured:true,notes:'Gate latched'});
  const requestId=crypto.randomUUID();const finish={action:'complete_route',endingMileage:1010,items:[],requestId};
  await f.command(finish);await f.command(finish);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM route_partner_field_closeouts').get().n,1);
  const close=f.sql.prepare('SELECT * FROM route_partner_field_closeouts').get();assert.equal(close.status,'blocked');
  const manifest=JSON.parse(close.manifest);assert.equal(manifest.writeEnabled,false);assert.equal(manifest.employeeId,'111');assert.equal(manifest.jobs[0].officeNotes,'Gate latched');assert.ok(manifest.jobs[0].startedAt);assert.ok(manifest.clockIn);assert.ok(manifest.clockOut);
  const day=await f.getFieldToday(f.db,f.auth,policy.operatingDate());assert.equal(day.shift.status,'completed');assert.equal(day.shift.totals.workMiles,10);f.sql.close();
});
test('concurrent device actions and lost-response replay have only one effect',async()=>{
  const f=fixture();const payload={action:'clock_in',startingMileage:1000,vehicleType:'company',requestId:crypto.randomUUID()};
  const result=await Promise.allSettled([f.command(payload),f.command(payload)]);assert.ok(result.every(r=>r.status==='fulfilled'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM route_partner_field_events').get().n,1);
  await assert.rejects(f.command({...payload,startingMileage:1200}),/identifier/);
  const concurrent=await Promise.allSettled([f.command({action:'confirm_load',items:[]}),f.command({action:'confirm_load',items:[]})]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.sql.prepare('SELECT revision FROM route_partner_field_shifts').get().revision,2);f.sql.close();
});
test('wrong member, organization, future day, unreleased plan and missing clock-in are blocked',async()=>{
  const f=fixture();await assert.rejects(f.command({action:'confirm_load',items:[]}),/Clock in/);
  for(const member of [{...f.auth.member,id:'other'},{...f.auth.member,organizationId:'other'}]) await assert.rejects(executeFieldCommand(f.db,{member},{requestId:crypto.randomUUID(),shiftId:'shift',action:'clock_in'},f.applyFieldAction),/not assigned/);
  f.sql.exec("UPDATE route_partner_field_shifts SET service_date='2099-01-01'");await assert.rejects(f.command({action:'clock_in'}),/scheduled service day/);
  f.sql.prepare('UPDATE route_partner_field_shifts SET service_date=?').run(policy.operatingDate());f.sql.exec("UPDATE route_partner_route_plans SET status='superseded'");await assert.rejects(f.command({action:'clock_in'}),/no longer released/);f.sql.close();
});
test('work cannot overlap tasks or breaks; entry and gate checks are enforced',async()=>{
  const f=fixture();await f.start();await f.command({action:'start_break',breakType:'lunch',mileage:1001});
  await assert.rejects(f.command({action:'arrive',locationId:'location'}),/End your break/);
  await assert.rejects(f.command({action:'complete_route',items:[],endingMileage:1010}),/End the active break/);
  await assert.rejects(f.command({action:'end_break',mileage:999}),/below/);
  await f.command({action:'end_break',mileage:1002});await f.command({action:'arrive',locationId:'location'});
  await assert.rejects(f.command({action:'start_task',taskId:'task'}),/safe to enter/);
  await f.command({action:'start_task',taskId:'task',safeToEnter:true});
  await assert.rejects(f.command({action:'start_break',mileage:1002}),/active task/);
  await assert.rejects(f.command({action:'complete_task',taskId:'task'}),/property is secure/);f.sql.close();
});
test('a failed atomic transaction leaves no receipt or partial field changes',async()=>{
  const f=fixture();const apply=async(db)=>{await db.batch([db.prepare("UPDATE route_partner_field_shifts SET status='in_progress' WHERE id=?").bind('shift'),db.prepare('INSERT INTO not_a_table VALUES (?)').bind('x')]);return {message:'test'};};
  await assert.rejects(executeFieldCommand(f.db,f.auth,{requestId:crypto.randomUUID(),shiftId:'shift',action:'test'},apply));
  assert.equal(f.sql.prepare('SELECT status FROM route_partner_field_shifts').get().status,'pending_load');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM route_partner_field_commands').get().n,0);f.sql.close();
});
test('failed payment and unknown payment state block departure checks',async()=>{
  const f=fixture();await f.command({action:'clock_in',startingMileage:0,vehicleType:'company'});
  for(const state of ['pending','failed']){f.sql.prepare('UPDATE route_partner_load_checks SET payment_validation_status=?').run(state);await assert.rejects(f.command({action:'confirm_load',items:[]}),/payment/);}
  f.sql.close();
});
test('SNG identity checks distinguish same-name customers, locations, employees and commercial jobs',()=>{
  const row={id:10,organization_id:20,client_id:30,client_location_id:40,assigned_to_id:50,commercial:0,type:'recurring'};
  const snap=policy.sngFieldSnapshot(row);assert.deepEqual(policy.identityConflicts(snap,row,'50'),[]);
  for(const key of ['id','organization_id','client_id','client_location_id','assigned_to_id','commercial','type']) assert.ok(policy.identityConflicts(snap,{...row,[key]:'wrong'},'50').length);
  assert.ok(policy.identityConflicts(null,row,'50').length);assert.ok(policy.identityConflicts(snap,row,'other').length);
});
test('paid time excludes only unpaid breaks and full odometers preserve zero',()=>{
  const totals=policy.shiftTotals({checked_in_at:'2026-10-06 12:00:00',completed_at:'2026-10-06T20:00:00Z',starting_mileage:0,ending_mileage:100},[{break_type:'lunch',started_at:'2026-10-06 16:00:00',ended_at:'2026-10-06 16:30:00',starting_mileage:40,ending_mileage:45},{break_type:'paid_break',started_at:'2026-10-06 17:00:00',ended_at:'2026-10-06 17:15:00'}]);
  assert.deepEqual(totals,{elapsedMinutes:480,unpaidMinutes:30,paidMinutes:450,workMiles:95});assert.equal(policy.optionalNumber(''),null);assert.equal(policy.mileage(0),0);assert.throws(()=>policy.mileage(''));
  assert.deepEqual(policy.coordinates({latitude:0,longitude:0}),{latitude:0,longitude:0});assert.equal(policy.coordinates({latitude:999,longitude:2}).latitude,null);
});
test('uploaded MIME type must match file signatures',()=>{
  assert.equal(policy.imageMatches(new TextEncoder().encode('<script>x</script>'),'image/jpeg'),false);assert.equal(policy.imageMatches(Uint8Array.from([255,216,255,224]),'image/jpeg'),true);assert.equal(policy.imageMatches(new Uint8Array(10),'image/heic'),false);
});
test('SNG validation cannot confuse incomplete or skipped work with completed work',()=>{
  const source=fs.readFileSync(new URL('../lib/route-partner.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const completed=runPrivateInNewContext(`${source}\nsourceCompletion`,{});
  for(const status of ['incomplete','not_completed','uncompleted','skipped','missed','started'])assert.equal(completed({status_name:status,completed_at:'2026-10-06'}),false);
  assert.equal(completed({status_name:'completed',status_id:2}),true);assert.equal(completed({status_id:2}),true);assert.equal(completed({status_name:'completed',status_id:3}),false);
});
test('field credential reset revokes sessions and missing auth configuration fails closed',async()=>{
  const f=fixture();let configured=true;
  const source=fs.readFileSync(new URL('../lib/field-auth.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const auth=runPrivateInNewContext(`${source}\n({createFieldCredential,createFieldSession,verifyFieldRequest})`,{crypto,TextEncoder,btoa,atob,getRuntimeEnv:()=>({}),dedicatedSigningSecret:()=>configured?'field-test-secret':'',OFFICE_ACCESS_ROLE_SQL:"'office'"});
  await auth.createFieldCredential(f.db,'tech','246810');const token=await auth.createFieldSession(f.db,'tech');
  const headers=new Headers({cookie:`opwp_field_session=${token}`});assert.equal((await auth.verifyFieldRequest(headers,f.db)).authorized,true);
  configured=false;assert.equal((await auth.verifyFieldRequest(headers,f.db)).authorized,false);configured=true;
  await auth.createFieldCredential(f.db,'tech','246811');assert.equal((await auth.verifyFieldRequest(headers,f.db)).authorized,false);
  assert.equal((await auth.verifyFieldRequest(new Headers({cookie:'opwp_field_session=%broken'}),f.db)).authorized,false);f.sql.close();
});
