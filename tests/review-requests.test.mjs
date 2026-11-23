import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as policy from '../lib/review-request-policy.mjs';
import * as content from '../lib/review-request-content.mjs';
import { normalizeReviewIdentity } from '../lib/google-review-matching.mjs';

const source = readFileSync(new URL('../lib/review-requests.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const NOW = new Date('2026-11-18T17:00:00Z');
const ENABLED_AT = '2026-11-11T05:00:00.000Z';

function fixture({ enabled = true, initialize = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../schema-proposals/0067_review_requests.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE field_message_suppression(phone TEXT PRIMARY KEY,suppressed INTEGER);
    CREATE TABLE lead_suppressions(organization_id TEXT,phone_hash TEXT,reason TEXT);
    CREATE TABLE submissions(id TEXT PRIMARY KEY,status TEXT,kind TEXT,sng_entity_id TEXT,email TEXT,phone TEXT);
    CREATE TABLE growth_leads(submission_id TEXT,organization_id TEXT);
    CREATE TABLE lead_conversations(submission_id TEXT,organization_id TEXT);`);
  sqlite.prepare('INSERT INTO airtable_cockpit_snapshots VALUES (?,?)').run('business_cockpit', JSON.stringify({ opwp: { reviewTracker: [] } }));
  if (initialize) sqlite.prepare('INSERT INTO review_request_settings VALUES (?,?)').run('automation', ENABLED_AT);
  const writes = [];
  let afterWrite = null;
  const db = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) { return { ...statement, values }; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
        async run() {
          writes.push(sql);
          const result = { meta: { changes: sqlite.prepare(sql).run(...this.values).changes } };
          if(afterWrite)await afterWrite(sql);
          return result;
        },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => {
          writes.push(statement.sql);
          return { meta: { changes: sqlite.prepare(statement.sql).run(...statement.values).changes } };
        });
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const jobs = new Map(), sends = [], lookups = [], previews = [];
  let beforeRequest = null;
  let beforePreview = null;
  let beforeProviderReturn = null;
  let failureChannel = null;
  const request = async (path, options) => {
    lookups.push({ path, options });
    if (beforeRequest) await beforeRequest();
    return { ok: true, data: [...jobs.values()] };
  };
  const env = { DB: db, REVIEW_REQUESTS_ENABLED: enabled ? 'true' : 'false', EMAIL_SENDING_ENABLED: 'true', EMAIL_PROVIDER: 'resend', SMS_PROVIDER: 'quo', QUO_API_KEY: 'fixture-only', QUO_FROM_NUMBER: '+12025550199' };
  const methods = vm.runInNewContext(`${source}\n({queueReviewRequest,runScheduledReviewRequests,reviewEnabledAt,reviewEligibility,reviewJob,resolveReviewJob,reviewSnapshotReviewed,setReviewDoNotContact,unsubscribeReviewEmail})`, {
    ...policy, ...content, normalizeReviewIdentity,
    crypto: webcrypto, TextEncoder, Date, Intl, URL, Object, Set, String, Number, Boolean, JSON, console,
    sngRequest: request, sngRows: result => Array.isArray(result.data) ? result.data : [],
    transactionalEmailConfig: () => ({ configured: true, provider: 'resend' }),
    prepareReviewPreview: async (_env, options) => {
      previews.push(options);
      if (beforePreview && await beforePreview() === null) return null;
      const tech = content.reviewTechSlug(options.tech);
      return { token: options.token, tech, pageUrl: content.reviewRequestPageUrl(options.token), imageUrl: content.reviewRequestImageUrl(options.token) };
    },
    sendQuoText: async (_env, row, options) => { sends.push({ channel: 'sms', row, options }); if (failureChannel === 'sms') throw new Error('fixture uncertain response'); if(beforeProviderReturn)await beforeProviderReturn('sms'); return 'fixture-sms'; },
    sendTransactionalEmail: async (_env, options) => { sends.push({ channel: 'email', options }); if (failureChannel === 'email') throw new Error('fixture uncertain response'); if(beforeProviderReturn)await beforeProviderReturn('email'); return 'fixture-email'; },
  });
  function job(overrides = {}) {
    const value = { id: 'job-1', client_id: 'client-1', full_name: 'Jordan Example', type: 'initial', assigned_to_name: 'Tony B', cell_phone_number: '202-555-0100', email: 'jordan@example.test', marketing_allowed: 'yes', end_time: '2026-11-18T16:00:00Z', ...overrides };
    jobs.set(String(value.id), value); return value;
  }
  async function queue(value = job(), options = {}) { return methods.queueReviewRequest(env, { body: { data: { ...value, job_id: value.id } }, now: NOW, request, ...options }); }
  async function run(options = {}) { return methods.runScheduledReviewRequests(env, { now: NOW, request, ...options }); }
  const rows = () => sqlite.prepare('SELECT d.*,r.customer_key,r.job_type,r.page_slug FROM review_request_deliveries d JOIN review_requests r ON r.id=d.request_id ORDER BY d.channel').all();
  return { sqlite, db, env, writes, jobs, sends, lookups, previews, methods, job, queue, run, rows, beforeRequest: callback => { beforeRequest = callback; }, beforePreview: callback => { beforePreview = callback; }, beforeProviderReturn: callback => { beforeProviderReturn = callback; }, afterWrite: callback => { afterWrite = callback; }, failProvider: channel => { failureChannel = channel; } };
}

test('only initial and one_time completion jobs qualify for review requests', async t => {
  for (const type of ['initial', 'one_time', 'recurring', 'custom', 'reclean']) await t.test(type, async () => {
    const f = fixture();
    try {
      const result = await f.queue(f.job({ type }));
      assert.equal(f.rows().length, ['initial', 'one_time'].includes(type) ? 2 : 0);
      if (!['initial', 'one_time'].includes(type)) assert.equal(result.reason, 'ineligible_job_type');
    } finally { f.sqlite.close(); }
  });
});

test('disabled review requests do not write, queue, look up or send even with email enabled', async () => {
  const f = fixture({ enabled: false, initialize: false });
  try {
    assert.equal((await f.queue()).status, 'disabled');
    assert.equal((await f.run()).attempted, 0);
    assert.equal(f.writes.length, 0); assert.equal(f.lookups.length, 0); assert.equal(f.sends.length, 0); assert.equal(f.previews.length, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_settings').get().n, 0);
    assert.equal(f.rows().length, 0);
  } finally { f.sqlite.close(); }
});

test('turning the review feature off leaves existing queued rows untouched and calls neither provider', async () => {
  const f = fixture();
  try {
    await f.queue(); const writes = f.writes.length, lookups = f.lookups.length;
    f.env.REVIEW_REQUESTS_ENABLED = 'false';
    assert.equal((await f.run()).attempted, 0);
    assert.equal(f.writes.length, writes); assert.equal(f.lookups.length, lookups);
    assert.equal(f.sends.length, 0); assert.equal(f.previews.length, 0); assert.ok(f.rows().every(row => row.status === 'queued'));
  } finally { f.sqlite.close(); }
});

test('the scheduler excludes manual owner tests even if a delivery is mistakenly queued', async () => {
  const f = fixture();
  try {
    await f.queue();
    f.sqlite.prepare("UPDATE review_requests SET job_type='manual_owner_test'").run();
    const result = await f.run();
    assert.equal(result.attempted, 0); assert.equal(result.sent, 0);
    assert.equal(f.sends.length, 0); assert.equal(f.previews.length, 0);
    assert.equal(f.lookups.length, 1); // Only the original queue's dispatch lookup.
    assert.ok(f.rows().every(row => row.status === 'queued'));
  } finally { f.sqlite.close(); }
});

test('real Dispatch type, cell_phone, numeric marketing flag and assignment enrich a sparse completion webhook', async () => {
  const f = fixture();
  try {
    f.job({ cell_phone_number: undefined, cell_phone: '202-555-0100', marketing_allowed: 1, type: 'one_time', assigned_to_name: 'Craig Bridgman' });
    await f.methods.queueReviewRequest(f.env, { body: { data: { job_id: 'job-1', client_id: 'client-1', client_name: 'Jordan Example', end_time: '2026-11-18T16:00:00Z' } }, now: NOW });
    assert.equal(f.rows().length, 2); assert.ok(f.rows().every(row => row.job_type === 'one_time' && row.page_slug === 'craig'));
    assert.equal((await f.run()).sent, 2);
    assert.equal(f.sends.find(send => send.channel === 'sms').row.phone, '+12025550100');
  } finally { f.sqlite.close(); }
});

test('review ledger keeps Tony or Craig while messages use Google and email keeps the request preview', async t => {
  for (const [tech, slug] of [['Tony B', 'tony'], ['Craig Bridgman', 'craig'], ['Chad', 'craig'], ['Unknown Tech', 'craig'], ['', 'craig']]) await t.test(tech || 'missing technician', async () => {
    const f = fixture();
    try {
      await f.queue(f.job({ assigned_to_name: tech }));
      assert.ok(f.rows().every(row => row.page_slug === slug));
      assert.equal((await f.run()).sent, 2);
      assert.ok(f.rows().every(row => row.page_slug === slug));
      const sms = f.sends.find(send => send.channel === 'sms').options.content;
      const email = f.sends.find(send => send.channel === 'email').options;
      const token = f.rows()[0].request_id;
      const pageUrl = content.reviewRequestPageUrl(token);
      assert.doesNotMatch(sms, /Reply STOP to opt out|Text STOP to unsubscribe/i);
      assert.ok(sms.split('\n')[0].includes(`You can leave one here: ${content.REVIEW_URL}`));
      assert.ok(email.text.includes(content.REVIEW_URL));
      assert.ok(!sms.includes(pageUrl) && !email.text.includes(pageUrl));
      assert.ok(email.html.includes(content.reviewRequestImageUrl(token)));
      assert.ok(f.previews.every(preview => preview.token === token && content.reviewTechSlug(preview.tech) === slug));
      assert.doesNotMatch(pageUrl, /Jordan|Example|client-1|job-1|2025550100|example\.test/);
      assert.doesNotMatch(sms + email.text + email.html, /review\/(chad|team)\/|review-(chad|team)|photo is coming soon/);
    } finally { f.sqlite.close(); }
  });
});

test('a refreshed unsupported technician prepares a Craig preview under the same opaque request URL', async () => {
  const f = fixture();
  try {
    const job = f.job(); await f.queue(job);
    assert.ok(f.rows().every(row => row.page_slug === 'tony'));
    job.assigned_to_name = 'Chad';
    assert.equal((await f.run()).sent, 2);
    assert.ok(f.rows().every(row => row.page_slug === 'craig'));
    assert.doesNotMatch(f.sends.find(send => send.channel === 'sms').options.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.ok(f.sends.find(send => send.channel === 'email').options.html.includes(content.reviewRequestImageUrl(f.rows()[0].request_id)));
    assert.ok(f.previews.every(preview => content.reviewTechSlug(preview.tech) === 'craig'));
  } finally { f.sqlite.close(); }
});

test('different review requests keep unique opaque email images while sharing the direct Google review link', async () => {
  const f = fixture();
  try {
    await f.queue(f.job());
    await f.queue(f.job({ id: 'job-2', client_id: 'client-2', cell_phone_number: '2025550101', email: 'other@example.test' }));
    assert.equal((await f.run()).sent, 4);
    const tokens = [...new Set(f.rows().map(row => row.request_id))];
    assert.equal(tokens.length, 2);
    const links = tokens.map(token => content.reviewRequestPageUrl(token));
    assert.notEqual(links[0], links[1]);
    for (const [index, link] of links.entries()) {
      assert.match(link, /^https:\/\/www\.ohiopetwastepros\.com\/review\/r\/[a-f0-9-]{36}\/$/);
      assert.doesNotMatch(link, /Jordan|Example|client-[12]|job-[12]|202555010[01]|example\.test/);
      assert.equal(f.sends.filter(send => send.channel === 'sms' && send.options.content.includes(link)).length, 0);
      const email = f.sends.filter(send => send.channel === 'email' && send.options.html.includes(content.reviewRequestImageUrl(tokens[index])));
      assert.equal(email.length, 1);
      assert.ok(email[0].options.text.includes(content.REVIEW_URL));
      assert.ok(!email[0].options.text.includes(link));
    }
    assert.ok(f.sends.filter(send => send.channel === 'sms').every(send => !/Reply STOP to opt out/i.test(send.options.content) && send.options.content.split('\n')[0].includes(`You can leave one here: ${content.REVIEW_URL}`)));
  } finally { f.sqlite.close(); }
});

test('turning the feature off during preview preparation prevents both provider calls', async () => {
  const f = fixture();
  try {
    await f.queue();
    f.beforePreview(() => { f.env.REVIEW_REQUESTS_ENABLED = 'false'; });
    assert.equal((await f.run()).sent, 0);
    assert.equal(f.sends.length, 0);
    assert.ok(f.previews.length > 0);
  } finally { f.sqlite.close(); }
});

test('review requests tied to trashed or deleted leads are skipped by contact, customer ID, or submission ID without sending',async t=>{
  for(const [status,fields] of [
    ['trashed',{phone:'(202) 555-0100'}],['deleted',{email:'JORDAN@example.test'}],
    ['trashed',{sng_entity_id:'client-1'}],['deleted',{id:'linked-lead'}],
  ])await t.test(status+' '+Object.keys(fields).join(','),async()=>{
    const f=fixture();try{
      f.sqlite.prepare('INSERT INTO submissions(id,status,kind,sng_entity_id,email,phone) VALUES(?,?,?,?,?,?)')
        .run(fields.id||'trashed-lead',status,'partial_quote',fields.sng_entity_id||null,fields.email||null,fields.phone||null);
      await f.queue(f.job({submission_id:'linked-lead'}));
      assert.ok(f.rows().every(row=>row.status==='skipped'&&row.reason==='lead_trashed'));
      assert.equal((await f.run()).sent,0);assert.equal(f.sends.length,0);
    }finally{f.sqlite.close();}
  });
});

test('trashing a linked lead during asynchronous preview preparation prevents SMS and email sends',async()=>{
  const f=fixture();try{
    await f.queue();
    f.beforePreview(()=>{
      f.sqlite.prepare("INSERT OR IGNORE INTO submissions(id,status,kind,phone) VALUES('race-lead','trashed','partial_quote','2025550100')").run();
    });
    assert.equal((await f.run()).sent,0);assert.equal(f.sends.length,0);
    assert.ok(f.rows().every(row=>row.status==='skipped'&&row.reason==='lead_trashed'));
  }finally{f.sqlite.close();}
});

test('a delivery cancelled during async preview preparation stays skipped and never calls its provider',async()=>{
  const f=fixture();try{
    await f.queue();
    f.beforePreview(()=>{f.sqlite.exec("UPDATE review_request_deliveries SET status='skipped',reason='lead_trashed' WHERE status='queued'");});
    assert.equal((await f.run()).sent,0);assert.equal(f.sends.length,0);
    assert.ok(f.rows().every(row=>row.status==='skipped'&&row.reason==='lead_trashed'));
  }finally{f.sqlite.close();}
});

test('cancellation after the async sending claim is rechecked before either provider call',async()=>{
  const f=fixture();try{
    await f.queue();
    f.afterWrite(sql=>{if(sql.includes("SET status='sending'"))f.sqlite.exec("UPDATE review_request_deliveries SET status='skipped',reason='lead_trashed' WHERE status IN ('queued','sending')");});
    assert.equal((await f.run()).sent,0);assert.equal(f.sends.length,0);
    assert.ok(f.rows().every(row=>row.status==='skipped'&&row.reason==='lead_trashed'));
  }finally{f.sqlite.close();}
});

test('a lead trashed during the async email token write is checked again before sending',async()=>{
  const f=fixture();try{
    await f.queue(f.job({cell_phone_number:''}));
    f.afterWrite(sql=>{if(sql.includes('SET unsubscribe_token_hash='))f.sqlite.exec("INSERT INTO submissions(id,status,kind,email) VALUES('email-race','trashed','question','jordan@example.test')");});
    assert.equal((await f.run()).sent,0);assert.equal(f.sends.length,0);
    assert.equal(f.rows()[0].status,'skipped');assert.equal(f.rows()[0].reason,'lead_trashed');
  }finally{f.sqlite.close();}
});

test('a provider acceptance racing with Trash is retained as sent history and is never resent',async()=>{
  const f=fixture();try{
    await f.queue();
    f.beforeProviderReturn(()=>{
      f.sqlite.exec("INSERT OR IGNORE INTO submissions(id,status,kind,phone) VALUES('accepted-race','trashed','partial_quote','2025550100'); UPDATE review_request_deliveries SET status='skipped',reason='lead_trashed' WHERE status IN ('queued','sending')");
    });
    assert.equal((await f.run()).sent,1);assert.equal(f.sends.length,1);
    const sent=f.rows().filter(row=>row.status==='sent');assert.equal(sent.length,1);
    assert.equal(sent[0].provider_message_id,'fixture-'+f.sends[0].channel);
    assert.equal(sent[0].reason,'provider_accepted_delivery_not_confirmed');assert.ok(sent[0].sent_at);
    assert.equal(f.rows().filter(row=>row.status==='skipped'&&row.reason==='lead_trashed').length,1);
    assert.equal((await f.run()).sent,0);assert.equal(f.sends.length,1);
  }finally{f.sqlite.close();}
});

test('preview preparation failure leaves deliveries queued and calls neither provider', async () => {
  const f = fixture();
  try {
    await f.queue();
    f.beforePreview(() => { throw new Error('fixture preview storage unavailable'); });
    assert.equal((await f.run()).sent, 0);
    assert.equal(f.sends.length, 0);
    assert.ok(f.rows().every(row => row.status === 'queued'));
  } finally { f.sqlite.close(); }
});

test('an empty sanitized preview name uses the direct Google link and existing generic tech image', async () => {
  const f = fixture();
  try {
    await f.queue();
    f.beforePreview(() => null);
    assert.equal((await f.run()).sent, 2);
    assert.doesNotMatch(f.sends.find(send => send.channel === 'sms').options.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    const email = f.sends.find(send => send.channel === 'email').options;
    assert.ok(email.text.includes(content.REVIEW_URL));
    assert.ok(email.html.includes(`${content.REVIEW_SITE_ORIGIN}${content.REVIEW_TECHS.tony.ogImage}`));
  } finally { f.sqlite.close(); }
});

test('fresh Dispatch aliases override an older webhook job type instead of inheriting its stale initial type', async () => {
  const f = fixture();
  try {
    const job = f.job({ type: 'initial' });
    await f.queue({ ...job, job_type: 'initial', employee_name: 'Tony' });
    job.type = 'recurring'; job.cell_phone = ''; job.cell_phone_number = '';
    assert.equal((await f.run()).sent, 0);
    assert.ok(f.rows().every(row => row.status === 'skipped' && row.reason === 'ineligible_job_type'));
    assert.equal(f.sends.length, 0);
  } finally { f.sqlite.close(); }
});

test('first enabled timestamp is durable and older or replayed jobs cannot form a backlog', async () => {
  const f = fixture({ initialize: false });
  try {
    assert.equal((await f.queue(f.job({ end_time: '2026-11-18T16:59:59Z' }))).reason, 'before_go_live');
    assert.equal(f.sqlite.prepare('SELECT enabled_at FROM review_request_settings').get().enabled_at, NOW.toISOString());
    assert.equal(await f.methods.reviewEnabledAt(f.env, new Date('2026-11-19T17:00:00Z')), NOW.toISOString());
    assert.equal(f.rows().length, 0); assert.equal(f.sends.length, 0);
    assert.equal((await f.queue(f.job({ end_time: NOW.toISOString() }))).reason, 'before_go_live');
    assert.equal((await f.queue(f.job({ end_time: '2026-11-18T17:00:01Z' }))).status, 'recorded');
    assert.equal(f.rows().length, 2);
  } finally { f.sqlite.close(); }
});

test('quiet hours defer queued deliveries and the 9 AM to 8 PM Eastern window respects DST', async () => {
  const f = fixture();
  try {
    await f.queue();
    for (const now of ['2026-11-18T13:59:59Z', '2026-11-19T01:00:00Z']) {
      assert.equal((await f.run({ now: new Date(now) })).deferred, true);
      assert.ok(f.rows().every(row => row.status === 'queued')); assert.equal(f.sends.length, 0);
      assert.equal(f.previews.length, 0);
    }
    assert.equal(policy.reviewSendWindow('2026-07-18T12:59:59Z'), false);
    assert.equal(policy.reviewSendWindow('2026-07-18T13:00:00Z'), true);
    assert.equal(policy.reviewSendWindow('2026-07-19T00:00:00Z'), false);
    assert.equal((await f.run({ now: new Date('2026-11-18T14:00:00Z') })).sent, 2);
  } finally { f.sqlite.close(); }
});

test('eligible initial completion sends both channels once and reserves the customer forever', async () => {
  const f = fixture();
  try {
    const first = f.job(); await f.queue(first);
    assert.equal((await f.queue(first)).status, 'duplicate');
    assert.equal((await f.run()).sent, 2);
    assert.deepEqual(f.sends.map(send => send.channel).sort(), ['email', 'sms']);
    const sms = f.sends.find(send => send.channel === 'sms').options.content;
    assert.match(sms, /^Hey Jordan,/);
    assert.doesNotMatch(sms, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.ok(sms.split('\n')[0].includes(`You can leave one here: ${content.REVIEW_URL}`));
    const email = f.sends.find(send => send.channel === 'email').options;
    assert.match(email.headers['List-Unsubscribe'], /https:\/\/www\.ohiopetwastepros\.com\/api\/review-requests\/unsubscribe\/\?token=/);
    assert.equal(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    await f.queue(f.job({ id: 'job-2', type: 'one_time', cell_phone_number: '2025550101' }));
    assert.equal(f.rows().filter(row => row.reason === 'already_requested').length, 1);
    assert.equal((await f.run()).sent, 0); assert.equal(f.sends.length, 2);
    assert.ok(f.rows().filter(row => row.status === 'sent').every(row => row.sent_at && row.provider_message_id));
  } finally { f.sqlite.close(); }
});

test('durable phone-hash fallback unifies missing-ID and later stable-ID completions', async () => {
  const f = fixture();
  try {
    await f.queue(f.job({ client_id: '' })); await f.run();
    await f.queue(f.job({ id: 'job-2', client_id: 'later-client-id' }));
    assert.equal((await f.run()).sent, 0); assert.equal(f.sends.length, 2);
    const owners = f.sqlite.prepare('SELECT DISTINCT customer_key FROM review_request_identities').all();
    assert.equal(owners.length, 1); assert.match(owners[0].customer_key, /^phone:[a-f0-9]{64}$/);
    assert.equal(f.rows().filter(row => row.reason === 'already_requested').length, 1);
  } finally { f.sqlite.close(); }
});

test('concurrent fallback and stable-ID requests sharing a phone cannot claim two review requests', async () => {
  const f = fixture();
  try {
    const fallback = f.job({ id: 'fallback-job', client_id: '' });
    const stable = f.job({ id: 'stable-job', client_id: 'client-1' });
    await Promise.all([f.queue(fallback), f.queue(stable)]);
    assert.equal(f.rows().filter(row => row.status === 'queued').length, 2);
    await Promise.all([f.run(), f.run()]);
    assert.equal(f.sends.length, 2);
  } finally { f.sqlite.close(); }
});

test('only explicit Reviewed customer rows skip; unmatched reviews and name-like guesses do not', async () => {
  const f = fixture();
  try {
    const match = f.methods.reviewSnapshotReviewed;
    const job = { customerId: '123', customerName: 'Jordan Example' };
    assert.equal(match([{ fields: { 'SNG Client ID': 'rcl_public', 'Client Name': 'Jordan Example', 'Google Review': 'Reviewed' } }], job), true);
    assert.equal(match([{ fields: { 'SNG Client ID': '123', 'Client Name': 'Jordan Example', 'Google Review': 'Not reviewed' } }], job), false);
    assert.equal(match([{ fields: { 'Client Name': 'Jordan Example', 'Google Review': 'Reviewed', 'Client Type': 'Unmatched review' } }], job), false);
    assert.equal(match([{ fields: { 'Client Name': 'Jordan', 'Google Review': 'Reviewed' } }], job), false);
  } finally { f.sqlite.close(); }
});

test('manual phone fallback do-not-contact applies before a stable ID is first linked', async () => {
  const f = fixture();
  try {
    const key = `phone:${await policy.reviewHash('+12025550100')}`;
    await f.methods.setReviewDoNotContact(f.env, { customerKey: key, blocked: true, actor: 'owner@example.test' });
    await f.queue();
    assert.equal(f.rows()[0].reason, 'manual_do_not_contact');
    assert.equal(f.rows()[0].customer_key, key);
    assert.equal((await f.run()).sent, 0);
  } finally { f.sqlite.close(); }
});

test('Reviewed, STOP, lead suppression, marketing, manual DNC, no contact and email unsubscribe record reasons', async t => {
  const cases = [
    ['already_reviewed', async f => f.sqlite.prepare('UPDATE airtable_cockpit_snapshots SET payload=?').run(JSON.stringify({ opwp: { reviewTracker: [{ fields: { 'SNG Client ID': 'client-1', 'Client Name': 'Jordan Example', 'Google Review': 'Reviewed' } }] } }))],
    ['stop_or_suppression', async f => f.sqlite.prepare('INSERT INTO field_message_suppression VALUES (?,?)').run('+12025550100', 1)],
    ['stop_or_suppression', async f => f.sqlite.prepare('INSERT INTO lead_suppressions VALUES (?,?,?)').run('org-opwp', await policy.reviewHash('+12025550100'), 'STOP')],
    ['marketing_not_allowed', async (_f, job) => { job.marketing_allowed = 'no'; }],
    ['manual_do_not_contact', async f => f.methods.setReviewDoNotContact(f.env, { customerKey: 'sng:client-1', blocked: true, actor: 'owner@example.test' })],
    ['no_contact', async (_f, job) => { job.cell_phone_number = ''; job.email = ''; }],
    ['email_unsubscribed', async f => f.sqlite.prepare('INSERT INTO review_request_unsubscribes(email_hash) VALUES (?)').run(await policy.reviewHash('jordan@example.test'))],
  ];
  for (const [reason, setup] of cases) await t.test(reason, async () => {
    const f = fixture();
    try {
      const job = f.job(); await setup(f, job); await f.queue(job);
      assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].status, 'skipped');
      assert.equal(f.rows()[0].reason, reason); assert.ok(f.rows()[0].skipped_at);
      assert.equal((await f.run()).sent, 0); assert.equal(f.sends.length, 0);
    } finally { f.sqlite.close(); }
  });
});

test('dissatisfaction, complaint sentiment and churn do not prevent an honest review request', async () => {
  const f = fixture();
  try {
    await f.queue(f.job({ termination_reason: 'Dissatisfied', churn_reason: 'Dissatisfied', status: 'Inactive', complaint: 'unhappy with service' }));
    assert.equal((await f.run()).sent, 2); assert.equal(f.sends.length, 2);
  } finally { f.sqlite.close(); }
});

test('fresh eligibility is checked immediately before each channel sends', async t => {
  for (const change of ['reviewed', 'stop', 'marketing', 'dnc', 'job_type']) await t.test(change, async () => {
    const f = fixture();
    try {
      const job = f.job(); await f.queue(job);
      if (change === 'reviewed') f.sqlite.prepare('UPDATE airtable_cockpit_snapshots SET payload=?').run(JSON.stringify({ opwp: { reviewTracker: [{ fields: { 'Client Name': 'Jordan Example', 'Google Review': 'Reviewed' } }] } }));
      if (change === 'stop') f.sqlite.prepare('INSERT INTO field_message_suppression VALUES (?,?)').run('+12025550100', 1);
      if (change === 'marketing') job.marketing_allowed = 'no';
      if (change === 'dnc') await f.methods.setReviewDoNotContact(f.env, { customerKey: 'sng:client-1', blocked: true, actor: 'owner@example.test' });
      if (change === 'job_type') job.type = 'recurring';
      assert.equal((await f.run()).sent, 0); assert.equal(f.sends.length, 0);
      assert.ok(f.rows().every(row => row.status === 'skipped'));
    } finally { f.sqlite.close(); }
  });
});

test('phone-only and email-only customers use only their available channel', async t => {
  for (const channel of ['sms', 'email']) await t.test(channel, async () => {
    const f = fixture();
    try {
      await f.queue(f.job(channel === 'sms' ? { email: '' } : { cell_phone_number: '' }));
      assert.equal((await f.run()).sent, 1); assert.equal(f.sends[0].channel, channel);
    } finally { f.sqlite.close(); }
  });
});

test('stale sending rows become terminal and are never automatically resent', async () => {
  const f = fixture();
  try {
    await f.queue();
    f.sqlite.exec("UPDATE review_request_deliveries SET status='sending',sending_at='2000-01-01 00:00:00'");
    await f.run(); await f.run();
    assert.equal(f.sends.length, 0);
    assert.ok(f.rows().every(row => row.status === 'failed' && row.reason === 'interrupted_send_verify_provider_before_retry' && row.failed_at));
  } finally { f.sqlite.close(); }
});

test('uncertain provider responses are terminal and customer reservation prevents another request', async () => {
  const f = fixture();
  try {
    await f.queue(f.job({ email: '' })); f.failProvider('sms');
    await f.run(); await f.run();
    assert.equal(f.sends.length, 1);
    assert.equal(f.rows()[0].status, 'failed'); assert.equal(f.rows()[0].reason, 'provider_acceptance_uncertain_verify_before_retry');
    await f.queue(f.job({ id: 'replacement-job', email: '' })); await f.run();
    assert.equal(f.sends.length, 1);
    assert.equal(f.rows().filter(row => row.reason === 'already_requested').length, 1);
  } finally { f.sqlite.close(); }
});

test('working opaque unsubscribe tokens record durable opt-out and block future email eligibility', async () => {
  const f = fixture();
  try {
    await f.queue(f.job({ cell_phone_number: '' })); await f.run();
    const email = f.sends.find(send => send.channel === 'email').options;
    const token = new URL(email.headers['List-Unsubscribe'].slice(1, -1)).searchParams.get('token');
    const before = f.writes.length;
    assert.equal(await f.methods.unsubscribeReviewEmail(f.env, 'not-valid'), false);
    assert.equal(f.writes.length, before);
    assert.equal(await f.methods.unsubscribeReviewEmail(f.env, token), true);
    assert.equal(await f.methods.unsubscribeReviewEmail(f.env, token), true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_unsubscribes').get().n, 1);
    const delivery = f.sqlite.prepare('SELECT unsubscribe_token_hash FROM review_request_deliveries').get();
    assert.equal(delivery.unsubscribe_token_hash, await policy.reviewHash(token)); assert.notEqual(delivery.unsubscribe_token_hash, token);
    await f.queue(f.job({ id: 'new-customer-job', client_id: 'client-2', cell_phone_number: '' }));
    assert.equal(f.rows().filter(row => row.reason === 'email_unsubscribed').length, 1);
    assert.equal((await f.run()).sent, 0); assert.equal(f.sends.length, 1);
  } finally { f.sqlite.close(); }
});

test('concurrent duplicate jobs and cron processors send at most once per channel', async () => {
  const f = fixture();
  try {
    const job = f.job();
    await Promise.all([f.queue(job), f.queue(job), f.queue(f.job({ id: 'job-2' }))]);
    assert.equal(f.rows().filter(row => row.status === 'queued').length, 2);
    await Promise.all([f.run(), f.run()]);
    assert.equal(f.sends.filter(send => send.channel === 'sms').length, 1);
    assert.equal(f.sends.filter(send => send.channel === 'email').length, 1);
    assert.equal(f.rows().filter(row => row.status === 'sent').length, 2);
  } finally { f.sqlite.close(); }
});

test('unavailable review snapshot or dispatch defers without sending and never invents eligibility', async () => {
  const f = fixture();
  try {
    await f.queue();
    f.sqlite.exec('DELETE FROM airtable_cockpit_snapshots');
    await f.run();
    assert.equal(f.sends.length, 0); assert.ok(f.rows().every(row => row.status === 'queued' && row.reason === 'eligibility_lookup_unavailable'));
    f.sqlite.prepare('INSERT INTO airtable_cockpit_snapshots VALUES (?,?)').run('business_cockpit', JSON.stringify({ opwp: { reviewTracker: [] } }));
    f.jobs.clear(); await f.run();
    assert.equal(f.sends.length, 0); assert.ok(f.rows().every(row => row.status === 'queued'));
  } finally { f.sqlite.close(); }
});

test('manual DNC set through an ID alias blocks and clears its existing phone-only owner',async()=>{
  const f=fixture();
  try {
    await f.queue(f.job({client_id:''}));
    await f.queue(f.job({id:'job-2',client_id:'client-1'}));
    const canonical=f.rows().find(row=>row.channel==='sms').customer_key;
    assert.match(canonical,/^phone:/);
    await f.methods.setReviewDoNotContact(f.env,{customerKey:'sng:client-1',blocked:true,actor:'owner@example.test'});
    assert.equal(f.sqlite.prepare('SELECT do_not_contact FROM review_request_customers WHERE customer_key=?').get(canonical).do_not_contact,1);
    assert.equal((await f.run()).sent,0);
    assert.ok(f.rows().some(row=>row.reason==='manual_do_not_contact'));
    await f.methods.setReviewDoNotContact(f.env,{customerKey:'sng:client-1',blocked:false,actor:'owner@example.test'});
    assert.equal(f.sqlite.prepare('SELECT do_not_contact FROM review_request_customers WHERE customer_key=?').get(canonical).do_not_contact,0);
  } finally {f.sqlite.close();}
});

test('crossing 8 PM after an asynchronous claim returns the row to the queue without sending',async()=>{
  const f=fixture();
  try {
    await f.queue();let ticks=0;
    const result=await f.run({now:()=>new Date(++ticks<4?'2026-11-19T00:59:59Z':'2026-11-19T01:00:00Z')});
    assert.equal(result.sent,0);assert.equal(f.sends.length,0);
    assert.ok(f.rows().every(row=>row.status==='queued'));
    assert.ok(f.rows().some(row=>row.reason==='quiet_hours'));
  } finally {f.sqlite.close();}
});
