import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {recordQuoDelivery} from '../lib/meta-lead-workflow.mjs';
import {recordWinbackDelivery, reconcileWinbackDeliveryReceipts} from '../lib/winback-replies.mjs';
import {winbackHash} from '../lib/winback-policy.mjs';

const phone = '+14192620424';
const at = new Date('2026-11-23T20:00:00.000Z');
const event = (id, type = 'message.failed') => ({type, data: {object: {id, direction: 'outgoing'}}});

async function fixture() {
  const db = leadTestDatabase();
  db.sqlite.exec(readFileSync(new URL('../schema-proposals/0072_win_back_campaign.sql', import.meta.url), 'utf8'));
  for (const [id, org] of [['own', 'org-opwp'], ['foreign', 'org-other']]) db.sqlite.prepare('INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES (?,?,?,\'{}\',?)').run(id, org, 'Fabricated receipt fixture', 'a'.repeat(64));
  const phoneHash = await winbackHash(phone);
  const recipient = (id, campaign = 'own', status = 'queued') => db.sqlite.prepare('INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,version,batch,card_variant,status) VALUES (?,?,?,?,\'V1\',1,\'A\',?)').run(id, campaign, phoneHash, phone, status);
  const delivery = (id, recipientId, status, providerId = null) => db.sqlite.prepare('INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,provider_message_id,message_body,attempted_at) VALUES (?,?,\'initial\',?,?,?,\'Fabricated receipt fixture\',?)').run(id, recipientId, id, status, providerId, at.toISOString());
  return {db, recipient, delivery, phoneHash};
}

test('a failure received before the send HTTP response is reconciled after the accepted ID is persisted', async () => {
  const {db, recipient, delivery, phoneHash} = await fixture();
  recipient('opening'); delivery('opening-delivery', 'opening', 'sending');
  const failure = event('ACearly-failure-fixture');
  await recordQuoDelivery(db, failure);
  assert.equal((await recordWinbackDelivery(db, failure, {now: at})).handled, false);
  assert.deepEqual(await reconcileWinbackDeliveryReceipts(db, {now: at}), {examined: 0, reconciled: 0});
  // Simulated provider acceptance, no external request or actual message.
  db.sqlite.prepare('UPDATE winback_deliveries SET status=\'sent\',provider_message_id=? WHERE id=\'opening-delivery\'').run(failure.data.object.id);
  db.sqlite.prepare('UPDATE winback_recipients SET status=\'sent\',provider_message_id=?,sent_at=? WHERE id=\'opening\'').run(failure.data.object.id, at.toISOString());
  const result = await reconcileWinbackDeliveryReceipts(db, {now: at});
  assert.deepEqual(result, {examined: 1, reconciled: 1});
  const sent = db.sqlite.prepare('SELECT status,provider_message_id FROM winback_deliveries WHERE id=\'opening-delivery\'').get();
  assert.equal(sent.status, 'failed'); assert.equal(sent.provider_message_id, failure.data.object.id);
  const contact = db.sqlite.prepare('SELECT status,sent_at,provider_message_id FROM winback_recipients WHERE id=\'opening\'').get();
  assert.equal(contact.status, 'failed'); assert.equal(contact.sent_at, at.toISOString()); assert.equal(contact.provider_message_id, failure.data.object.id);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_suppressions WHERE organization_id=\'org-opwp\' AND phone_hash=?').get(phoneHash).n, 1);
  const outbox = db.sqlite.prepare('SELECT outcome,do_not_text FROM winback_airtable_outbox WHERE id=?').get(`receipt:${failure.data.object.id}`);
  assert.equal(outbox.outcome, 'Failed'); assert.equal(outbox.do_not_text, 1);
  db.sqlite.close();
});

test('reconciliation is idempotent and never rewrites other-org work or cancels accepted history', async () => {
  const {db, recipient, delivery, phoneHash} = await fixture();
  recipient('failed-opening'); delivery('failed-opening-delivery', 'failed-opening', 'sent', 'ACowned-failure-fixture');
  recipient('foreign-opening', 'foreign'); delivery('foreign-opening-delivery', 'foreign-opening', 'reserved');
  // One recipient per phone per campaign, as the actual schema requires.
  for (const [campaign, id, state, provider] of [['own-pending','pending','reserved',null], ['own-accepted','accepted','sent','ACaccepted-history-fixture'], ['own-unknown','unknown','unknown','ACunknown-history-fixture']]) {
    db.sqlite.prepare('INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES (?,\'org-opwp\',\'Fabricated fixture\',\'{}\',?)').run(campaign, 'a'.repeat(64));
    recipient(id, campaign, state === 'reserved' ? 'queued' : 'sent'); delivery(`${id}-delivery`, id, state, provider);
  }
  await recordQuoDelivery(db, event('ACowned-failure-fixture'));
  db.sqlite.prepare('INSERT INTO quo_delivery_receipts(provider_message_id,organization_id,status) VALUES (\'ACforeign-failure-fixture\',\'org-other\',\'failed\')').run();
  db.sqlite.prepare('UPDATE winback_deliveries SET status=\'sent\',provider_message_id=\'ACforeign-failure-fixture\' WHERE id=\'foreign-opening-delivery\'').run();
  assert.equal((await reconcileWinbackDeliveryReceipts(db, {now: at})).reconciled, 1);
  assert.deepEqual(await reconcileWinbackDeliveryReceipts(db, {now: at}), {examined: 0, reconciled: 0});
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM winback_airtable_outbox').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_suppressions WHERE organization_id=\'org-opwp\' AND phone_hash=?').get(phoneHash).n, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_deliveries WHERE id=\'pending-delivery\'').get().status, 'cancelled');
  assert.deepEqual({...db.sqlite.prepare('SELECT status,provider_message_id FROM winback_deliveries WHERE id=\'accepted-delivery\'').get()}, {status:'sent',provider_message_id:'ACaccepted-history-fixture'});
  assert.deepEqual({...db.sqlite.prepare('SELECT status,provider_message_id FROM winback_deliveries WHERE id=\'unknown-delivery\'').get()}, {status:'unknown',provider_message_id:'ACunknown-history-fixture'});
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients WHERE id=\'foreign-opening\'').get().status, 'queued');
  assert.deepEqual({...db.sqlite.prepare('SELECT status,provider_message_id FROM winback_deliveries WHERE id=\'foreign-opening-delivery\'').get()}, {status:'sent',provider_message_id:'ACforeign-failure-fixture'});
  db.sqlite.close();
});

test('a late delivered receipt cannot revive failed or suppressed campaign work', async () => {
  const {db, recipient, delivery, phoneHash} = await fixture();
  recipient('late-delivered'); delivery('late-delivered-delivery', 'late-delivered', 'sent', 'AClate-receipt-fixture');
  await recordQuoDelivery(db, event('AClate-receipt-fixture'));
  await reconcileWinbackDeliveryReceipts(db, {now: at});
  const delivered = event('AClate-receipt-fixture', 'message.delivered');
  await recordQuoDelivery(db, delivered);
  await recordWinbackDelivery(db, delivered, {now: at});
  assert.equal((await reconcileWinbackDeliveryReceipts(db, {now: at})).reconciled, 0);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_deliveries WHERE id=\'late-delivered-delivery\'').get().status, 'failed');
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients WHERE id=\'late-delivered\'').get().status, 'failed');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_suppressions WHERE organization_id=\'org-opwp\' AND phone_hash=?').get(phoneHash).n, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM winback_airtable_outbox WHERE do_not_text=1').get().n, 1);
  db.sqlite.close();
});
