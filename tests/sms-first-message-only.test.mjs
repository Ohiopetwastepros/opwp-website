import assert from 'node:assert/strict';
import test from 'node:test';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {storeMetaLead, processMetaConfirmations, recordMetaReply} from '../lib/meta-lead-workflow.mjs';
import {buildMetaConfirmation, formatMetaSms} from '../lib/meta-lead-policy.mjs';
import {nextMetaResponse, metaFollowUpDrafts} from '../lib/meta-conversation.mjs';
import {renderPlaybookTemplate} from '../lib/lead-playbook.mjs';
import {formatCustomerSms} from '../lib/customer-sms.mjs';
import {buildReviewRequestSms} from '../lib/review-request-content.mjs';

const PHONE = '+14195550100';
const footer = /Reply STOP to opt out|Text STOP to unsubscribe/ig;
const leadDetails = {name: 'Casey Example', number_of_dogs: 2, zip: '43615', clean_up_frequency: 'Weekly'};
const daytime = new Date('2026-11-21T17:00:00Z');
const countFooters = body => (body.match(footer) || []).length;

function fixture(t) {
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('footer-release','org-opwp','meta-confirmation-v2','fixture-owner','Offline footer test',datetime('now','-1 minute'),NULL);
    INSERT INTO meta_automation_releases VALUES ('footer-cadence','org-opwp','meta-nurture-1-3-7-v1','fixture-owner','Offline footer test',datetime('now','-1 minute'),NULL);
    UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0;`);
  const env = {DB: db, META_AUTOMATION_ENABLED: 'true', META_AUTOMATION_APPROVAL_ID: 'footer-release',
    META_CADENCE_ENABLED: 'true', META_CADENCE_APPROVAL_ID: 'footer-cadence', QUO_API_KEY: 'fixture-only-key', QUO_FROM_NUMBER: '+14195550188',
    META_APPROVED_SMS_FORMS: JSON.stringify({'footer-form': {pageId: 'footer-page', consentField: 'sms_consent', version: 'fixture-v1', disclosure: 'Fixture automated quote text consent.'}})};
  const sent = [];
  async function intake(id = 'footer-lead') {
    const fields = {full_name: leadDetails.name, phone_number: PHONE, zip_code: leadDetails.zip, number_of_dogs: '2', service_frequency: 'weekly', contact_preference: 'text', sms_consent: 'yes'};
    return storeMetaLead(db, env, {id, form_id: 'footer-form', created_time: new Date().toISOString(), field_data: Object.entries(fields).map(([name, value]) => ({name, values: [value]}))},
      {leadId: id, formId: 'footer-form', pageId: 'footer-page'});
  }
  async function flush() {
    return processMetaConfirmations(env, {now: daytime, fetcher: async (_url, request) => {
      const payload = JSON.parse(request.body);
      assert.deepEqual(payload.to, [PHONE]);
      sent.push(payload.content);
      return Response.json({data: {id: `footer-provider-${sent.length}`}});
    }});
  }
  return {db, env, sent, intake, flush};
}

test('a brand-new Meta lead receives the footer once across retries, cadence and a correction reply', async t => {
  const f = fixture(t), saved = await f.intake();
  assert.equal((await f.flush()).sent, 1);
  assert.equal(countFooters(f.sent[0]), 1);
  assert.match(f.sent[0], /\n\nReply STOP to opt out$/);
  await f.intake();
  await f.flush();
  assert.equal(f.sent.length, 1, 'Webhook and worker retries cannot resend the initial message');
  await f.intake('footer-duplicate');
  await f.flush();
  assert.equal(f.sent.length, 1, 'A repeat Meta form from the same contact does not get another initial footer');

  f.db.sqlite.prepare("UPDATE meta_sms_jobs SET due_at=datetime('now','-1 minute'),message_body=message_body||' Reply STOP to opt out.' WHERE submission_id=? AND purpose='follow_up' AND sequence_step=1").run(saved.id);
  assert.equal((await f.flush()).sent, 1);
  assert.equal(countFooters(f.sent[1]), 0, 'Legacy queued cadence copy loses its footer at delivery');

  const conversation = f.db.sqlite.prepare('SELECT id FROM lead_conversations WHERE submission_id=?').get(saved.id);
  f.db.sqlite.prepare(`INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by)
    VALUES ('footer-inbound',?,'org-opwp','inbound','quo_sms','footer-correction','actually 3 dogs','recorded',0,'fixture')`).run(conversation.id);
  f.db.sqlite.prepare('UPDATE lead_conversations SET last_inbound_at=CURRENT_TIMESTAMP WHERE id=?').run(conversation.id);
  await recordMetaReply(f.db, saved.id, {providerMessageId: 'footer-correction', from: PHONE, text: 'actually 3 dogs'}, {env: f.env});
  assert.equal((await f.flush()).sent, 1);
  assert.match(f.sent[2], /Thanks for clarifying.*3 dogs/);
  assert.equal(countFooters(f.sent[2]), 0);
  assert.deepEqual(f.sent.map(countFooters), [1, 0, 0]);
  const history = f.db.sqlite.prepare("SELECT body FROM lead_messages WHERE direction='outbound' ORDER BY rowid").all();
  assert.deepEqual(history.map(({body}) => countFooters(body)), [1, 0, 0]);
});

for (const [label, seed] of [
  ['a recurring client with a completed onboarding', db => db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,phone,payload,sng_sync_state,created_at)
    VALUES ('existing-recurring','onboarding','website','synced','(419) 555-0100','{}','succeeded',datetime('now','-60 days'))`).run()],
  ['a previously contacted website lead', db => {
    db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,payload,created_at) VALUES ('existing-lead','partial_quote','website','new','419-555-0100','{}',datetime('now','-60 days'))").run();
    db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,last_outbound_at) VALUES ('existing-thread','existing-lead','org-opwp',datetime('now','-59 days'))").run();
    db.sqlite.prepare(`INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,delivery_status,automated,created_by)
      VALUES ('existing-outbound','existing-thread','org-opwp','outbound','quo_sms','A previous reply.','sent',1,'fixture')`).run();
  }],
  ['an existing client recorded by Sweep & Go', db => db.sqlite.prepare(`INSERT INTO sng_events(id,event_type,phone,payload,received_at)
    VALUES ('existing-service','notification:completed_job_notification','(419) 555-0100','{"phone":"(419) 555-0100"}',datetime('now','-60 days'))`).run()],
  ...['cell_phone', 'cell_phone_number', 'home_phone', 'home_phone_number'].map(key =>
    [`an existing client in recovered service history (${key})`, db => db.sqlite.prepare(`INSERT INTO sng_events(id,event_type,payload,received_at)
      VALUES ('recovered-service','job:completed',?,datetime('now','-60 days'))`).run(JSON.stringify({data: {[key]: '(419) 555-0100'}}))]),
]) {
  test(`a Meta confirmation to ${label} has no footer`, async t => {
    const f = fixture(t);
    seed(f.db);
    await f.intake();
    assert.equal((await f.flush()).sent, 1);
    assert.equal(countFooters(f.sent[0]), 0);
    assert.match(f.sent[0], /Thanks for filling out our Facebook form/);
  });
}

