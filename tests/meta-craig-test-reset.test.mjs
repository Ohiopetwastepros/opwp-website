import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {metaPhoneHash, processMetaConfirmations, storeMetaLead} from '../lib/meta-lead-workflow.mjs';
import {suppressLeadPhone} from '../lib/lead-opt-out.mjs';

const phone = '+14192620424';
const other = '+14195550101';
const page = '617929208074485';
const form = '1725121795904553';
const org = 'org-opwp';
const stamp = offset => new Date(Date.now() + offset).toISOString();
const context = {
  META_TEST_MODE:'true', META_AUTOMATION_ENABLED:'false', LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',
  META_TEST_RECIPIENTS:phone, META_TEST_FORM_IDS:form, META_ALLOWED_PAGE_IDS:page, META_TEST_APPROVAL_ID:'fixture-test',
  LEAD_CRAIG_SIGNUP_ENABLED:'true', LEAD_CONVERSATION_V2_ENABLED:'true', LEAD_PLAYBOOK_ENABLED:'true',
  META_APPROVED_SMS_FORMS:JSON.stringify({[form]:{pageId:page,consentField:'text_message_consent',disclosure:'Test quote texts only',version:'fixture'}}),
  QUO_FROM_NUMBER:'+14195550100', QUO_API_KEY:'unused-test-provider-key',
};

function setup(t) {
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  db.sqlite.exec("INSERT INTO meta_automation_releases VALUES ('fixture-test','org-opwp','meta-craig-signup-v1-test','fixture-owner','approved',datetime('now','-1 day'),NULL); UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0");
  return {db, env:{...context, DB:db}};
}
function intake(db, env, id, {from=phone, formId=form, pageId=page, graphForm=formId, consent='Yes', at=stamp(-15000)} = {}) {
  const fields = {full_name:'Test Lead Craig',phone_number:from,zip_code:'43551',number_of_dogs:'2',service_frequency:'Weekly',contact_preference:'Text',text_message_consent:consent};
  return storeMetaLead(db,env,{id,form_id:graphForm,created_time:at,field_data:Object.entries(fields).map(([name,value])=>({name,values:[value]}))},
    {leadId:id,formId,pageId});
}
async function suppress(db, number, at=stamp(-30000)) {
  const hash = await metaPhoneHash(number);
  await db.prepare("INSERT INTO lead_suppressions (organization_id,phone_hash,reason,source,created_by,created_at) VALUES (?,?,'opted_out','quo_webhook','fixture',?)").bind(org,hash,at).run();
  return hash;
}
const isSuppressed = (db, hash) => db.sqlite.prepare('SELECT 1 FROM lead_suppressions WHERE organization_id=? AND phone_hash=?').get(org,hash) !== undefined;
const resetRows = db => db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key GLOB 'meta_test_reset:*' ORDER BY captured_at").all().map(row=>JSON.parse(row.payload));

