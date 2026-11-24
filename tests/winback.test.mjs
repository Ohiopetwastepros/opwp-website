import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { assignWinbackVariants, parseWinbackCsv, planWinbackImport, renderWinbackMessage, validateWinbackCopy, winbackHash, winbackWindow, winbackReport } from '../lib/winback-policy.mjs';
import { importWinbackCampaign, winbackRecipients, flushWinbackAirtable, reconcileWinbackConversions, reconcileMissingWinbackSentOutbox } from '../lib/winback-store.mjs';
import { checkWinbackEligibility, recoverWinbackDeliveries, runWinbackBatch } from '../lib/winback-runner.mjs';
import { nextWinbackResponse, recordWinbackReply, recordWinbackDelivery, applyWinbackOptOut } from '../lib/winback-replies.mjs';
import { buildWinbackDryRun, winbackDryRunMarkdown } from '../lib/winback-dry-run.mjs';
import { createWinbackProviders } from '../lib/winback-providers.mjs';
import { nextPlaybookResponse } from '../lib/lead-playbook.mjs';
import { processWinbackReplies } from '../lib/winback-reply-delivery.mjs';
import { createAirtableContactFixture } from './helpers/airtable-text-safety-fixture.mjs';

// All input in these tests is fabricated. These templates are deliberately
// labeled fixture text and never stand in for missing approved campaign copy.
const CRAIG = '+14192620424';
const fixtureRows = [
  { first_name: 'Sample', phone: CRAIG, version: 'V1', batch: '1', flag: 'ok' },
  { first_name: 'Example', phone: '+14195550101', version: 'V2', batch: '1', flag: 'ok' },
];
const noon = new Date('2026-11-23T17:00:00Z');
async function fixtureCopy() {
  const templates = Object.fromEntries(['V1','V2'].map(v => [v, { body: `{{greeting}} This is a fabricated ${v} campaign test, never production copy.\n\nReply STOP to opt out` }]));
  for (const value of Object.values(templates)) value.sha256 = await winbackHash(value.body);
  return { approved: true, approvedBy: 'Fixture reviewer', evidence: 'Isolated local simulation only', templates };
}
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const generated = path.resolve(process.cwd(), 'tmp/test-migrations');
  for (const name of readdirSync(generated).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join(generated, name), 'utf8'));
  sqlite.exec(readFileSync(new URL('../schema-proposals/0072_win_back_campaign.sql', import.meta.url), 'utf8'));
  const wrap = (sql, values = []) => ({ bind: (...args) => wrap(sql, args), first: async () => sqlite.prepare(sql).get(...values) || null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }), execute: () => { const s = sqlite.prepare(sql); return s.columns().length ? { results: s.all(...values) } : { meta: { changes: Number(s.run(...values).changes) } }; } });
  return { sqlite, prepare: sql => wrap(sql), batch: async statements => { sqlite.exec('BEGIN'); try { const result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
async function setup(rows = fixtureRows) {
  const db = database(), copy = await fixtureCopy(), planned = planWinbackImport(rows);
  await importWinbackCampaign(db, { id: 'fixture-campaign', name: 'Fabricated simulation', sourceSha256: await winbackHash('fabricated CSV, never real campaign'), copy, recipients: planned.recipients, random: () => 0.4 });
  return { db, copy, rows: await winbackRecipients(db, 'fixture-campaign') };
}
function enable(db) { db.sqlite.exec("UPDATE winback_settings SET enabled=1,kill_switch=0; UPDATE winback_campaigns SET enabled=1,kill_switch=0,approved_by='Fixture reviewer',approval_evidence='Local only';"); }
function environment(db) { return { DB: db, WINBACK_ENABLED: 'true', WINBACK_SEND_ENABLED: 'true', WINBACK_KILL_SWITCH: 'false' }; }
function markContacted(db, row, at = new Date(noon.getTime() - 60000)) {
  const providerId = `ACfixturecontacted${row.id}`;
  db.sqlite.prepare(`INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body,provider_message_id,attempted_at) VALUES(?,?,'initial','initial','sent','Fabricated sent opening',?,?)`).run(`contacted:${row.id}`, row.id, providerId, at.toISOString());
  db.sqlite.prepare(`UPDATE winback_recipients SET status='sent',provider_message_id=?,sent_at=?,attempted_at=? WHERE id=?`).run(providerId, at.toISOString(), at.toISOString(), row.id);
}
function linkSource(db,row,{id='source-'+row.id,org='org-opwp',stage='contacted',convertedAt=null,lifecycle=null,phone=row.phone,email='fixture@example.test'}={}) {
  db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,phone,email,payload,lifecycle_stage) VALUES(?,'question','winback','new',?,?,'{}',?)`).run(id,phone,email,lifecycle);
  db.sqlite.prepare(`INSERT INTO growth_leads(submission_id,organization_id,stage,converted_at,updated_by) VALUES(?,?,?,?,'fixture')`).run(id,org,stage,convertedAt);
  db.sqlite.prepare(`INSERT INTO lead_conversations(id,submission_id,organization_id,automation_mode,owner) VALUES(?,?,?,'suggest','backend')`).run('conversation-'+id,id,org);
  db.sqlite.prepare('UPDATE winback_recipients SET submission_id=? WHERE id=?').run(id,row.id);
  return id;
}
function providers(overrides = {}) {
  return { airtable: async () => ({ matches: [], doNotText: false, active: false, paused: false, seasonal: false }), sng: async () => ({ active: false, paused: false }), quo: async () => ({ optedOut: false, recentOutbound: false, firstMessage: true }), send: async () => ({ id: 'ACfixture' }), ...overrides };
}

test('winback requires external byte-pinned approval and renders both fixture versions for Craig exactly', async () => {
  const copy = await fixtureCopy();
  await assert.rejects(validateWinbackCopy(null), /Approved private/);
  for (const version of ['V1','V2']) {
    const body = renderWinbackMessage({ first_name: 'Craig', phone: CRAIG, version }, copy);
    assert.equal(body, `Hi Craig, This is a fabricated ${version} campaign test, never production copy.\n\nReply STOP to opt out`);
    assert.equal(renderWinbackMessage({ first_name: 'Craig', phone: CRAIG, version }, copy, { firstMessage: false }), body.replace('\n\nReply STOP to opt out', ''));
  }
  const changed = structuredClone(copy); changed.templates.V1.body += '.';
  await assert.rejects(validateWinbackCopy(changed));
  for (const bad of ['this afternoon', 'by 3', 'before 3', 'around 3:30', '3 pm', '\u2013', '\u2014', '$15 off']) {
    const unsafe = await fixtureCopy(); unsafe.templates.V1.body = `{{greeting}} ${bad}.\n\nReply STOP to opt out`; unsafe.templates.V1.sha256 = await winbackHash(unsafe.templates.V1.body);
    await assert.rejects(validateWinbackCopy(unsafe), /Unsafe/);
  }
});

test('winback supports the original First placeholder without changing approved prose bytes', async () => {
  const copy = await fixtureCopy();
  for (const version of ['V1','V2']) {
    const original = `Hi [First], This is fabricated ${version} prose, retained verbatim.\n\nReply STOP to opt out`;
    copy.templates[version] = { body: original, sha256: await winbackHash(original) };
  }
  await validateWinbackCopy(copy);
  for (const version of ['V1','V2']) {
    assert.equal(renderWinbackMessage({first_name:'Craig',version},copy),copy.templates[version].body.replace('[First]','Craig'));
    assert.equal(renderWinbackMessage({first_name:'',version},copy),copy.templates[version].body.replace('[First]','there'));
    assert.equal(renderWinbackMessage({first_name:'Example',version,greeting:'Hi Example and Sample,'},copy),copy.templates[version].body.replace('Hi [First],','Hi Example and Sample,'));
  }
});

test('winback importer parses quoted CSV, holds review by default, honors private exclusions and nameless cards', () => {
  const parsed = parseWinbackCsv('first_name,phone,version,batch,flag\r\n"Sam,ple",4192620424,V1,1,ok\r\n');
  assert.equal(parsed[0].first_name, 'Sam,ple');
  assert.throws(() => parseWinbackCsv('a,b\n"unterminated,x'));
  const rows = [...fixtureRows, { ...fixtureRows[0], phone: '+14195550102', flag: 'review' }, { ...fixtureRows[0], phone: '+14195550103', first_name: '' }];
  const held = planWinbackImport(rows, { review: { enabled: true, includedPhones: ['+14195550102'] } });
  assert.equal(held.skipped[0].reason, 'review_held');
  const approved = planWinbackImport(rows, { review: { enabled: true, approved: true, approvedBy: 'Fixture', evidence: 'local', includedPhones: ['+14195550102'], excludedPhones: [CRAIG], greetings: { '+14195550102': 'Hi Example and Sample,' } } });
  assert.equal(approved.skipped[0].reason, 'private_exclusion');
  assert.equal(approved.recipients.find(r => r.phone.endsWith('0102')).greeting, 'Hi Example and Sample,');
  assert.equal(approved.recipients.find(r => r.phone.endsWith('0103')).card_eligible, false);
});

test('winback randomization is 50/50 within each version and batch, persists across idempotent import', async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ first_name: 'Fixture', phone: `+1419555${String(2000 + i)}`, version: i % 2 ? 'V1' : 'V2', batch: i < 20 ? 1 : 2, card_eligible: true }));
  const assigned = assignWinbackVariants(rows);
  for (const batch of [1,2]) for (const version of ['V1','V2']) assert.equal(assigned.filter(r => r.batch === batch && r.version === version && r.card_variant === 'A').length, 5);
  const { db, copy, rows: saved } = await setup();
  assert.equal((await importWinbackCampaign(db, { id: 'fixture-campaign', name: 'Fabricated simulation', sourceSha256: await winbackHash('fabricated CSV, never real campaign'), copy, recipients: planWinbackImport(fixtureRows).recipients })).existing, true);
  assert.deepEqual((await winbackRecipients(db, 'fixture-campaign')).map(r => r.card_variant), saved.map(r => r.card_variant));
});

test('winback odd version strata stay balanced within one recipient and total batch remains exactly 50/50', () => {
  const rows = Array.from({length:8},(_,i)=>({batch:1,version:i<3?'V1':'V2',first_name:'Fixture',phone:`+1419555${2000+i}`,card_eligible:true}));
  for (const value of [0.1,0.9]) {
    const assigned=assignWinbackVariants(rows,()=>value);
    assert.equal(assigned.filter(row=>row.card_variant==='A').length,4);
    for(const version of ['V1','V2']) assert.ok(Math.abs(assigned.filter(row=>row.version===version&&row.card_variant==='A').length-assigned.filter(row=>row.version===version&&row.card_variant==='B').length)<=1);
  }
});

test('winback window enforces ET boundaries, weekends and Thanksgiving', () => {
  for (const time of ['2026-11-23T15:59:00Z','2026-11-23T23:00:00Z','2026-11-26T17:00:00Z','2026-11-28T17:00:00Z']) assert.equal(winbackWindow(new Date(time)).allowed, false, time);
  for (const time of ['2026-11-23T16:00:00Z','2026-11-23T22:59:00Z','2026-07-13T15:00:00Z']) assert.equal(winbackWindow(new Date(time)).allowed, true, time);
});

test('winback defaults OFF in environment and DB, and no provider is touched', async () => {
  const { db } = await setup(); let touched = false;
  const spy = providers({ airtable: async () => { touched = true; throw Error(); }, send: async () => { throw Error('Never call transport'); } });
  assert.equal((await runWinbackBatch({ DB: db }, { campaignId: 'fixture-campaign', providers: spy })).enabled, false);
  assert.equal((await runWinbackBatch(environment(db), { campaignId: 'fixture-campaign', providers: spy })).held, 'database_disabled');
  assert.equal(touched, false);
});

test('winback skips Do Not Text and an Active Sweep&Go client at send time', async () => {
  const { db, rows } = await setup();
  const blocked = await checkWinbackEligibility(db, providers({ airtable: async () => ({ matches: [], doNotText: true }) }), rows[0], noon);
  assert.deepEqual(blocked.reasons, ['airtable_do_not_text']);
  const active = await checkWinbackEligibility(db, providers({ sng: async () => ({ active: true, paused: false }) }), rows[1], noon);
  assert.deepEqual(active.reasons, ['sng_active_customer']);
  const missing = await checkWinbackEligibility(db, providers({ quo: async () => { throw Object.assign(Error(), { code: 'quo_optout_authority_unavailable' }); } }), rows[0], noon);
  assert.deepEqual(missing.reasons, ['quo_optout_authority_unavailable']);
});

test('winback rechecks providers after claim and a new DNT prevents delivery', async () => {
  const { db } = await setup([fixtureRows[0]]); enable(db); let checks = 0, sends = 0;
  const result = await runWinbackBatch(environment(db), { campaignId: 'fixture-campaign', clock: () => noon, providers: providers({ airtable: async () => ({ matches: [], doNotText: ++checks > 1 }), send: async () => { sends++; return { id: 'ACshouldnever' }; } }) });
  assert.equal(sends, 0); assert.equal(result.skipped, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients').get().status, 'opted_out');
});

test('winback concurrent runners share the atomic claim and cannot send the same number twice', async () => {
  const { db } = await setup([fixtureRows[0]]); enable(db); let sends = 0;
  const env = environment(db), transport = providers({ send: async () => { sends++; return { id: 'ACconcurrentfixture' }; } });
  await Promise.all([runWinbackBatch(env, { campaignId: 'fixture-campaign', providers: transport, clock: () => noon }), runWinbackBatch(env, { campaignId: 'fixture-campaign', providers: transport, clock: () => noon })]);
  assert.equal(sends, 1); assert.equal(db.sqlite.prepare('SELECT count(*) n FROM winback_deliveries').get().n, 1);
});

test('winback unavailable provider authority holds queued work without consuming the batch and can resume', async () => {
  const { db } = await setup([fixtureRows[0]]); enable(db); const env = environment(db);
  const held = await runWinbackBatch(env, { campaignId: 'fixture-campaign', clock: () => noon, providers: providers({ quo: async () => { throw Object.assign(Error(), { code: 'quo_optout_authority_unavailable' }); } }) });
  assert.equal(held.held, 'quo_optout_authority_unavailable'); assert.equal(db.sqlite.prepare('SELECT status,attempted_at FROM winback_recipients').get().status, 'queued');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM winback_deliveries').get().n, 0);
  const resumed = await runWinbackBatch(env, { campaignId: 'fixture-campaign', clock: () => noon, providers: providers() }); assert.equal(resumed.sent, 1);
});

test('winback permits only one batch per ET day even after the chosen batch finishes', async () => {
  const { db } = await setup([fixtureRows[0], { ...fixtureRows[1], batch: '2' }]); enable(db); let time = noon.getTime(), sends = 0;
  const env = environment(db), transport = providers({ send: async () => ({ id: `ACfixture${++sends}` }) });
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', limit: 2, providers: transport, clock: () => new Date(time), sleep: async ms => { time += ms; } });
  assert.equal(sends, 1);
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', providers: transport, clock: () => new Date(time + 60000) }); assert.equal(sends, 1);
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', providers: transport, clock: () => new Date('2026-11-24T17:00:00Z') }); assert.equal(sends, 2);
});

test('winback all-skipped batch still locks its ET day and batch two waits until the next day', async () => {
  const third = { first_name: 'Fabricated', phone: '+14195550112', version: 'V1', batch: '2', flag: 'ok' };
  const { db } = await setup([...fixtureRows, third]); enable(db); let time = noon.getTime(), sends = 0;
  const env = environment(db), transport = providers({ airtable: async phone => ({ matches: [], doNotText: phone !== third.phone }), send: async () => ({ id: `ACfixture${++sends}` }) });
  const skipped = await runWinbackBatch(env, { campaignId: 'fixture-campaign', limit: 3, providers: transport, clock: () => new Date(time), sleep: async ms => { time += ms; } });
  assert.equal(skipped.skipped, 2); assert.equal(sends, 0);
  const day = db.sqlite.prepare('SELECT * FROM winback_days').get(); assert.equal(day.batch, 1); assert.equal(day.attempts, 0);
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', limit: 3, providers: transport, clock: () => new Date(time), sleep: async ms => { time += ms; } });
  assert.equal(sends, 0); assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients WHERE batch=2').get().status, 'queued');
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', providers: transport, clock: () => new Date('2026-11-24T17:00:00Z') });
  assert.equal(sends, 1); assert.equal(db.sqlite.prepare("SELECT batch FROM winback_days WHERE local_date='2026-11-24'").get().batch, 2);
});

test('winback DB kill switch stops a batch mid-run, never bursts, and resume cannot double send', async () => {
  const { db } = await setup(); enable(db); let time = noon.getTime(), sends = 0;
  const env = environment(db), transport = providers({ send: async () => { sends++; db.sqlite.exec('UPDATE winback_settings SET kill_switch=1'); return { id: `ACfixture${sends}` }; } });
  const result = await runWinbackBatch(env, { campaignId: 'fixture-campaign', limit: 2, providers: transport, clock: () => new Date(time), sleep: async ms => { assert.ok(ms >= 15000); time += ms; } });
  assert.equal(sends, 1); assert.equal(result.held, 'database_disabled');
  enable(db);
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', limit: 2, providers: providers({ send: async () => { sends++; return { id: `ACfixture${sends}` }; } }), clock: () => new Date(time), sleep: async ms => { time += ms; } });
  assert.equal(sends, 2);
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', limit: 2, providers: transport, clock: () => new Date(time) });
  assert.equal(sends, 2);
});

test('winback ambiguous delivery is held without retry and interrupted claims recover after 15 minutes', async () => {
  const { db } = await setup([fixtureRows[0]]); enable(db); let sends = 0;
  const env = environment(db), transport = providers({ send: async () => { sends++; throw Error('Connection lost'); } });
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', providers: transport, clock: () => noon });
  await runWinbackBatch(env, { campaignId: 'fixture-campaign', providers: transport, clock: () => new Date(noon.getTime() + 60000) });
  assert.equal(sends, 1); assert.equal(db.sqlite.prepare('SELECT status FROM winback_deliveries').get().status, 'unknown');
  db.sqlite.exec("UPDATE winback_deliveries SET status='sending',attempted_at='2026-11-23T16:00:00.000Z'; UPDATE winback_recipients SET status='queued'");
  await recoverWinbackDeliveries(db, noon);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients').get().status, 'failed');
});

test('winback interrupted recovery and recipient reads leave a foreign campaign untouched', async () => {
  const {db,rows}=await setup([fixtureRows[0]]),own=rows[0],stale='2026-11-23T16:00:00.000Z';
  db.sqlite.prepare(`INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES('foreign-recovery','org-other','Fabricated foreign fixture','{}',?)`).run('a'.repeat(64));
  db.sqlite.prepare(`INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,version,batch,card_variant) VALUES('foreign-recovery-recipient','foreign-recovery',?,?,'V1',1,'A')`).run(own.phone_hash,own.phone);
  for(const id of [own.id,'foreign-recovery-recipient'])db.sqlite.prepare(`INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body,attempted_at) VALUES(?,?,'initial','initial','sending','Fabricated interrupted message',?)`).run(`recover:${id}`,id,stale);
  const beforeRecipient=db.sqlite.prepare("SELECT * FROM winback_recipients WHERE id='foreign-recovery-recipient'").get(),beforeDelivery=db.sqlite.prepare("SELECT * FROM winback_deliveries WHERE recipient_id='foreign-recovery-recipient'").get();
  await recoverWinbackDeliveries(db,noon);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients WHERE id=?').get(own.id).status,'failed');
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM winback_recipients WHERE id='foreign-recovery-recipient'").get(),beforeRecipient);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM winback_deliveries WHERE recipient_id='foreign-recovery-recipient'").get(),beforeDelivery);
  assert.deepEqual(await winbackRecipients(db,'foreign-recovery'),[]);
});

test('winback shares Meta response function with campaign context, hands restarts and pushback to Craig, and no reply footer', () => {
  const recipient = { campaign_id: 'fixture-campaign', version: 'V2', batch: 1, card_variant: 'A' };
  let seen;
  const price = nextWinbackResponse({ recipient, text: 'how much for 2 dogs weekly?', responder: args => { seen = args; return { state: args.state, response: 'Fixture shared answer.\n\nReply STOP to opt out', handoff: false }; } });
  assert.equal(seen.lead.campaign.version, 'V2'); assert.equal(price.response, 'Fixture shared answer.'); assert.equal(price.outcome, 'quote_request');
  for (const [text, outcome] of [['STOP','opted_out'],['we moved','moved'],["yes I'd like to start back up",'restart_interest'],['too expensive','price_pushback']]) {
    const result = nextWinbackResponse({ recipient, text }); assert.equal(result.outcome, outcome); assert.equal(result.handoff, true); assert.equal(result.response, '');
  }
});

test('winback price simulation invokes the actual shared live Meta FAQ playbook and never adds an opt-out footer', () => {
  const recipient = { campaign_id: 'fixture-campaign', version: 'V1', batch: 1, card_variant: 'A' };
  const lead = { name: 'Craig', number_of_dogs: 2, zip: '43551', clean_up_frequency: 'Weekly' }, text = 'how much for 2 dogs weekly?';
  const result = nextWinbackResponse({ recipient, lead, text });
  assert.equal(result.response, nextPlaybookResponse({ conversation: { owner: 'backend' }, lead: { ...lead, campaign: result.campaign }, state: { campaign: result.campaign }, text }).body);
  assert.equal(result.outcome, 'quote_request'); assert.ok(result.response.length > 0); assert.equal(result.response.includes('Reply STOP'), false);
});

test('winback uses the same approved checks-yes and cash-no FAQ answer as Meta', () => {
  const recipient = { campaign_id: 'fixture-campaign', version: 'V1', batch: 1, card_variant: 'B' };
  for (const text of ['Do you take checks?', 'Can I pay cash?']) {
    const result = nextWinbackResponse({ recipient, text });
    assert.equal(result.response, nextPlaybookResponse({ conversation: { owner: 'backend' }, lead: { campaign: result.campaign }, state: { campaign: result.campaign }, text }).body);
    assert.match(result.response, /checks?/i); assert.match(result.response, /(?:no|not|don.t).{0,20}cash|cash.{0,20}(?:no|not)/i); assert.equal(result.response.includes('Reply STOP'), false);
  }
});

test('winback concurrent duplicate inbound events claim once and increment unread once', async () => {
  const { db, rows } = await setup([fixtureRows[1]]); let notices = 0;
  markContacted(db, rows[0]);
  const event = { from: rows[0].phone, providerMessageId: 'ACconcurrentinbound', text: "yes I'd like to start back up", direction: 'inbound' };
  await Promise.all([recordWinbackReply(db, {}, event, { now: noon, notifyOwner: async () => { notices++; } }), recordWinbackReply(db, {}, event, { now: noon, notifyOwner: async () => { notices++; } })]);
  assert.equal(notices, 1); assert.equal(db.sqlite.prepare('SELECT unread_count FROM lead_conversations').get().unread_count, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM winback_replies').get().n, 1);
});

test('winback reply drafts require separate auto-reply and conversation approval, recheck DNT after claim', async () => {
  const { db, rows } = await setup([fixtureRows[0]]); enable(db);
  markContacted(db, rows[0]);
  await recordWinbackReply(db, {}, { from: rows[0].phone, providerMessageId: 'ACfixturePRICE', text: 'how much for 2 dogs weekly?', direction: 'inbound' }, { now: noon });
  assert.equal(db.sqlite.prepare("SELECT status FROM winback_deliveries WHERE purpose='reply'").get().status, 'draft');
  const env = { ...environment(db), WINBACK_AUTOREPLY_ENABLED: 'true' }; let sends = 0, checks = 0;
  const transport = providers({ airtable: async () => ({ matches: [], doNotText: ++checks > 1 }), send: async () => { sends++; return { id: 'ACreplyfixture' }; } });
  assert.equal((await processWinbackReplies({ ...env, WINBACK_AUTOREPLY_ENABLED: 'false' }, { providers: transport, clock: () => noon })).enabled, false);
  assert.equal((await processWinbackReplies(env, { providers: transport, clock: () => noon })).held, 1);
  db.sqlite.exec("UPDATE lead_conversations SET automation_mode='approved'");
  const result = await processWinbackReplies(env, { providers: transport, clock: () => noon });
  assert.equal(result.sent, 0); assert.equal(sends, 0);
  assert.equal(db.sqlite.prepare("SELECT status FROM winback_deliveries WHERE purpose='reply'").get().status, 'cancelled');
});

test('winback never intercepts an organic inquiry from an imported uncontacted row, but STOP remains absolute', async () => {
  const { db, rows } = await setup([fixtureRows[0]]), row = rows[0];
  const organic = await recordWinbackReply(db, {}, {from:row.phone,providerMessageId:'ACorganicfixture',text:'how much for 2 dogs weekly?',direction:'inbound'}, {now:noon});
  assert.equal(organic.handled,false); assert.equal(db.sqlite.prepare('SELECT count(*) n FROM winback_replies').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM submissions').get().n,0);
  const stopped = await recordWinbackReply(db, {}, {from:row.phone,providerMessageId:'ACuncontactedSTOP',text:'STOP',direction:'inbound'}, {now:noon});
  assert.equal(stopped.handled,false); assert.equal(stopped.stopped,true);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients').get().status,'opted_out');
});

test('winback gives a newer open Meta conversation priority over an older campaign contact', async () => {
  const { db, rows } = await setup([fixtureRows[0]]), row = rows[0]; markContacted(db,row);
  db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES('newer-meta','question','facebook','new',?,'{}')`).run(row.phone);
  db.sqlite.prepare(`INSERT INTO lead_conversations(id,submission_id,organization_id,status,automation_mode,owner,last_outbound_at) VALUES('newer-meta-conv','newer-meta','org-opwp','open','approved','backend',?)`).run(noon.toISOString());
  db.sqlite.prepare(`INSERT INTO meta_lead_intakes(submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,phone_hash,review_reason) VALUES('newer-meta','org-opwp','fixture-meta','fixture-form','fixture-page','https://example.test',?,'fixture')`).run(row.phone_hash);
  const result = await recordWinbackReply(db, {}, {from:row.phone,providerMessageId:'ACmetapriorityfixture',text:'yes',direction:'inbound'}, {now:noon});
  assert.equal(result.handled,false); assert.equal(result.reason,'newer_meta_conversation');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM winback_replies').get().n,0);
});

