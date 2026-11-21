import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {nextPlaybookResponse} from '../lib/lead-playbook.mjs';
import {createPlaybookLink, readPlaybookLink} from '../lib/lead-playbook-links.mjs';
import {processPlaybookInbound, runScheduledPlaybook} from '../lib/lead-playbook-ingest.js';

const bundle = await build({stdin: {contents: "export * from './lib/lead-playbook-service.js';", resolveDir: process.cwd()}, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{name: 'no-real-provider', setup(builder) {
  builder.onResolve({filter: /^\.\/lead-assistant$/}, () => ({path: 'provider', namespace: 'fixture'}));
  builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: "export async function sendLeadMessage(){throw new Error('Real sends forbidden in tests');}", loader: 'js'}));
}}]});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const env = {LEAD_PLAYBOOK_ENABLED: 'true', LEAD_PLAYBOOK_AUTO_SEND_ENABLED: 'true', LEAD_PLAYBOOK_LINK_SECRET: 'fabricated-trigger-test-secret-not-production-123456'};
const emptyCustomerDirectory = async () => ({ok: true, complete: true, rows: []});
const totalChanges = db => Number(db.sqlite.prepare('SELECT total_changes() AS count').get().count);

function fixture() {
  const db = leadTestDatabase(), submissionId = crypto.randomUUID(), conversationId = crypto.randomUUID(), inboundId = crypto.randomUUID();
  const state = {stage: 'confirm_details_sent', expected: 'confirmDetails', details: {dogs: 1, frequency: 'once_a_week', zip: '43528'}};
  const decision = {...nextPlaybookResponse({conversation: {owner: 'backend'}, state, text: 'Yes that is correct.'}), priorState: state};
  assert.equal(decision.templateKey, 'ask_yard');
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,name,phone,payload) VALUES (?,'partial_quote','website','Casey Example','4195550100','{}')").run(submissionId);
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner,automation_mode,last_inbound_at) VALUES (?,?,'org-opwp','backend','approved',CURRENT_TIMESTAMP)").run(conversationId, submissionId);
  db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0 WHERE organization_id='org-opwp'").run();
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES (?,?,'org-opwp','inbound','quo_sms','Yes that is correct.','customer')").run(inboundId, conversationId);
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,state_json,stage,revision) VALUES (?,?,?,'confirm_details_sent',3)").run(conversationId, submissionId, JSON.stringify(state));
  const create = () => api.createPlaybookDraft(db, env, {conversation: {id: conversationId}, lead: {id: submissionId}, inboundMessageId: inboundId, decision});
  return {db, submissionId, conversationId, inboundId, create};
}

test('trigger-inclusive draft creation and automatic claim send one yard question and advance revision 3 once', async () => {
  const f = fixture(), batches = [], batch = f.db.batch;
  f.db.batch = async statements => {const result = await batch(statements); batches.push(result.map(row => row.meta.changes)); return result;};
  const {draft} = await f.create();
  assert.ok(draft);
  assert.equal(batches[0][0], 2, 'the draft insert and its mirror both count in D1 metadata');
  assert.equal(f.db.sqlite.prepare("SELECT revision FROM playbook_airtable_sync WHERE kind='draft' AND record_id=?").get(draft.id).revision, 1);
  let providerCalls = 0;
  const sender = async (_db, _env, _lead, body) => {
    providerCalls++;
    assert.equal(body, draft.body);
    assert.equal(f.db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(draft.id).status, 'sending');
    return {provider_message_id: 'ACfabricated-trigger-approved'};
  };
  const result = await api.sendVerifiedPlaybookDraft(f.db, env, draft.id, {sender, loadCustomerDirectory: emptyCustomerDirectory});
  assert.equal(result.status, 'sent');
  assert.equal(batches[1][0], 2, 'the sending claim and its mirror both count');
  assert.equal(providerCalls, 1);
  const state = f.db.sqlite.prepare('SELECT stage,revision,state_json FROM lead_playbook_state WHERE conversation_id=?').get(f.conversationId);
  assert.equal(state.stage, 'collect_details');
  assert.equal(state.revision, 4);
  assert.equal(JSON.parse(state.state_json).expected, 'yardTier');
  assert.equal((await api.sendVerifiedPlaybookDraft(f.db, env, draft.id, {sender})).status, 'sent');
  await assert.rejects(() => api.actOnPlaybookDraft(f.db, env, draft.id, {action: 'approve'}, 'owner', {sender}), /already reviewed/);
  assert.equal(providerCalls, 1);
});

