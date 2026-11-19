import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import vm from 'node:vm';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {formatCustomerSms} from '../lib/customer-sms.mjs';
import {nextPlaybookResponse, renderPlaybookTemplate} from '../lib/lead-playbook.mjs';
import {preparePlaybookIntros} from '../lib/lead-playbook-ingest.js';
import {createPlaybookLink, readPlaybookLink, playbookHash} from '../lib/lead-playbook-links.mjs';
import {processPlaybookMirror, queuePlaybookMirrorStatement} from '../lib/lead-playbook-mirror.mjs';
const bundle = await build({stdin: {contents: "export * from './lib/lead-playbook-service.js';", resolveDir: process.cwd()}, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{name: 'fake-provider', setup(builder) { builder.onResolve({filter: /^\.\/lead-assistant$/}, () => ({path: 'provider', namespace: 'fixture'})); builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: "export async function sendLeadMessage(){throw new Error('Real sends forbidden in tests');}", loader: 'js'})); }}]});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const adminBundle = await build({stdin: {contents: "export * from './lib/lead-playbook-admin.js';", resolveDir: process.cwd()}, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{name: 'admin-boundary', setup(builder) {
  builder.onResolve({filter: /^(next\/headers|\.\/(?:admin-auth|cloudflare|db|rate-limit))$/}, args => ({path: args.path, namespace: 'boundary'}));
  builder.onLoad({filter: /.*/, namespace: 'boundary'}, args => ({contents: args.path === 'next/headers' ? 'export const headers=async()=>new Headers();' : args.path === './admin-auth' ? 'export const verifyAdminRequest=async()=>({authorized:globalThis.__playbookBoundary.authorized,email:"owner@example.test"});' : args.path === './cloudflare' ? 'export const getRuntimeEnv=()=>globalThis.__playbookBoundary.env;' : args.path === './db' ? 'export const getDb=()=>globalThis.__playbookBoundary.db;' : 'export const checkRateLimit=async()=>({allowed:true});export const rateLimitResponse=()=>Response.json({}, {status:429});', loader: 'js'}));
}}]});
const admin = await import('data:text/javascript;base64,' + Buffer.from(adminBundle.outputFiles[0].text).toString('base64'));
const noon = new Date('2026-11-19T17:00:00Z');
const env = {LEAD_PLAYBOOK_ENABLED: 'true', LEAD_PLAYBOOK_LINK_SECRET: 'fabricated-test-secret-not-production-123456', LEAD_PLAYBOOK_CRAIG_CELL: '+14195550199'};
async function fixture() {
  const db = leadTestDatabase(), id = crypto.randomUUID(), conversationId = crypto.randomUUID(), inboundId = crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,name,email,phone,payload) VALUES (?,'partial_quote','website','Casey Example','casey@example.test','4195550100','{}')").run(id);
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner,automation_mode,last_inbound_at) VALUES (?,?,'org-opwp','backend','suggest',CURRENT_TIMESTAMP)").run(conversationId, id);
  db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1 WHERE organization_id='org-opwp'").run();
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES (?,?,'org-opwp','inbound','quo_sms','Yes, interested','customer')").run(inboundId, conversationId);
  const state = {stage: 'intro_sent'};
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,state_json,stage) VALUES (?,?,?,'intro_sent')").run(conversationId, id, JSON.stringify(state));
  const slots = {dogs: 1, dogs_phrase: '1 dog', frequency: 'weekly', yard_phrase: 'smaller than 1/8 acre', last_cleaned_phrase: 'about 2 weeks'};
  const decision = {intent: 'confirm_yes', confidence: 1, templateKey: 'confirm_details', body: renderPlaybookTemplate('confirm_details', slots), priorState: state, state: {stage: 'confirm_details_sent'}, slots, reason: 'approved_template'};
  const created = await api.createPlaybookDraft(db, env, {conversation: {id: conversationId}, lead: {id}, inboundMessageId: inboundId, decision});
  return {db, id, conversationId, inboundId, draft: created.draft, decision};
}
test('disabled playbook paths do not read new tables or call providers', async () => {
  const db = {prepare() { throw new Error('Unexpected database access'); }};
  assert.equal((await api.createPlaybookDraft(db, {}, {})).enabled, false);
  assert.equal((await api.listPlaybookWorkspace(db, {})).enabled, false);
  assert.equal((await processPlaybookMirror(db, {})).enabled, false);
  assert.equal((await api.notifyPlaybookDraft(db, {}, 'x', {fetcher() { throw new Error('send'); }})).enabled, false);
  await assert.rejects(() => api.actOnPlaybookDraft(db, {}, 'x', {action: 'approve'}, 'owner'), /disabled/);
});
test('review capabilities bind body and draft, expire in 30 minutes and consume only on POST action', async () => {
  const {db, draft} = await fixture(), start = Date.now();
  const token = await createPlaybookLink(db, env, draft, start);
  assert.equal((await readPlaybookLink(db, env, token, start)).draft_id, draft.id);
  assert.equal((await readPlaybookLink(db, env, token, start)).used_at, null);
  await assert.rejects(() => readPlaybookLink(db, env, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), start), /invalid or expired/);
  await assert.rejects(() => readPlaybookLink(db, env, token, start + 1800 * 1000), /invalid or expired/);
  await api.actOnPlaybookDraft(db, env, draft.id, {action: 'reject', reason: 'Needs more context', token}, 'owner', {now: noon});
  await assert.rejects(() => readPlaybookLink(db, env, token, start), /invalid or expired/);
  await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve', token}, 'owner', {now: noon}), /already reviewed/);
});
test('explicit review sends once using fake sender and updates state and unedited approval statistics', async () => {
  const {db, draft, conversationId} = await fixture(); let sends = 0;
  const sender = async (_db, _env, _lead, body) => { sends++; assert.ok(body.endsWith('\n\nReply STOP to opt out')); return {provider_message_id: 'ACfakeapproved'}; };
  const result = await api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {sender, now: noon});
  assert.equal(result.status, 'sent'); assert.equal(sends, 1);
  assert.equal(db.sqlite.prepare('SELECT stage FROM lead_playbook_state WHERE conversation_id=?').get(conversationId).stage, 'confirm_details_sent');
  assert.equal(db.sqlite.prepare("SELECT approvals FROM lead_playbook_intent_stats WHERE intent='confirm_yes'").get().approvals, 1);
  await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {sender, now: noon})); assert.equal(sends, 1);
});
test('concurrent approval claims cannot duplicate a provider call', async () => {
  const {db, draft} = await fixture(); let sends = 0;
  const sender = async () => { sends++; await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {sender, now: noon})); return {provider_message_id: 'ACconcurrent'}; };
  await api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {sender, now: noon}); assert.equal(sends, 1);
});
test('delivery webhook preceding the provider response preserves sent status and advances state once', async () => {
  const {db, draft, conversationId} = await fixture(); let calls = 0;
  const sender = async () => {
    calls++;
    db.sqlite.prepare("UPDATE lead_reply_drafts SET status='sent',provider_message_id='ACwebhookfirst' WHERE id=?").run(draft.id);
    db.sqlite.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,stage='confirm_details_sent',revision=revision+1 WHERE conversation_id=?").run(draft.state_json, conversationId);
    return {provider_message_id: 'ACwebhookfirst'};
  };
  const result = await api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {sender, now: noon});
  assert.equal(result.status, 'sent'); assert.equal(result.stateConflict, false); assert.equal(calls, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(draft.id).status, 'sent');
  assert.equal(db.sqlite.prepare('SELECT revision FROM lead_playbook_state WHERE conversation_id=?').get(conversationId).revision, 2);
});
test('a confirmed delivered draft cannot be changed to failed after a later provider-path error', async () => {
  const {db, draft} = await fixture();
  const sender = async () => { db.sqlite.prepare("UPDATE lead_reply_drafts SET status='sent',provider_message_id='ACconfirmed' WHERE id=?").run(draft.id); throw new Error('fabricated local post-delivery failure'); };
  await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {sender, now: noon}));
  assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(draft.id).status, 'sent');
});
test('new inbound supersedes pending drafts and blocks stale signed review', async () => {
  const {db, draft, conversationId} = await fixture();
  const token = await createPlaybookLink(db, env, draft);
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES (?,?,'org-opwp','inbound','quo_sms','Actually two dogs','lead')").run(crypto.randomUUID(), conversationId);
  assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(draft.id).status, 'superseded');
  await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve', token}, 'owner', {now: noon}));
});
test('a slow older inbound cannot supersede the newest pending draft or enqueue an orphan mirror', async () => {
  const {db, id, conversationId, inboundId, decision} = await fixture(), newestInbound = crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES (?,?,'org-opwp','inbound','quo_sms','Newest inbound','lead')").run(newestInbound, conversationId);
  const current = await api.createPlaybookDraft(db, env, {conversation: {id: conversationId}, lead: {id}, inboundMessageId: newestInbound, decision});
  assert.ok(current.draft);
  const late = await api.createPlaybookDraft(db, env, {conversation: {id: conversationId}, lead: {id}, inboundMessageId: inboundId, decision});
  assert.equal(late.draft, null); assert.equal(late.superseded, true);
  assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(current.draft.id).status, 'pending');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM playbook_airtable_sync q WHERE q.kind='draft' AND NOT EXISTS(SELECT 1 FROM lead_reply_drafts d WHERE d.id=q.record_id)").get().count, 0);
});
test('explicit takeover and hand-back persist an ownership event watermark in the same update', async () => {
  const {db, draft, conversationId} = await fixture();
  await api.actOnPlaybookDraft(db, env, draft.id, {action: 'take_over'}, 'owner', {now: noon});
  let owner = db.sqlite.prepare('SELECT owner,owner_event_at,owner_event_id,owner_event_priority FROM lead_conversations WHERE id=?').get(conversationId);
  assert.equal(owner.owner, 'craig'); assert.equal(owner.owner_event_at, noon.toISOString()); assert.match(owner.owner_event_id, /^manual:/); assert.equal(owner.owner_event_priority, 3);
  const later = new Date(noon.getTime() + 60000), firstEvent = owner.owner_event_id;
  await api.setPlaybookOwner(db, env, conversationId, 'backend', {now: later});
  owner = db.sqlite.prepare('SELECT owner,owner_event_at,owner_event_id,owner_event_priority FROM lead_conversations WHERE id=?').get(conversationId);
  assert.equal(owner.owner, 'backend'); assert.equal(owner.owner_event_at, later.toISOString()); assert.notEqual(owner.owner_event_id, firstEvent); assert.equal(owner.owner_event_priority, 3);
});
test('Sona, Craig ownership, suppressions, quiet hours and paused settings block sending', async () => {
  for (const mode of ['sona', 'craig', 'suppressed', 'quiet', 'paused']) {
    const {db, draft, conversationId} = await fixture(); let sends = 0;
    if (['sona', 'craig'].includes(mode)) db.sqlite.prepare('UPDATE lead_conversations SET owner=? WHERE id=?').run(mode, conversationId);
    if (mode === 'suppressed') db.sqlite.prepare("INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES ('org-opwp',?,'stop','test','test')").run(await playbookHash('+14195550100'));
    if (mode === 'paused') db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=0 WHERE organization_id='org-opwp'").run();
    await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {sender: async () => { sends++; }, now: mode === 'quiet' ? new Date('2026-11-20T02:00:00Z') : noon}));
    assert.equal(sends, 0, mode);
  }
});
test('edited approval records only redacted learning candidates and counts edits', async () => {
  const {db, draft} = await fixture();
  const canonical = draft.body.replace(/\s*Reply STOP to opt out\s*$/, '').trim();
  await api.actOnPlaybookDraft(db, env, draft.id, {action: 'edit_send', body: 'Hi Casey Example! ' + canonical + ' Your email is casey@example.test.'}, 'owner', {sender: async () => ({provider_message_id: 'ACedited'}), now: noon});
  const row = db.sqlite.prepare("SELECT * FROM playbook_candidates WHERE source='approved_edit'").get();
  assert.ok(row); assert.doesNotMatch(row.answer_redacted, /Casey Example|casey@example.test|4195550100/);
  assert.equal(db.sqlite.prepare("SELECT edits FROM lead_playbook_intent_stats WHERE intent='confirm_yes'").get().edits, 1);
});
test('editing a confirmation cannot skip the form details while advancing its stage', async () => {
  const {db, draft} = await fixture(); let sends = 0;
  await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'edit_send', body: 'Hello, ready to sign up?'}, 'owner', {sender: async () => { sends++; }, now: noon}), /full form-details confirmation/);
  assert.equal(sends, 0); assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(draft.id).status, 'pending');
});
test('candidate review promotes to approved library with automatic sending off and formatted body', async () => {
  const {db} = await fixture(), id = crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO playbook_candidates(id,kind,intent,question_redacted,proposed_template) VALUES (?,'qa','question_contract','Is there a contract?','It is month to month, cancel anytime.')").run(id);
  const result = await api.reviewPlaybookCandidate(db, env, id, {action: 'approve'}, 'owner');
  const row = db.sqlite.prepare('SELECT * FROM lead_answer_library WHERE answer_key=?').get(result.answerKey);
  assert.equal(row.approval_status, 'approved'); assert.equal(row.auto_send_allowed, 0); assert.ok(row.answer_template.endsWith('\n\nReply STOP to opt out'));
  const bad = crypto.randomUUID(); db.sqlite.prepare("INSERT INTO playbook_candidates(id,kind,intent,question_redacted,proposed_template) VALUES (?,'qa','question_contract','Question','$15 upfront')").run(bad);
  await assert.rejects(() => api.reviewPlaybookCandidate(db, env, bad, {action: 'approve'}, 'owner'), /policy violations/);
});
test('closed loop uses D1 revision, Airtable write then read-back and flags a mismatch', async () => {
  for (const mismatch of [false, true]) {
    const {db, draft} = await fixture(), calls = []; let fields;
    await db.prepare('DELETE FROM playbook_airtable_sync').run(); await queuePlaybookMirrorStatement(db, 'draft', draft.id).run();
    const result = await processPlaybookMirror(db, {...env, AIRTABLE_API_KEY: 'fake', AIRTABLE_BASE_ID: 'appFake', AIRTABLE_PLAYBOOK_DRAFTS_TABLE_ID: 'tblDrafts', AIRTABLE_PLAYBOOK_LIBRARY_TABLE_ID: 'tblLibrary'}, 1, {fetcher: async (_url, options) => {
      calls.push(options.method); assert.equal(db.sqlite.prepare('SELECT status FROM playbook_airtable_sync').get().status, 'syncing');
      if (options.method === 'PATCH') { fields = JSON.parse(options.body).records[0].fields; return Response.json({records: [{id: 'recFake'}]}); }
      return Response.json({id: 'recFake', fields: {...fields, ...(mismatch ? {Body: 'provider mismatch'} : {})}});
    }});
    assert.deepEqual(calls, ['PATCH', 'GET']); assert.equal(result.mismatches, mismatch ? 1 : 0);
    assert.equal(db.sqlite.prepare('SELECT status FROM playbook_airtable_sync').get().status, mismatch ? 'mismatch' : 'synced');
  }
});
test('admin APIs require MFA and positive same-origin JSON POST; GET never approves', () => {
  const helper = readFileSync(new URL('../lib/lead-playbook-admin.js', import.meta.url), 'utf8');
  assert.match(helper, /verifyAdminRequest/); assert.match(helper, /request.headers.get\('origin'\) !== new URL\(request.url\).origin/); assert.match(helper, /protectJsonRequest/);
  const route = readFileSync(new URL('../app/api/admin/playbook/drafts/[draftId]/route.js', import.meta.url), 'utf8');
  assert.match(route, /export async function POST/); assert.doesNotMatch(route, /export async function GET/);
});
test('actual admin boundary rejects missing MFA, cross-origin, missing origin and invalid JSON before storage', async () => {
  let reads = 0;
  globalThis.__playbookBoundary = {authorized: false, env, get db() { reads++; throw new Error('Unexpected record access'); }};
  const request = (headers = {}, body = '{}') => new Request('https://opwp.example/api/admin/playbook/', {method: 'POST', headers: {'Content-Type': 'application/json', origin: 'https://opwp.example', ...headers}, body});
  assert.equal((await admin.authorizePlaybookRequest(request(), true)).response.status, 401); assert.equal(reads, 0);
  globalThis.__playbookBoundary.authorized = true;
  for (const headers of [{origin: ''}, {origin: 'https://evil.example'}, {'sec-fetch-site': 'cross-site'}]) assert.equal((await admin.authorizePlaybookRequest(request(headers), true)).response.status, 403);
  assert.equal((await admin.authorizePlaybookRequest(request({}, '{bad'), true)).response.status, 400);
  assert.equal((await admin.authorizePlaybookRequest(request({'Content-Type': 'text/plain'}), true)).response.status, 415);
  assert.equal((await admin.authorizePlaybookRequest(request({}, JSON.stringify({body: 'a'.repeat(6100)})), true)).response.status, 413);
  assert.equal(reads, 0);
  globalThis.__playbookBoundary.env = {};
  assert.equal((await admin.authorizePlaybookRequest(request(), true)).response.status, 503); assert.equal(reads, 0);
});
test('body-hash binding and twelve-hour expiry reject stale reviews without sending', async () => {
  const {db, draft} = await fixture(); const token = await createPlaybookLink(db, env, draft);
  db.sqlite.prepare('UPDATE lead_reply_drafts SET body=? WHERE id=?').run(formatCustomerSms('Changed body'), draft.id);
  await assert.rejects(() => api.listPlaybookWorkspace(db, env, {token}), /changed or is no longer available/);
  db.sqlite.prepare("UPDATE lead_reply_drafts SET expires_at=datetime('now','-13 hours') WHERE id=?").run(draft.id);
  await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, {action: 'approve'}, 'owner', {now: new Date()}));
  assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(draft.id).status, 'expired');
});
test('notification transport is separately gated and deduplicated using a fake provider', async () => {
  const {db, draft} = await fixture(); let calls = 0;
  const fetcher = async (_url, request) => { calls++; const payload = JSON.parse(request.body); assert.equal(payload.to[0], '+14195550199'); assert.ok(payload.content.includes('/admin/playbook/d/')); return Response.json({data: {id: 'ACnotify'}}); };
  assert.equal((await api.notifyPlaybookDraft(db, env, draft.id, {fetcher, now: noon})).enabled, false);
  const configured = {...env, LEAD_PLAYBOOK_NOTIFY_ENABLED: 'true', QUO_API_KEY: 'fake', QUO_FROM_NUMBER: '+14195550188'};
  assert.equal((await api.notifyPlaybookDraft(db, configured, draft.id, {fetcher, now: new Date('2026-11-20T02:00:00Z')})).deferred, true); assert.equal(calls, 0);
  assert.equal((await api.notifyPlaybookDraft(db, configured, draft.id, {fetcher, now: noon})).accepted, true);
  assert.equal((await api.notifyPlaybookDraft(db, configured, draft.id, {fetcher, now: noon})).skipped, true); assert.equal(calls, 1);
});
test('a confirmed same-turn quote can be reviewed while price, state and cleared route approvals block sending', async () => {
  for (const mutation of ['none', 'price', 'state', 'route']) {
    const {db, id, conversationId, inboundId} = await fixture();
    await db.prepare('DELETE FROM lead_reply_drafts').run();
    const state = {stage: 'confirm_details_sent', details_confirmed: false};
    db.sqlite.prepare('UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,stage=?,revision=revision+1 WHERE conversation_id=?').run(JSON.stringify(state), state.stage, conversationId);
    const lead = {dogs: 1, frequency: 'once_a_week', yardTier: 'tiny', lastCleaned: 'two_weeks', address: '[SERVICE ADDRESS]', city: 'Maumee', zip: '43537'};
    const decision = nextPlaybookResponse({conversation: {owner: 'backend'}, lead, state, text: 'Yes', route: {approvedDays: ['Friday'], auditedBy: 'fixture', dayPhrase: 'Friday'}});
    assert.equal(decision.templateKey, 'quote_recurring');
    const workspace = {intake: {...lead}, handoffKey: 'fixture-route-key', routeAudit: {actor: 'fixture', day: 'Friday', handoffKey: 'fixture-route-key'}};
    db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)").run('lead_workspace:org-opwp:' + id, JSON.stringify(workspace));
    decision.slots.route_audit_key = workspace.handoffKey;
    const {draft} = await api.createPlaybookDraft(db, env, {conversation: {id: conversationId}, lead: {id}, inboundMessageId: inboundId, decision: {...decision, priorState: state}});
    let sends = 0;
    const sender = async () => { sends++; return {provider_message_id: 'ACquoted'}; };
    if (mutation === 'state') db.sqlite.prepare('UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,revision=revision+1 WHERE conversation_id=?').run(JSON.stringify({...state, changed: true}), conversationId);
    if (mutation === 'route') db.sqlite.prepare('UPDATE airtable_cockpit_snapshots SET payload=? WHERE snapshot_key=?').run(JSON.stringify({...workspace, handoffKey: 'changed-key'}), 'lead_workspace:org-opwp:' + id);
    const command = mutation === 'price' ? {action: 'edit_send', body: draft.body.replace('$95', '$1')} : {action: 'approve'};
    if (mutation === 'none') assert.equal((await api.actOnPlaybookDraft(db, env, draft.id, command, 'owner', {sender, now: noon})).status, 'sent');
    else await assert.rejects(() => api.actOnPlaybookDraft(db, env, draft.id, command, 'owner', {sender, now: noon}));
    assert.equal(sends, mutation === 'none' ? 1 : 0);
  }
});
function legacyQuoteWorker(onSend) {
  const source = readFileSync(new URL('../lib/quote-follow-up-delivery.js', import.meta.url), 'utf8');
  const parent = source.slice(source.indexOf('async function refreshParent('), source.indexOf('async function fail('));
  const actual = source.slice(source.indexOf('export async function runScheduledQuoteFollowUps(')).replace('export async function', 'async function')
    .replace('const { preparePlaybookIntros } = await import("./lead-playbook-ingest.js");', 'const preparePlaybookIntros = prepareIntro;');
  return vm.runInNewContext(parent + actual + '\nrunScheduledQuoteFollowUps;', {
    console: {log() {}, error() {}},
    prepareIntro: preparePlaybookIntros,
    sendQuoText: onSend,
    createSngPartialLead: async () => { throw new Error('Unexpected SNG write in rollback test'); },
    sendCustomerEmail: async () => { throw new Error('Unexpected email in rollback test'); },
    fail: async () => {},
    transactionalEmailConfig: () => ({configured: false}),
  });
}
function seedLegacyIntro(db, index) {
  const id = 'intro-lead-' + index, conversationId = 'intro-conv-' + index, followUpId = 'intro-follow-' + index;
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES (?,'partial_quote','website','follow_up_pending','Example Lead','4195550100',?)").run(id, JSON.stringify({follow_up_consent: true}));
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner,automation_mode) VALUES (?,?,'org-opwp','backend','suggest')").run(conversationId, id);
  db.sqlite.prepare("INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at) VALUES (?,?,'4195550100','fixture consent','v1',CURRENT_TIMESTAMP,datetime('now','-1 hour'))").run(followUpId, id);
  db.sqlite.prepare("INSERT INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,status) VALUES (?,?,?,'customer_sms','queued')").run('intro-sms-' + index, followUpId, id);
  db.sqlite.prepare("INSERT INTO meta_sms_jobs(id,purpose,trigger_id,submission_id,organization_id,conversation_id,message_body,status) VALUES (?,'confirmation',?,?,'org-opwp',?,'Legacy confirmation','queued')").run('intro-meta-' + index, 'intro-trigger-' + index, id, conversationId);
  return {id, conversationId};
}
test('legacy introduction delegation commits with drafts, survives flag rollback and does not starve jobs beyond worker limits', async () => {
  const db = leadTestDatabase(); db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1 WHERE organization_id='org-opwp'").run();
  for (let i = 0; i < 23; i++) seedLegacyIntro(db, i);
  const loadCustomerDirectory = async () => ({ok: true, complete: true, rows: []});
  const enabled = {...env, DB: db};
  assert.equal((await preparePlaybookIntros(db, enabled, {limit: 10, loadCustomerDirectory})).drafted, 10);
  assert.equal((await preparePlaybookIntros(db, enabled, {limit: 10, loadCustomerDirectory})).drafted, 10);
  assert.equal((await preparePlaybookIntros(db, enabled, {limit: 10, loadCustomerDirectory})).drafted, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM lead_reply_drafts WHERE status='pending'").get().count, 23);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM quote_follow_up_deliveries WHERE status='cancelled' AND error_message LIKE 'playbook_delegated:%'").get().count, 23);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM meta_sms_jobs WHERE status='cancelled' AND block_reason LIKE 'playbook_delegated:%'").get().count, 23);
  const draft = db.sqlite.prepare('SELECT id FROM lead_reply_drafts ORDER BY id LIMIT 1').get(); let calls = 0;
  await api.actOnPlaybookDraft(db, enabled, draft.id, {action: 'approve'}, 'owner', {sender: async () => { calls++; return {provider_message_id: 'ACreviewedintro'}; }, now: noon});
  const legacy = legacyQuoteWorker(async () => { calls++; return 'ACunexpected'; });
  const result = await legacy({...enabled, LEAD_PLAYBOOK_ENABLED: undefined, SMS_PROVIDER: 'quo', QUO_API_KEY: 'fake', QUO_FROM_NUMBER: '+14195550188'}, 30);
  assert.equal(result.attempted, 0); assert.equal(result.sent, 0); assert.equal(calls, 1);
});
test('an inbound draft atomically cancels queued legacy follow-ups before rollback could replay them', async () => {
  const {db, id, conversationId, inboundId, decision} = await fixture();
  await db.prepare('DELETE FROM lead_reply_drafts').run();
  db.sqlite.prepare("INSERT INTO lead_follow_up_jobs(id,submission_id,conversation_id,organization_id,sequence_step,due_at,message_body,status) VALUES ('old-follow',?,?,'org-opwp',1,CURRENT_TIMESTAMP,'Legacy follow-up','queued')").run(id, conversationId);
  db.sqlite.prepare("INSERT INTO meta_sms_jobs(id,purpose,trigger_id,submission_id,organization_id,conversation_id,message_body,status) VALUES ('old-meta','follow_up','old-trigger',?,'org-opwp',?,'Legacy Meta follow-up','blocked')").run(id, conversationId);
  const result = await api.createPlaybookDraft(db, env, {conversation: {id: conversationId}, lead: {id}, inboundMessageId: inboundId, decision});
  assert.ok(result.draft);
  assert.equal(db.sqlite.prepare("SELECT status FROM lead_follow_up_jobs WHERE id='old-follow'").get().status, 'cancelled');
  assert.equal(db.sqlite.prepare("SELECT status FROM meta_sms_jobs WHERE id='old-meta'").get().status, 'cancelled');
});
test('ineligible legacy SMS rows leave the worker queue across limits without drafts, sends or rollback replay', async () => {
  const db = leadTestDatabase(); db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1 WHERE organization_id='org-opwp'").run();
  for (let i = 0; i < 23; i++) seedLegacyIntro(db, i);
  db.sqlite.exec("UPDATE lead_conversations SET owner='sona'; DELETE FROM meta_sms_jobs");
  let calls = 0;
  const worker = legacyQuoteWorker(async () => { calls++; return 'ACunexpected'; });
  const configured = {...env, DB: db, SMS_PROVIDER: 'quo', QUO_API_KEY: 'fake', QUO_FROM_NUMBER: '+14195550188'};
  let cancelled = 0;
  for (const expected of [10, 10, 3]) {
    const result = await worker(configured, 10);
    assert.equal(result.attempted, expected); assert.equal(result.sent, 0);
    cancelled += expected;
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM quote_follow_up_deliveries WHERE status='cancelled' AND error_message='playbook_review_required'").get().count, cancelled);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM quote_follow_ups WHERE status='sent'").get().count, cancelled);
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM lead_reply_drafts').get().count, 0);
  const afterRollback = await worker({...configured, LEAD_PLAYBOOK_ENABLED: undefined}, 10);
  assert.equal(afterRollback.attempted, 0); assert.equal(afterRollback.sent, 0); assert.equal(calls, 0);
});