test('each new, consented Craig test archives only the previous tests and clears only his local STOP', async t => {
  const {db,env} = setup(t);
  const realStop = await suppress(db,other);
  const old = await intake(db,{...env,META_TEST_MODE:'false'},'older-fixture',{at:stamp(-40000)});
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES ('old-message',?,'org-opwp','inbound','quo_sms','STOP','fixture')").run('meta-'+old.id);
  const hash = await suppress(db,phone);
  const fresh = await intake(db,env,'new-fixture');
  assert.equal(isSuppressed(db,hash),false);
  assert.equal(isSuppressed(db,realStop),true);
  assert.deepEqual(resetRows(db).map(row=>[row.event,row.clearedSuppression.reason]),[['test reset','opted_out']]);
  assert.equal(db.sqlite.prepare('SELECT status FROM submissions WHERE id=?').get(old.id).status,'deleted');
  assert.equal(db.sqlite.prepare('SELECT status FROM meta_sms_jobs WHERE id=?').get(old.id).status,'cancelled');
  assert.ok(db.sqlite.prepare("SELECT body FROM lead_messages WHERE id='old-message'").get());
  assert.equal(db.sqlite.prepare('SELECT duplicate_of FROM meta_lead_intakes WHERE submission_id=?').get(fresh.id).duplicate_of,null);
  let sent;
  const result = await processMetaConfirmations(env,{submissionId:fresh.id,
    textSafety:async()=>({verified:true,doNotText:false}),
    loadCustomerDirectory:()=>assert.fail('Only Craig bypasses customer review in test mode'),
    fetcher:async(_url,options)=>{sent=JSON.parse(options.body);return Response.json({data:{id:'fixture-provider-id'}});},
  });
  assert.equal(result.sent,1);
  assert.deepEqual(sent.to,[phone]);
  assert.match(sent.content,/Thanks for filling out our form! Just to confirm.*2 dogs.*weekly service\?\n\nReply to opt out:\nSTOP$/);
  assert.doesNotMatch(sent.content,/\$|\u2014/);
  await suppress(db,phone,stamp(-11000));
  await intake(db,env,'new-fixture');
  assert.equal(isSuppressed(db,hash),true,'A replay must leave the new STOP in force');
  assert.equal(resetRows(db).length,1);
  const next = await intake(db,env,'another-fixture',{at:stamp(-5000)});
  assert.equal(isSuppressed(db,hash),false);
  assert.equal(resetRows(db).length,2);
  assert.equal(db.sqlite.prepare('SELECT status FROM submissions WHERE id=?').get(fresh.id).status,'deleted');
  assert.equal(db.sqlite.prepare('SELECT status FROM meta_sms_jobs WHERE id=?').get(next.id).status,'queued');
});

test('live mode, another number, another form or page, missing consent or approval and a later STOP cannot reset', async t => {
  for (const [label, envPatch, options] of [
    ['live mode',{META_TEST_MODE:'false',META_AUTOMATION_ENABLED:'true'},{}],
    ['other number',{META_TEST_RECIPIENTS:other},{from:other}],
    ['wrong form',{},{formId:'another-form'}],
    ['mismatched Graph form',{},{graphForm:'another-form'}],
    ['wrong page',{},{pageId:'another-page'}],
    ['multiple numbers',{META_TEST_RECIPIENTS:phone+','+other},{}],
    ['missing consent',{},{consent:'No'}],
    ['missing approval',{META_TEST_APPROVAL_ID:'missing'},{}],
    ['later STOP',{},{at:stamp(-45000)}],
  ]) {
    await t.test(label,async t=>{
      const {db,env}=setup(t);
      const hash=await suppress(db,options.from||phone);
      await intake(db,{...env,...envPatch},'held-fixture',options);
      assert.equal(isSuppressed(db,hash),true);
      assert.equal(resetRows(db).length,0);
    });
  }
});

test('Airtable do-not-text and a Quo transport rejection remain decisive after the local reset', async t => {
  for (const doNotText of [true,false]) {
    await t.test(doNotText ? 'Airtable veto' : 'Quo rejection', async t => {
      const {db,env}=setup(t);
      await suppress(db,phone);
      const saved=await intake(db,env,'provider-held');
      let requests=0;
      const result=await processMetaConfirmations(env,{submissionId:saved.id,
        textSafety:async()=>({verified:true,doNotText}),
        fetcher:async()=>{requests++;return new Response('{}',{status:403});},
      });
      assert.equal(result.sent,0);
      assert.equal(requests,doNotText ? 0 : 1);
      const job=db.sqlite.prepare('SELECT status,provider_message_id FROM meta_sms_jobs WHERE id=?').get(saved.id);
      assert.equal(job.status,doNotText ? 'cancelled' : 'failed');
      assert.equal(job.provider_message_id,null);
    });
  }
});

test('a repeated STOP received after the form keeps local suppression in force',async t=>{
  const {db,env}=setup(t);
  const hash=await suppress(db,phone,stamp(-40000));
  const submittedAt=stamp(-20000);
  await suppressLeadPhone(db,env,{phone,eventId:'fixture-repeat-stop',at:stamp(-10000)},
    {syncTextStatus:async()=>({verified:true})});
  const saved=await intake(db,env,'delayed-form',{at:submittedAt});
  assert.equal(isSuppressed(db,hash),true);
  assert.equal(resetRows(db).length,0);
  assert.equal(db.sqlite.prepare('SELECT block_reason FROM meta_sms_jobs WHERE id=?').get(saved.id).block_reason,'test_reset_not_granted');
});
