import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { localCrmCommand } from '../lib/local-preview-crm-commands.mjs';
import { createLocalPreviewCrmSeed } from '../scripts/local-preview-crm-seed.mjs';
import { createLocalPreviewFieldSeed } from '../scripts/local-preview-field-seed.mjs';
import { officeWorkdayCommand } from '../lib/field-workday-office.mjs';
const date='2026-11-21', actor='preview.admin@example.test', planId=`local-field-plan-2-${date}`;
async function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const file of fs.readdirSync(new URL('../tmp/test-migrations/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync(new URL(`../tmp/test-migrations/${file}`,import.meta.url),'utf8'));
  for(const file of ['0070_crm_subscriptions.sql','0071_crm_billing_uat.sql'])sql.exec(fs.readFileSync(new URL(`../schema-proposals/${file}`,import.meta.url),'utf8'));
  sql.exec((await createLocalPreviewCrmSeed({today:date})).sql);sql.exec(createLocalPreviewFieldSeed({today:date}).sql);
  const prepare=(query,bindings=[])=>({bind(...values){return prepare(query,values);},async first(){return sql.prepare(query).get(...bindings)||null;},async all(){return {results:sql.prepare(query).all(...bindings)};},async run(){return {meta:sql.prepare(query).run(...bindings)};}});
  const db={prepare,async batch(statements){sql.exec('BEGIN');try{const values=[];for(const statement of statements)values.push(await statement.run());sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  return {db,sql};
}
test('local message drafts persist once and cannot replay another actor or payload',async()=>{
  const {db,sql}=await fixture();try{
    const body={action:'save_message_draft',requestId:crypto.randomUUID(),audience:'customer',kind:'eta',customerId:'local-customer-10',planId,stopId:`local-field-stop-2-4-${date}`,text:'Ohio Pet Waste Pros is on the way. Please secure your dogs.'};
    const first=await localCrmCommand(db,actor,body,date),again=await localCrmCommand(db,actor,body,date);
    assert.deepEqual(again,first);assert.equal(first.draft.status,'draft');assert.match(first.message,/No message was sent/);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'local-preview:message:%'").get().n,1);
    await assert.rejects(localCrmCommand(db,actor,{...body,text:'Changed'},date),error=>error.status===409);
    await assert.rejects(localCrmCommand(db,'another@example.test',body,date),error=>error.status===409);
    await assert.rejects(localCrmCommand(db,actor,{...body,requestId:crypto.randomUUID(),stopId:`local-field-stop-2-3-${date}`},date),/does not belong/);
  }finally{sql.close();}
});
test('local best-fit assignment queues one reviewed yard visit without rewriting the released route or billing',async()=>{
  const {db,sql}=await fixture();try{
    const body={action:'assign_stop',requestId:crypto.randomUUID(),customerId:'local-customer-13',planId,position:2,notes:'Office reviewed service capacity and access. Yard cleanup only.'};
    const before=sql.prepare('SELECT COUNT(*) n FROM route_partner_locations').get().n;
    const invoices=sql.prepare('SELECT COUNT(*) n FROM crm_billing_invoices').get().n;
    const first=await localCrmCommand(db,actor,body,date);assert.deepEqual(await localCrmCommand(db,actor,body,date),first);
    const change=sql.prepare('SELECT * FROM field_dispatch_changes WHERE id=?').get(body.requestId),payload=JSON.parse(change.payload);
    assert.equal(change.kind,'add_visit');assert.equal(change.status,'pending');assert.equal(payload.localCustomerId,body.customerId);assert.equal(payload.proposedPosition,2);
    assert.equal(payload.stop.safety,'unknown');assert.equal(payload.stop.tasks.length,1);assert.equal(payload.stop.tasks[0].source.customerId,body.customerId);assert.equal(payload.stop.tasks[0].serviceId,'scoop');
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM route_partner_locations').get().n,before);assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_billing_invoices').get().n,invoices);
    await assert.rejects(localCrmCommand(db,actor,{...body,requestId:crypto.randomUUID()},date),error=>error.status===409);
  }finally{sql.close();}
});
test('local assignments reject existing stops, paused agreements and food orders',async()=>{
  const {db,sql}=await fixture();try{
    for(const [customerId,pattern]of [['local-customer-01',/already has a stop/],['local-customer-21',/active service agreement/],['local-customer-10',/verified order/]])await assert.rejects(localCrmCommand(db,actor,{action:'assign_stop',requestId:crypto.randomUUID(),customerId,planId,position:0,notes:'Test local assignment'},date),pattern);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,0);
  }finally{sql.close();}
});

test('local assignment dispatch, customer uniqueness receipt and request receipt roll back together on failure',async()=>{
  const {db,sql}=await fixture();try{
    const body={action:'assign_stop',requestId:crypto.randomUUID(),customerId:'local-customer-13',planId,position:2,notes:'Reviewed local yard service.'};
    sql.exec("CREATE TRIGGER test_reject_command_receipt BEFORE INSERT ON airtable_cockpit_snapshots WHEN NEW.snapshot_key LIKE 'local-preview:crm-command:%' BEGIN SELECT RAISE(ABORT,'TEST_RECEIPT_FAILURE'); END;");
    await assert.rejects(localCrmCommand(db,actor,body,date),/TEST_RECEIPT_FAILURE/);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,0);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'local-preview:assignment:%' OR snapshot_key LIKE 'local-preview:crm-command:%'").get().n,0);
    sql.exec('DROP TRIGGER test_reject_command_receipt');
    assert.equal((await localCrmCommand(db,actor,body,date)).ok,true);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,1);
  }finally{sql.close();}
});