test('a fresh inbound supersedes an old pending reply and completes the D1-aware playbook once', async () => {
  const f = fixture(), {draft: oldDraft} = await f.create();
  f.db.sqlite.prepare('UPDATE lead_conversations SET last_outbound_at=CURRENT_TIMESTAMP WHERE id=?').run(f.conversationId);
  const configured = {...env, QUO_FROM_NUMBER: '+14195550199'};
  const event = {providerMessageId: 'ACfabricated-fresh-inbound', direction: 'inbound', from: '+14195550100', to: configured.QUO_FROM_NUMBER, text: 'Yes that is correct.', createdAt: new Date().toISOString()};
  let providerCalls = 0;
  const options = {loadCustomerDirectory: emptyCustomerDirectory, sender: async (_db, _env, _lead, body) => {
    providerCalls++;
    assert.match(body, /^About how large is the area/);
    return {provider_message_id: 'ACfabricated-fresh-yard-question'};
  }};
  const result = await processPlaybookInbound(f.db, configured, {conversationId: f.conversationId, submissionId: f.submissionId, event}, options);
  assert.equal(result.delivery.status, 'sent');
  assert.equal(result.draft.template_key, 'ask_yard');
  assert.equal(result.draft.status, 'sent');
  assert.equal(providerCalls, 1);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(oldDraft.id).status, 'superseded');
  assert.equal(f.db.sqlite.prepare('SELECT revision FROM lead_playbook_state WHERE conversation_id=?').get(f.conversationId).revision, 4);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) count FROM lead_messages WHERE provider_message_id='ACfabricated-fresh-inbound'").get().count, 1);
  assert.equal((await processPlaybookInbound(f.db, configured, {conversationId: f.conversationId, submissionId: f.submissionId, event}, options)).duplicate, true);
  assert.equal(providerCalls, 1);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) count FROM lead_reply_drafts').get().count, 2);
});

test('a conditional insert that lost to a newer inbound stays absent even with successful-looking metadata', async () => {
  const f = fixture(), batch = f.db.batch;
  f.db.batch = async statements => {
    f.db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES (?,?,'org-opwp','inbound','quo_sms','Actually two dogs','customer')").run(crypto.randomUUID(), f.conversationId);
    const result = await batch(statements);
    result[0].meta.changes = 2;
    return result;
  };
  const created = await f.create();
  assert.equal(created.draft, null);
  assert.equal(created.superseded, true);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) count FROM lead_reply_drafts').get().count, 0);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) count FROM playbook_airtable_sync WHERE kind='draft'").get().count, 0);
});

test('a claim lost to another reviewer cannot send using aggregate metadata', async () => {
  const f = fixture(), {draft} = await f.create(), batch = f.db.batch;
  f.db.batch = async statements => {
    f.db.sqlite.prepare("UPDATE lead_reply_drafts SET status='sending',send_claim='fabricated-other-reviewer' WHERE id=?").run(draft.id);
    const result = await batch(statements);
    result[0].meta.changes = 2;
    return result;
  };
  let providerCalls = 0;
  await assert.rejects(() => api.actOnPlaybookDraft(f.db, env, draft.id, {action: 'approve'}, 'owner', {sender: async () => {providerCalls++;}}), /another review changed/);
  assert.equal(providerCalls, 0);
  assert.equal(f.db.sqlite.prepare('SELECT send_claim FROM lead_reply_drafts WHERE id=?').get(draft.id).send_claim, 'fabricated-other-reviewer');
});

test('a signed review consumes its matching link and sends once with trigger-inclusive metadata', async () => {
  const f = fixture(), {draft} = await f.create(), now = new Date();
  const token = await createPlaybookLink(f.db, env, draft, now.getTime());
  let providerCalls = 0;
  const sender = async () => {providerCalls++; return {provider_message_id: 'ACfabricated-link-approved'};};
  assert.equal((await api.actOnPlaybookDraft(f.db, env, draft.id, {action: 'approve', token}, 'owner', {sender, now})).status, 'sent');
  assert.equal(Number(f.db.sqlite.prepare('SELECT used_at FROM lead_playbook_links WHERE jti=?').get(token.split('.')[0]).used_at), Math.floor(now.getTime() / 1000));
  await assert.rejects(() => readPlaybookLink(f.db, env, token, now.getTime()), /invalid or expired/);
  await assert.rejects(() => api.actOnPlaybookDraft(f.db, env, draft.id, {action: 'approve', token}, 'owner', {sender, now}), /already reviewed/);
  assert.equal(providerCalls, 1);
});