test('winback STOP suppresses all campaigns, persists durable both-table writeback, and retries failures', async () => {
  const { db, rows } = await setup();
  await recordWinbackReply(db, {}, { from: rows[0].phone, providerMessageId: 'ACfixtureSTOP', text: 'STOP', direction: 'inbound' }, { now: noon });
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_suppressions').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients WHERE id=?').get(rows[0].id).status, 'opted_out');
  assert.ok(db.sqlite.prepare('SELECT count(*) n FROM winback_airtable_outbox WHERE do_not_text=1').get().n >= 1);
  let calls = 0;
  const failed = await flushWinbackAirtable(db, { writeAirtable: async () => { calls++; throw Error(); } }); assert.ok(failed.failed > 0);
  const recovered = await flushWinbackAirtable(db, { writeAirtable: async row => { assert.equal(row.do_not_text, 1); } }); assert.ok(recovered.synced > 0);
  await applyWinbackOptOut(db, rows[0].phone, { eventId: 'ACfixtureSTOP', now: noon });
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_suppressions').get().n, 1);
});

test('winback STOP and failure receipts preserve other organizations and accepted sent or unknown receipts', async () => {
  const { db, rows } = await setup([fixtureRows[0]]), recipient = rows[0];
  db.sqlite.prepare(`INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES('foreign-campaign','org-other','Fabricated foreign fixture','{}',?)`).run('a'.repeat(64));
  db.sqlite.prepare(`INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,first_name,version,batch,card_variant) VALUES('foreign-recipient','foreign-campaign',?,?,'Fixture','V1',1,'A')`).run(recipient.phone_hash, recipient.phone);
  for (const id of [recipient.id, 'foreign-recipient']) {
    for (const [suffix, status, providerId] of [['pending','draft',null],['accepted','sending',`AC${id}accepted`],['sent','sent',`AC${id}sent`],['unknown','unknown',`AC${id}unknown`]]) {
      db.sqlite.prepare(`INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body,provider_message_id) VALUES(?,?,'initial',?,?, 'Fabricated receipt fixture',?)`).run(`${id}-${suffix}`, id, suffix, status, providerId);
    }
  }
  for (const [id, org, providerId] of [['core-own','org-opwp','ACcoreaccepted'],['core-foreign','org-other',null]]) {
    db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES(?,'question','website','new',?,'{}')`).run(id, recipient.phone);
    db.sqlite.prepare(`INSERT INTO lead_conversations(id,submission_id,organization_id,automation_mode,owner) VALUES(?,?,?,'approved','backend')`).run(`conversation-${id}`, id, org);
    db.sqlite.prepare(`INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at,status,provider_message_id) VALUES(?,?,?,'fixture','fixture',?,?,'sending',?)`).run(`quote-${id}`, id, recipient.phone, noon.toISOString(), noon.toISOString(), providerId);
  }
  const foreignRecipient = db.sqlite.prepare("SELECT * FROM winback_recipients WHERE id='foreign-recipient'").get();
  const foreignDeliveries = db.sqlite.prepare("SELECT * FROM winback_deliveries WHERE recipient_id='foreign-recipient' ORDER BY id").all();
  const accepted = db.sqlite.prepare("SELECT id,status,provider_message_id FROM winback_deliveries WHERE recipient_id=? AND provider_message_id IS NOT NULL ORDER BY id").all(recipient.id);
  await applyWinbackOptOut(db, recipient.phone, { eventId: 'ACorgscopedSTOP', now: noon });
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM winback_recipients WHERE id='foreign-recipient'").get(), foreignRecipient);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM winback_deliveries WHERE recipient_id='foreign-recipient' ORDER BY id").all(), foreignDeliveries);
  assert.deepEqual(db.sqlite.prepare("SELECT id,status,provider_message_id FROM winback_deliveries WHERE recipient_id=? AND provider_message_id IS NOT NULL ORDER BY id").all(recipient.id), accepted);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_deliveries WHERE id=?').get(`${recipient.id}-pending`).status, 'cancelled');
  assert.equal(db.sqlite.prepare("SELECT status FROM quote_follow_ups WHERE id='quote-core-own'").get().status, 'sending');
  assert.equal(db.sqlite.prepare("SELECT status FROM quote_follow_ups WHERE id='quote-core-foreign'").get().status, 'sending');
  assert.equal(db.sqlite.prepare("SELECT automation_mode FROM lead_conversations WHERE submission_id='core-foreign'").get().automation_mode, 'approved');
  const foreignEvent = await recordWinbackDelivery(db, { type: 'message.failed', data: { object: { id: 'ACforeign-recipientaccepted', direction: 'outgoing' } } }, { now: noon });
  assert.equal(foreignEvent.handled, false);
  await recordWinbackDelivery(db, { type: 'message.failed', data: { object: { id: `AC${recipient.id}sent`, direction: 'outgoing' } } }, { now: noon });
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM winback_recipients WHERE id='foreign-recipient'").get(), foreignRecipient);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM winback_deliveries WHERE recipient_id='foreign-recipient' ORDER BY id").all(), foreignDeliveries);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_deliveries WHERE id=?').get(`${recipient.id}-unknown`).status, 'unknown');
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'text_status:org-opwp:%'").get().n, 1);
});

test('winback real Quo provider refuses unknown opt-out authority and direct send bypass, without network', async () => {
  let requests = 0;
  const provider = createWinbackProviders({ QUO_API_KEY: 'fixture', QUO_FROM_NUMBER: CRAIG }, { fetcher: async () => { requests++; throw Error('Never use network in this test'); } });
  await assert.rejects(provider.quo(CRAIG, noon), /quo_optout_authority_unavailable/);
  await assert.rejects(provider.send(CRAIG, 'Fixture text'), /send_disabled/);
  assert.equal(requests, 0);
});

test('winback actual transport rechecks Airtable DNT and local STOP immediately before the provider POST', async () => {
  const { db, rows } = await setup([fixtureRows[0]]); enable(db);
  const row = rows[0], fixture = createAirtableContactFixture(); let quoPosts = 0;
  const customer = { id: 'rec00000000000001', fields: { Phone: row.phone, 'Do Not Text': true, 'Text Status': 'Asked to stop' } };
  fixture.records.get(fixture.tables[0].id).push(customer);
  db.sqlite.prepare("INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body) VALUES('fixture-owned-delivery',?,'initial','initial','sending','Fixture body')").run(row.id);
  const env = { ...environment(db), QUO_API_KEY: 'fixture', QUO_FROM_NUMBER: CRAIG, AIRTABLE_API_KEY: 'fixture' };
  const transport = createWinbackProviders(env, { clock:()=>noon, readQuoOptOut: async () => ({ verified: true, optedOut: false }), fetcher: async (url, options) => { if (String(url).startsWith('https://api.airtable.com')) return fixture.fetcher(url, options); quoPosts++; throw Error('No real provider calls in tests'); } });
  const context = { campaignId: row.campaign_id, recipientId: row.id, deliveryId: 'fixture-owned-delivery' };
  await assert.rejects(transport.send(row.phone, 'Fixture body', context), /airtable_do_not_text/);
  customer.fields['Do Not Text'] = false; customer.fields['Text Status'] = 'OK';
  db.sqlite.prepare("INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES('org-opwp',?,'fixture STOP','quo_webhook','fixture')").run(row.phone_hash);
  await assert.rejects(transport.send(row.phone, 'Fixture body', context), /phone_suppressed/);
  assert.equal(quoPosts, 0);
});

test('winback actual transport stops if authority checks cross the 6 PM ET boundary before POST', async () => {
  const {db,rows}=await setup([fixtureRows[0]]);enable(db);const row=rows[0],fixture=createAirtableContactFixture();let time=noon,posts=0;
  assert.equal(winbackWindow(time).allowed,true);
  db.sqlite.prepare(`INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body) VALUES('boundary-delivery',?,'initial','initial','sending','Fabricated boundary body')`).run(row.id);
  const env={...environment(db),QUO_API_KEY:'fixture',QUO_FROM_NUMBER:CRAIG,AIRTABLE_API_KEY:'fixture'};
  const transport=createWinbackProviders(env,{clock:()=>time,readQuoOptOut:async()=>{time=new Date('2026-11-23T23:00:00Z');return{verified:true,optedOut:false};},fetcher:async(url,options)=>{if(String(url).startsWith('https://api.airtable.com'))return fixture.fetcher(url,options);posts++;throw Error('Never use a real provider in tests');}});
  await assert.rejects(transport.send(row.phone,'Fabricated boundary body',{campaignId:row.campaign_id,recipientId:row.id,deliveryId:'boundary-delivery'}),error=>error.code==='outside_send_window');
  assert.equal(posts,0);
});

test('winback provider failure receipts suppress the number and queue irreversible Text failed writeback', async () => {
  const { db, rows } = await setup([fixtureRows[0]]); enable(db);
  await runWinbackBatch(environment(db), { campaignId: 'fixture-campaign', providers: providers(), clock: () => noon });
  const result = await recordWinbackDelivery(db, { type: 'message.failed', data: { object: { id: 'ACfixture', direction: 'outgoing' } } }, { now: noon });
  assert.equal(result.failed, true); assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients').get().status, 'failed');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_suppressions').get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT do_not_text FROM winback_airtable_outbox WHERE outcome='Failed'").get().do_not_text, 1);
  await recordWinbackDelivery(db, { type: 'message.delivered', data: { object: { id: 'ACfixture', direction: 'outgoing' } } });
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients').get().status, 'failed');
});

test('winback dry run masks phones, prints exact test copy, counts every hold and never claims unverified sends', async () => {
  const rows = [...fixtureRows, { ...fixtureRows[0], phone: '+14195550109', flag: 'review' }], result = await buildWinbackDryRun(rows, await fixtureCopy(), { random: () => 0.4 });
  assert.equal(result.totals.willSend, 0); assert.equal(result.totals.heldBatch, 2); assert.equal(result.totals.skipCounts.review_held, 1);
  const report = winbackDryRunMarkdown(result);
  assert.ok(report.includes('***0424')); assert.ok(report.includes('fabricated V1 campaign test')); assert.equal(/\+1\d{10}/.test(report), false);
  assert.equal(winbackReport([{ batch: 1, card_variant: 'A', sent_at: 'fixture', status: 'sent' }]).switchingApproved, false);
});

test('winback dry run reuses persisted assignments and rejects a different recipient import', async () => {
  const { db,copy,rows:assignedRecipients } = await setup();
  const result = await buildWinbackDryRun(fixtureRows,copy,{assignedRecipients,random:()=>assert.fail('A stored assignment must not be randomized again')});
  for (const row of result.results) assert.equal(row.cardVariant,assignedRecipients.find(saved=>saved.phone.endsWith(row.phone.slice(-4))).card_variant);
  await assert.rejects(buildWinbackDryRun(fixtureRows,copy,{assignedRecipients:assignedRecipients.slice(1)}),/Stored campaign assignments/);
});

test('winback text-only reporting cannot recommend a card winner even with unequal results after batches one and two', () => {
  const recipients=[1,2].flatMap(batch=>[
    {batch,card_variant:'A',status:'replied',sent_at:'fabricated',replied_at:'fabricated',positive_at:'fabricated'},
    {batch,card_variant:'B',status:'sent',sent_at:'fabricated'},
  ]);
  const report=winbackReport(recipients);
  assert.equal(report.variants.A.positive_replies,2);assert.equal(report.variants.B.positive_replies,0);
  assert.equal(report.cardMode,'text_only');assert.equal(report.cardComparisonEligible,false);
  assert.equal(report.recommendedVariant,null);assert.equal(report.switchingApproved,false);
  assert.equal(report.recommendation,'Picture cards were not delivered. No card winner can be inferred. Keep the approved split.');
});

test('winback signup reconciliation uses contacted linked source confirmations, preserves source ownership and is idempotent', async () => {
  const inputs=Array.from({length:8},(_,i)=>({first_name:'Fixture',phone:`+1419555${3000+i}`,version:'V1',batch:'1',flag:'ok'}));
  const {db,rows}=await setup(inputs),conversion='2026-11-23 17:30:00';
  const [won,intent,unsent,unlinked,foreignSource,oldWon,noTime,changedPhone]=rows;
  for(const row of rows.filter(row=>row!==unsent))markContacted(db,row);
  linkSource(db,won,{stage:'won',convertedAt:conversion});
  linkSource(db,intent);db.sqlite.prepare("UPDATE winback_recipients SET positive_at=?,status='replied' WHERE id=?").run(conversion,intent.id);
  linkSource(db,unsent,{stage:'won',convertedAt:conversion});
  linkSource(db,foreignSource,{org:'org-other',stage:'won',convertedAt:conversion,lifecycle:'converted'});
  linkSource(db,oldWon,{stage:'won',convertedAt:'2026-11-22 17:30:00'});
  linkSource(db,noTime,{lifecycle:'converted'});
  linkSource(db,changedPhone,{stage:'won',convertedAt:conversion,phone:'+14195550999'});
  db.sqlite.prepare(`INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES('foreign-conversion','org-other','Fabricated foreign fixture','{}',?)`).run('a'.repeat(64));
  db.sqlite.prepare(`INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,version,batch,card_variant) VALUES('foreign-conversion-recipient','foreign-conversion',?,?,'V1',1,'A')`).run(won.phone_hash,won.phone);
  const foreignCampaign=db.sqlite.prepare("SELECT * FROM winback_recipients WHERE id='foreign-conversion-recipient'").get();markContacted(db,foreignCampaign);linkSource(db,foreignCampaign,{stage:'won',convertedAt:conversion});
  const sourceBefore=db.sqlite.prepare('SELECT * FROM growth_leads ORDER BY submission_id').all(),submissionsBefore=db.sqlite.prepare('SELECT * FROM submissions ORDER BY id').all();
  const result=await reconcileWinbackConversions(db);assert.equal(result.signups,1);
  assert.equal(db.sqlite.prepare('SELECT signup_at FROM winback_recipients WHERE id=?').get(won.id).signup_at,'2026-11-23T17:30:00.000Z');
  assert.equal(db.sqlite.prepare("SELECT signup_at FROM winback_recipients WHERE id='foreign-conversion-recipient'").get().signup_at,null);
  for(const row of [intent,unsent,unlinked,foreignSource,oldWon,noTime,changedPhone])assert.equal(db.sqlite.prepare('SELECT signup_at FROM winback_recipients WHERE id=?').get(row.id).signup_at,null);
  const outbox=db.sqlite.prepare("SELECT * FROM winback_airtable_outbox WHERE outcome='Signed up'").all();assert.equal(outbox.length,1);assert.equal(outbox[0].id,`signup:${won.id}`);assert.match(outbox[0].note,/fixture-campaign, V1, batch 1, variant [AB]/);
  assert.equal((await reconcileWinbackConversions(db)).signups,0);assert.equal(db.sqlite.prepare("SELECT count(*) n FROM winback_airtable_outbox WHERE outcome='Signed up'").get().n,1);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM growth_leads ORDER BY submission_id').all(),sourceBefore);assert.deepEqual(db.sqlite.prepare('SELECT * FROM submissions ORDER BY id').all(),submissionsBefore);
});

test('winback converted submission fallback requires the exact existing verified onboarding event timestamp', async () => {
  const {db,rows}=await setup([fixtureRows[0]]),row=rows[0];markContacted(db,row);const source=linkSource(db,row,{lifecycle:'converted'}),at='2026-11-23 17:45:00';
  assert.equal((await reconcileWinbackConversions(db)).signups,0);
  db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,phone,email,payload,sng_sync_state,sng_synced) VALUES('fixture-onboarding','onboarding','website','synced',?,'fixture@example.test','{}','succeeded',1)`).run(row.phone);
  db.sqlite.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email,created_at) VALUES(?,?,'org-opwp','system','Customer signup verified; sales outreach stopped',?,'verified_signup',?)`).run(`inbox-signup:fixture-onboarding:${source}`,source,JSON.stringify({onboardingId:'fixture-onboarding',paymentVerified:false}),at);
  assert.equal((await reconcileWinbackConversions(db)).signups,1);assert.equal(db.sqlite.prepare('SELECT signup_at FROM winback_recipients WHERE id=?').get(row.id).signup_at,'2026-11-23T17:45:00.000Z');
});

test('winback signup attribution and its Airtable event commit together and recover from local outbox failure', async () => {
  const {db,rows}=await setup([fixtureRows[0]]),row=rows[0];markContacted(db,row);linkSource(db,row,{stage:'won',convertedAt:'2026-11-23 17:30:00'});
  db.sqlite.exec("CREATE TRIGGER fixture_signup_enqueue_failure BEFORE INSERT ON winback_airtable_outbox WHEN NEW.outcome='Signed up' BEGIN SELECT RAISE(ABORT,'fixture enqueue failure'); END;");
  await assert.rejects(reconcileWinbackConversions(db),/fixture enqueue failure/);assert.equal(db.sqlite.prepare('SELECT signup_at FROM winback_recipients WHERE id=?').get(row.id).signup_at,null);
  db.sqlite.exec('DROP TRIGGER fixture_signup_enqueue_failure');assert.equal((await reconcileWinbackConversions(db)).signups,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM winback_airtable_outbox WHERE outcome='Signed up'").get().n,1);
});

test('winback missing Sent mirrors retry from durable receipts without send flags, duplicates or foreign attribution', async () => {
  const {db,rows}=await setup([fixtureRows[0]]),row=rows[0];markContacted(db,row);
  db.sqlite.prepare(`INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256) VALUES('foreign-sent-repair','org-other','Fabricated foreign fixture','{}',?)`).run('a'.repeat(64));
  db.sqlite.prepare(`INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,version,batch,card_variant,sent_at,provider_message_id) VALUES('foreign-sent-recipient','foreign-sent-repair',?,?,'V1',1,'A',?,'ACforeignSent')`).run(row.phone_hash,row.phone,noon.toISOString());
  db.sqlite.prepare(`INSERT INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body,provider_message_id) VALUES('foreign-sent-delivery','foreign-sent-recipient','initial','initial','sent','Fabricated foreign receipt','ACforeignSent')`).run();
  const receipt=db.sqlite.prepare('SELECT * FROM winback_deliveries WHERE recipient_id=?').get(row.id);
  db.sqlite.exec("CREATE TRIGGER fixture_sent_enqueue_failure BEFORE INSERT ON winback_airtable_outbox WHEN NEW.outcome='Sent' BEGIN SELECT RAISE(ABORT,'fixture enqueue failure'); END;");
  await assert.rejects(reconcileMissingWinbackSentOutbox(db),/fixture enqueue failure/);assert.deepEqual(db.sqlite.prepare('SELECT * FROM winback_deliveries WHERE recipient_id=?').get(row.id),receipt);
  db.sqlite.exec('DROP TRIGGER fixture_sent_enqueue_failure');assert.equal((await reconcileMissingWinbackSentOutbox(db)).queued,1);
  const mirror=db.sqlite.prepare("SELECT * FROM winback_airtable_outbox WHERE outcome='Sent'").all();assert.equal(mirror.length,1);assert.equal(mirror[0].id,`sent:${receipt.id}`);assert.match(mirror[0].note,/fixture-campaign, V1, batch 1, variant [AB]: sent/);
  assert.equal((await reconcileMissingWinbackSentOutbox(db)).queued,0);assert.equal(db.sqlite.prepare('SELECT enabled,kill_switch FROM winback_settings').get().enabled,0);
});

test('winback accepted send remains sent when its first mirror enqueue fails, then the repair helper recovers it', async () => {
  const {db}=await setup([fixtureRows[0]]);enable(db);let sends=0;
  db.sqlite.exec("CREATE TRIGGER fixture_runner_sent_enqueue_failure BEFORE INSERT ON winback_airtable_outbox WHEN NEW.outcome='Sent' BEGIN SELECT RAISE(ABORT,'fixture enqueue failure'); END;");
  const env=environment(db),transport=providers({send:async()=>({id:`ACdurableSent${++sends}`})});
  const result=await runWinbackBatch(env,{campaignId:'fixture-campaign',providers:transport,clock:()=>noon});
  assert.equal(result.sent,1);assert.equal(result.failed,0);assert.equal(result.mirrorDeferred,1);
  assert.equal(db.sqlite.prepare('SELECT status FROM winback_recipients').get().status,'sent');assert.equal(db.sqlite.prepare('SELECT status FROM winback_deliveries').get().status,'sent');
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM winback_airtable_outbox WHERE outcome='Failed'").get().n,0);
  db.sqlite.exec('DROP TRIGGER fixture_runner_sent_enqueue_failure');assert.equal((await reconcileMissingWinbackSentOutbox(db)).queued,1);
  await runWinbackBatch(env,{campaignId:'fixture-campaign',providers:transport,clock:()=>new Date(noon.getTime()+60000)});assert.equal(sends,1);
});