test('local message draft and request receipt roll back together and can retry the same request',async()=>{
  const {db,sql}=await fixture();try{
    const body={action:'save_message_draft',requestId:crypto.randomUUID(),audience:'team',kind:'message',customerId:'local-customer-02',text:'Review safe access before this visit.'};
    sql.exec("CREATE TRIGGER test_reject_draft_receipt BEFORE INSERT ON airtable_cockpit_snapshots WHEN NEW.snapshot_key LIKE 'local-preview:crm-command:%' BEGIN SELECT RAISE(ABORT,'TEST_RECEIPT_FAILURE'); END;");
    await assert.rejects(localCrmCommand(db,actor,body,date),/TEST_RECEIPT_FAILURE/);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'local-preview:message:%' OR snapshot_key LIKE 'local-preview:crm-command:%'").get().n,0);
    sql.exec('DROP TRIGGER test_reject_draft_receipt');
    assert.equal((await localCrmCommand(db,actor,body,date)).draft.text,body.text);
  }finally{sql.close();}
});

test('local assignment cannot duplicate an accepted change on another route',async()=>{
  const {db,sql}=await fixture();try{
    const body={action:'assign_stop',requestId:crypto.randomUUID(),customerId:'local-customer-13',planId,position:0,notes:'Office reviewed this local service.'};
    await localCrmCommand(db,actor,body,date);
    sql.prepare("UPDATE field_dispatch_changes SET status='accepted' WHERE id=?").run(body.requestId);
    await assert.rejects(localCrmCommand(db,actor,{...body,requestId:crypto.randomUUID(),planId:`local-field-plan-1-${date}`},date),error=>error.status===409);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,1);
  }finally{sql.close();}
});

test('local command validation rejects unsupported identities, notes, positions and mismatched draft route contexts',async()=>{
  const {db,sql}=await fixture();try{
    const assignment={action:'assign_stop',requestId:crypto.randomUUID(),customerId:'local-customer-13',planId,position:0,notes:'Review local assignment.'};
    for(const changes of [{action:'send_message'},{requestId:'not-a-uuid'},{customerId:'production-customer'},{customerId:'local-customer-99'},{planId:'production-route'},{position:-1},{position:60},{position:1.5},{notes:' '},{notes:'x'.repeat(2001)},{notes:'Bad\u0000note'}])await assert.rejects(localCrmCommand(db,actor,{...assignment,...changes},date));
    for(const body of [null,[],{},'assign_stop'])await assert.rejects(localCrmCommand(db,actor,body,date));
    const draft={action:'save_message_draft',requestId:crypto.randomUUID(),audience:'customer',kind:'eta',customerId:'local-customer-01',planId:`local-field-plan-1-${date}`,text:'Arrival draft.'};
    for(const changes of [{audience:'everyone'},{kind:'send'},{text:''},{text:'x'.repeat(2001)},{planId:'local-field-plan-1-2026-11-20'},{planId,stopId:`local-field-stop-1-1-${date}`},{planId:null,stopId:`local-field-stop-1-1-${date}`}])await assert.rejects(localCrmCommand(db,actor,{...draft,...changes},date));
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,0);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'local-preview:crm-command:%' OR snapshot_key LIKE 'local-preview:message:%'").get().n,0);
  }finally{sql.close();}
});