test('only the explicit initial Meta confirmation builder includes a footer', () => {
  assert.equal(countFooters(buildMetaConfirmation(leadDetails)), 1);
  const longInitial = formatMetaSms(`${'x'.repeat(1100)} Reply STOP to opt out.`, {firstMessage: true});
  assert.equal(longInitial.length, 1000);
  assert.equal(countFooters(longInitial), 1);
  assert.match(longInitial, /\n\nReply STOP to opt out$/);
  const correction = nextMetaResponse({lead: leadDetails, text: 'actually 3 dogs', confirmationSent: true});
  assert.match(correction.response, /Thanks for clarifying/);
  const laterMessages = [
    buildMetaConfirmation(leadDetails, {firstMessage: false}),
    correction.response,
    renderPlaybookTemplate('ask_dogs'),
    ...metaFollowUpDrafts('Casey Example').map(({body}) => body),
    formatMetaSms('A later reply.\n\nReply STOP to opt out'),
    formatCustomerSms('Your service reminder. Reply STOP to opt out.'),
    formatCustomerSms('Our holiday service notice. Text STOP to unsubscribe.'),
    buildReviewRequestSms({firstName: 'Casey', tech: 'Example Technician', template: 'standard'}),
    buildReviewRequestSms({firstName: 'Casey', tech: 'Example Technician', template: 'initial-cleanup'}),
  ];
  for (const body of laterMessages) assert.equal(countFooters(body), 0, body);
});

test('customer history arriving after intake removes the footer from a waiting confirmation before delivery', async t => {
  const f = fixture(t), saved = await f.intake();
  assert.equal(countFooters(f.db.sqlite.prepare('SELECT message_body FROM meta_sms_jobs WHERE id=?').get(saved.id).message_body), 1);
  f.db.sqlite.prepare(`INSERT INTO sng_events(id,event_type,phone,payload)
    VALUES ('late-customer-history','client:client_onboarding_recurring','419-555-0100','{"phone":"419-555-0100"}')`).run();
  assert.equal((await f.flush()).sent, 1);
  assert.equal(countFooters(f.sent[0]), 0);
  assert.equal(countFooters(f.db.sqlite.prepare('SELECT message_body FROM meta_sms_jobs WHERE id=?').get(saved.id).message_body), 0);
  assert.equal(countFooters(f.db.sqlite.prepare("SELECT body FROM lead_messages WHERE direction='outbound'").get().body), 0);
});