test('a claim without persisted consumption of its signed link fails closed before the provider', async () => {
  const f = fixture(), {draft} = await f.create(), now = new Date(), batch = f.db.batch;
  const token = await createPlaybookLink(f.db, env, draft, now.getTime());
  f.db.batch = async statements => {
    assert.equal(statements.length, 2);
    const result = await batch(statements.slice(0, 1));
    return [...result, {meta: {changes: 1}}];
  };
  let providerCalls = 0;
  await assert.rejects(() => api.actOnPlaybookDraft(f.db, env, draft.id, {action: 'approve', token}, 'owner', {sender: async () => {providerCalls++;}, now}), /another review changed/);
  assert.equal(providerCalls, 0);
  assert.equal(f.db.sqlite.prepare('SELECT used_at FROM lead_playbook_links WHERE jti=?').get(token.split('.')[0]).used_at, null);
});

test('ownership succeeds when takeover supersedes multiple drafts and their mirrors', async () => {
  const f = fixture(), {draft} = await f.create(), secondId = crypto.randomUUID();
  f.db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,organization_id,intent,confidence,body,policy_version) SELECT ?,conversation_id,submission_id,organization_id,intent,confidence,body,policy_version FROM lead_reply_drafts WHERE id=?").run(secondId, draft.id);
  const before = totalChanges(f.db), now = new Date();
  assert.equal((await api.setPlaybookOwner(f.db, env, f.conversationId, 'craig', {now})).status, 'taken_over');
  assert.equal(totalChanges(f.db) - before, 5, 'one owner write plus two superseded drafts and two mirrors');
  assert.deepEqual(f.db.sqlite.prepare('SELECT status FROM lead_reply_drafts ORDER BY id').all().map(row => row.status), ['superseded', 'superseded']);
  const owner = f.db.sqlite.prepare('SELECT owner,owner_event_id,owner_event_at FROM lead_conversations WHERE id=?').get(f.conversationId);
  assert.equal(owner.owner, 'craig');
  assert.match(owner.owner_event_id, /^manual:/);
  assert.equal(owner.owner_event_at, now.toISOString());
  assert.equal((await api.setPlaybookOwner(f.db, env, f.conversationId, 'backend')).status, 'handed_back');
});

test('ownership readback cannot authorize a rejected owner update', async () => {
  const f = fixture();
  f.db.sqlite.prepare("UPDATE lead_conversations SET owner='sona' WHERE id=?").run(f.conversationId);
  await assert.rejects(() => api.setPlaybookOwner(f.db, env, f.conversationId, 'backend'), /cannot be handed/);
  assert.equal(f.db.sqlite.prepare('SELECT owner FROM lead_conversations WHERE id=?').get(f.conversationId).owner, 'sona');
});

test('a superseded stranded draft remains terminal through automatic, direct review and scheduled paths', async () => {
  const f = fixture(), {draft} = await f.create(), originalState = f.db.sqlite.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=?').get(f.conversationId).state_json;
  const token = await createPlaybookLink(f.db, env, draft);
  f.db.sqlite.prepare("UPDATE lead_reply_drafts SET status='superseded' WHERE id=? AND status='pending'").run(draft.id);
  let providerCalls = 0;
  const sender = async () => {providerCalls++; throw new Error('A superseded draft must never contact a provider');};
  assert.deepEqual(await api.sendVerifiedPlaybookDraft(f.db, env, draft.id, {sender, loadCustomerDirectory: emptyCustomerDirectory}), {automatic: false, status: 'superseded'});
  for (const action of ['approve', 'edit_send']) {
    await assert.rejects(() => api.actOnPlaybookDraft(f.db, env, draft.id, {action, body: draft.body, token}, 'owner', {sender}), /already reviewed/);
  }
  const originalFetch = globalThis.fetch;
  let networkCalls = 0, scheduled;
  globalThis.fetch = async () => {networkCalls++; throw new Error('Scheduled terminal-draft regression must stay local');};
  try { scheduled = await runScheduledPlaybook({...env, DB: f.db}, new Date('2026-11-21T17:00:00Z').getTime()); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(scheduled.intros.drafted, 0);
  assert.equal(providerCalls, 0);
  assert.equal(networkCalls, 0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) count FROM lead_reply_drafts').get().count, 1);
  const persisted = f.db.sqlite.prepare('SELECT status,send_claim,provider_message_id FROM lead_reply_drafts WHERE id=?').get(draft.id);
  assert.equal(persisted.status, 'superseded');
  assert.equal(persisted.send_claim, null);
  assert.equal(persisted.provider_message_id, null);
  assert.equal(f.db.sqlite.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=?').get(f.conversationId).state_json, originalState);
});