test('local assignments reject routes outside today or already completed without creating a change',async()=>{
  const {db,sql}=await fixture();try{
    const body={action:'assign_stop',requestId:crypto.randomUUID(),customerId:'local-customer-13',planId,position:0,notes:'Review local assignment.'};
    await assert.rejects(localCrmCommand(db,actor,{...body,planId:'local-field-plan-2-2026-11-20'},date),/available local route/);
    sql.prepare("UPDATE route_partner_route_plans SET status='completed' WHERE id=?").run(planId);
    await assert.rejects(localCrmCommand(db,actor,body,date),/available local route/);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,0);
  }finally{sql.close();}
});

test('cancelled local assignments can move routes and a failed replacement preserves the cancelled lock atomically',async()=>{
  const {db,sql}=await fixture();try{
    const first={action:'assign_stop',requestId:crypto.randomUUID(),customerId:'local-customer-13',planId,position:0,notes:'Initial local yard assignment.'};
    await localCrmCommand(db,actor,first,date);
    sql.prepare("UPDATE field_dispatch_changes SET status='cancelled' WHERE id=?").run(first.requestId);
    const key=`local-preview:assignment:${date}:${first.customerId}`;
    const oldLock=sql.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(key).payload;
    const replacement={...first,requestId:crypto.randomUUID(),planId:`local-field-plan-1-${date}`,notes:'Move cancelled local visit to the other route.'};
    sql.exec("CREATE TRIGGER test_reject_replacement BEFORE INSERT ON airtable_cockpit_snapshots WHEN NEW.snapshot_key LIKE 'local-preview:crm-command:%' BEGIN SELECT RAISE(ABORT,'TEST_REPLACEMENT_FAILURE'); END;");
    await assert.rejects(localCrmCommand(db,actor,replacement,date));
    assert.equal(sql.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(key).payload,oldLock);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes WHERE id=?').get(replacement.requestId).n,0);
    assert.equal(sql.prepare('SELECT status FROM field_dispatch_changes WHERE id=?').get(first.requestId).status,'cancelled');
    sql.exec('DROP TRIGGER test_reject_replacement');
    const result=await localCrmCommand(db,actor,replacement,date);
    assert.equal(result.ok,true);
    assert.deepEqual(JSON.parse(sql.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(key).payload),{requestId:replacement.requestId,planId:replacement.planId});
    assert.equal(sql.prepare('SELECT status FROM field_dispatch_changes WHERE id=?').get(replacement.requestId).status,'pending');
    assert.deepEqual(await localCrmCommand(db,actor,replacement,date),result);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,2);
  }finally{sql.close();}
});

test('concurrent local assignment commits replay the same request and reject competing requests without duplicate changes',async()=>{
  for(const scenario of ['same-request','other-request','other-actor']){
    const {db,sql}=await fixture();try{
      await officeWorkdayCommand(db,actor,{action:'open_workday',shiftId:`local-field-shift-2-${date}`});
      let arrived=0,release;
      const barrier=new Promise(resolve=>{release=resolve;});
      let transactionQueue=Promise.resolve();
      const racingDb={...db,async batch(statements){
        arrived++;if(arrived===2)release();await barrier;
        const commit=transactionQueue.then(()=>db.batch(statements));
        transactionQueue=commit.catch(()=>{});return commit;
      }};
      const body={action:'assign_stop',requestId:crypto.randomUUID(),customerId:'local-customer-13',planId,position:0,notes:'Concurrent local assignment review.'};
      const competingBody=scenario==='other-request'?{...body,requestId:crypto.randomUUID()}:body;
      const results=await Promise.allSettled([localCrmCommand(racingDb,actor,body,date),localCrmCommand(racingDb,scenario==='other-actor'?'other.preview@example.test':actor,competingBody,date)]);
      const completed=results.filter(result=>result.status==='fulfilled'),failed=results.filter(result=>result.status==='rejected');
      assert.equal(completed.length,scenario==='same-request'?2:1,scenario);
      if(scenario==='same-request')assert.deepEqual(completed[0].value,completed[1].value);
      else assert.equal(failed[0].reason.status,409);
      assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_dispatch_changes').get().n,1);
      assert.equal(sql.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'local-preview:assignment:%'").get().n,1);
      assert.equal(sql.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'local-preview:crm-command:%'").get().n,1);
    }finally{sql.close();}
  }
});
