import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { OWNER_REVIEW_TEST, assertOwnerReviewTestRecipients, runOwnerReviewTest } from '../lib/review-request-owner-test.mjs';
import { reviewRequestPageUrl, reviewRequestImageUrl } from '../lib/review-request-content.mjs';
import { readBoundedBytes } from '../lib/bounded-body.mjs';

const NOW = new Date('2026-11-19T06:00:00Z'); // 1 AM Eastern: normal automation is quiet.
const VERSION = '123e4567-e89b-42d3-a456-426614174000';
const CAPABILITY = 'ab'.repeat(32);
const SOURCE_FAILURE_REASON = 'manual_owner_test_http_none_source_line_verification_failed';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../schema-proposals/0067_review_requests.sql', import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT)');
  const writes = [], reads = [], calls = [], previews = [];
  let failSmsLedger = false;
  let beforeBatch = null;
  const db = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) { return { ...statement, values }; },
        async first() { reads.push(sql); return sqlite.prepare(sql).get(...this.values) || null; },
        async all() { reads.push(sql); return { results: sqlite.prepare(sql).all(...this.values) }; },
        async run() {
          writes.push(sql);
          if (failSmsLedger && /^UPDATE review_request_deliveries SET status=/.test(sql) && this.values[2] === 'fixture-quo-message') {
            throw new Error('fixture ledger unavailable after provider accepted');
          }
          return { meta: { changes: sqlite.prepare(sql).run(...this.values).changes } };
        },
      };
      return statement;
    },
    async batch(statements) {
      if (beforeBatch) {
        const callback = beforeBatch; beforeBatch = null;
        callback();
      }
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = {
    DB: db, FIELD_PROOFS: {}, CF_VERSION_METADATA: { id: VERSION },
    REVIEW_REQUESTS_ENABLED: 'false', SMS_PROVIDER: 'quo',
    QUO_API_KEY: 'fixture-key-never-a-real-secret', QUO_FROM_NUMBER: OWNER_REVIEW_TEST.from,
    QUO_API_BASE_URL: 'https://api.openphone.com', EMAIL_PROVIDER: 'resend',
    EMAIL_SENDING_ENABLED: 'true', RESEND_API_KEY: 'fixture-key-never-a-real-secret',
    RESEND_API_BASE_URL: 'https://api.resend.com', EMAIL_FROM: 'Craig@ohiopetwastepros.com',
    EMAIL_FROM_NAME: 'Craig | Ohio Pet Waste Pros', OWNER_NOTIFICATION_EMAIL: OWNER_REVIEW_TEST.email,
  };
  function authorize(overrides = {}) {
    const payload = JSON.stringify({
      tokenHash: createHash('sha256').update(CAPABILITY).digest('hex'),
      expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(), workerVersion: VERSION, ...overrides,
    });
    sqlite.prepare('INSERT OR REPLACE INTO airtable_cockpit_snapshots(snapshot_key,payload,status) VALUES(?,?,?)')
      .run(OWNER_REVIEW_TEST.approvalKey, payload, 'success');
  }
  let previewFailure = null, failureChannel = null, networkFailureChannel = null;
  const preparePreview = async (_env, options) => {
    previews.push(options);
    if (previewFailure) throw new Error(previewFailure);
    return { token: options.token, tech: 'tony', pageUrl: reviewRequestPageUrl(options.token), imageUrl: reviewRequestImageUrl(options.token) };
  };
  const fetchProvider = async (url, init = {}) => {
    const parsed = new URL(url);
    assert.equal(init.method, 'POST', 'the owner send uses its configured phone ID without a phone-number listing lookup');
    const channel = parsed.hostname === 'api.openphone.com' ? 'sms' : parsed.hostname === 'api.resend.com' ? 'email' : 'unexpected';
    const call = { channel, url: parsed.href, options: init, body: JSON.parse(init.body) };
    calls.push(call);
    if (channel === networkFailureChannel) throw new Error('provider-private-network-error');
    if (channel === failureChannel) return Response.json({ message: 'provider-private-payload-do-not-expose', api_key: 'provider-private-secret-do-not-expose' }, { status: 422 });
    if (channel === 'sms') return Response.json({ data: { id: 'fixture-quo-message', status: 'queued' } }, { status: 202 });
    if (channel === 'email') return Response.json({ id: 'fixture-resend-message' }, { status: 200 });
    throw new Error('Unexpected provider destination');
  };
  authorize();
  const run = (options = {}) => runOwnerReviewTest(env, {
    phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email,
    authorization: `Bearer ${CAPABILITY}`, now: NOW, ...options,
  }, { preparePreview, fetchProvider });
  const deliveries = () => sqlite.prepare('SELECT * FROM review_request_deliveries ORDER BY channel').all();
  function prepareSourceFailure() {
    const requestId = 'ed4bd231-1111-4111-8111-111111111111';
    sqlite.prepare(`INSERT INTO review_requests(id,customer_name,job_id,job_date,completed_at,job_type,tech,page_slug,template_version,payload)
      VALUES(?,'Craig',?,'2026-11-19',?,'manual_owner_test','Tony','tony','initial-cleanup-v1',?)`)
      .run(requestId, OWNER_REVIEW_TEST.jobId, NOW.toISOString(), JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony', quietHoursBypassed: true, workerVersion: VERSION }));
    const oldUnsubscribeHash = createHash('sha256').update('previous-unsent-unsubscribe-token').digest('hex');
    const emailHash = createHash('sha256').update(OWNER_REVIEW_TEST.email).digest('hex');
    for (const channel of ['sms', 'email']) {
      sqlite.prepare(`INSERT INTO review_request_deliveries(id,request_id,channel,status,reason,recipient,email_hash,unsubscribe_token_hash,sending_at,failed_at)
        VALUES(?,?,?,'failed',?,?,?,?,?,?)`)
        .run(`original-${channel}`, requestId, channel, SOURCE_FAILURE_REASON,
          channel === 'sms' ? OWNER_REVIEW_TEST.phone : OWNER_REVIEW_TEST.email,
          channel === 'email' ? emailHash : null, channel === 'email' ? oldUnsubscribeHash : null, NOW.toISOString(), NOW.toISOString());
    }
    authorize({ preparationContinuation: true, resumeRequestId: requestId });
    return { requestId, oldUnsubscribeHash };
  }
  return {
    sqlite, db, env, writes, reads, calls, previews, authorize, run, deliveries, prepareSourceFailure,
    failPreview: () => { previewFailure = 'fixture storage unavailable'; },
    failProvider: channel => { failureChannel = channel; },
    failSmsLedger: () => { failSmsLedger = true; },
    failNetwork: channel => { networkFailureChannel = channel; },
    beforeNextBatch: callback => { beforeBatch = callback; },
  };
}

test('the owner allowlist accepts only the fixed cell and a case-insensitive exact email', async () => {
  assert.deepEqual(assertOwnerReviewTestRecipients({ phone: OWNER_REVIEW_TEST.phone, email: 'CRAIG@OHIOPETWASTEPROS.COM' }), {
    phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email,
  });
  for (const values of [
    { phone: '+12025550100', email: OWNER_REVIEW_TEST.email },
    { phone: OWNER_REVIEW_TEST.phone, email: 'someone@example.test' },
    { phone: '+14192622371', email: OWNER_REVIEW_TEST.email },
    { phone: [OWNER_REVIEW_TEST.phone, '+12025550100'], email: OWNER_REVIEW_TEST.email },
    { phone: OWNER_REVIEW_TEST.phone, email: `${OWNER_REVIEW_TEST.email},someone@example.test` },
    { phone: OWNER_REVIEW_TEST.phone, email: undefined },
  ]) {
    const f = fixture();
    try {
      assert.throws(() => assertOwnerReviewTestRecipients(values));
      await assert.rejects(f.run(values), error => error.status === 400);
      assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0);
    } finally { f.sqlite.close(); }
  }
});

test('owner sends require the automation flag to stay exactly false and the existing source line', async t => {
  for (const [key, value] of [
    ['REVIEW_REQUESTS_ENABLED', 'true'], ['REVIEW_REQUESTS_ENABLED', undefined],
    ['QUO_FROM_NUMBER', '+12025550199'], ['QUO_API_BASE_URL', 'https://other.example.test'],
    ['RESEND_API_BASE_URL', 'https://other.example.test'], ['SMS_PROVIDER', 'other'],
    ['EMAIL_PROVIDER', 'other'], ['EMAIL_SENDING_ENABLED', 'false'],
  ]) await t.test(`${key}=${value}`, async () => {
    const f = fixture();
    try {
      f.env[key] = value;
      await assert.rejects(f.run());
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0);
      assert.equal(f.deliveries().length, 0);
    } finally { f.sqlite.close(); }
  });
});

test('missing, invalid, expired and wrong-version capabilities cannot consume approval or send', async t => {
  const cases = [
    ['missing', f => f.run({ authorization: '' })],
    ['wrong token', f => f.run({ authorization: `Bearer ${'cd'.repeat(32)}` })],
    ['expired', f => { f.authorize({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }); return f.run(); }],
    ['different worker', f => { f.authorize({ workerVersion: '11111111-1111-4111-8111-111111111111' }); return f.run(); }],
  ];
  for (const [name, attempt] of cases) await t.test(name, async () => {
    const f = fixture();
    try {
      await assert.rejects(attempt(f), error => [401, 403].includes(error.status));
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.deliveries().length, 0);
      assert.ok(f.sqlite.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(OWNER_REVIEW_TEST.approvalKey));
    } finally { f.sqlite.close(); }
  });
});

test('the locked manual test bypasses quiet hours with flag false and records one send per provider', async () => {
  const f = fixture();
  try {
    const result = await f.run();
    assert.equal(result.kind, 'manual_owner_test'); assert.equal(result.workerVersion, VERSION);
    assert.equal(f.env.REVIEW_REQUESTS_ENABLED, 'false');
    assert.equal(f.calls.length, 2); assert.deepEqual(f.calls.map(call => call.channel).sort(), ['email', 'sms']);
    assert.equal(f.previews.length, 1);
    assert.equal(f.previews[0].firstName, 'Craig'); assert.equal(f.previews[0].tech, 'Tony');
    assert.equal(result.previewPageUrl, reviewRequestPageUrl(result.requestId));
    assert.equal(result.ogImageUrl, reviewRequestImageUrl(result.requestId));
    assert.equal(result.sms.accepted, true); assert.equal(result.sms.httpStatus, 202); assert.equal(result.sms.id, 'fixture-quo-message');
    assert.equal(result.email.accepted, true); assert.equal(result.email.httpStatus, 200); assert.equal(result.email.id, 'fixture-resend-message');
    const sms = f.calls.find(call => call.channel === 'sms').body;
    assert.deepEqual(sms.to, [OWNER_REVIEW_TEST.phone]);
    assert.equal(sms.from, OWNER_REVIEW_TEST.phoneId);
    assert.equal(sms.content, `Hi Craig, this is Craig with Ohio Pet Waste Pros. Thanks for letting Tony take care of your yard! If you were happy with the cleanup, would you take a minute to leave us a Google review? It really helps our small family business grow. 😃 ${result.previewPageUrl}\n\nReply STOP to opt out`);
    const email = f.calls.find(call => call.channel === 'email').body;
    assert.deepEqual(email.to, [OWNER_REVIEW_TEST.email]);
    assert.match(email.html, new RegExp(result.ogImageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(email.html, /https:\/\/g\.page\/r\/CXzwhf5RzsotEAE\/review/);
    assert.match(email.text, /Craig Bridgman- Owner\nCell \(419\)-262-2371\nEmail: craig@ohiopetwastepros\.com\nWebsite Ohiopetwastepros\.com/);
    assert.ok(email.headers['List-Unsubscribe']); assert.equal(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    const rows = f.deliveries();
    assert.equal(rows.length, 2); assert.ok(rows.every(row => row.status === 'sent' && row.provider_message_id && row.sent_at));
    const request = f.sqlite.prepare('SELECT * FROM review_requests').get();
    assert.equal(request.job_id, OWNER_REVIEW_TEST.jobId); assert.equal(request.job_type, 'manual_owner_test');
    assert.equal(request.customer_key, null); assert.match(request.payload, /manual_owner_test/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_customers').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_settings').get().n, 0);
    assert.ok(rows.find(row => row.channel === 'email').unsubscribe_token_hash);
  } finally { f.sqlite.close(); }
});

test('a persisted preview is required before either provider can be called', async () => {
  const f = fixture();
  try {
    f.failPreview();
    const result = await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(result.sms.accepted, false); assert.equal(result.email.accepted, false);
    assert.equal(result.sms.status, 'not_attempted'); assert.equal(result.email.status, 'not_attempted');
    assert.ok(f.deliveries().every(row => row.status === 'failed'));
  } finally { f.sqlite.close(); }
});

test('one-use approval and the unique manual ledger prevent repeated and concurrent sends', async () => {
  const f = fixture();
  try {
    const attempts = await Promise.allSettled([f.run(), f.run()]);
    assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(f.calls.length, 2); assert.equal(f.deliveries().length, 2);
    f.authorize(); // Even another capability cannot authorize this fixed test twice.
    await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.calls.length, 2);
  } finally { f.sqlite.close(); }
});

test('the one-time preparation continuation reuses the original unsent request and delivery rows', async () => {
  const f = fixture();
  try {
    const { requestId, oldUnsubscribeHash } = f.prepareSourceFailure();
    const result = await f.run();
    assert.equal(result.requestId, requestId);
    assert.equal(result.previewPageUrl, reviewRequestPageUrl(requestId));
    assert.equal(result.ogImageUrl, reviewRequestImageUrl(requestId));
    assert.equal(f.calls.length, 2); assert.equal(f.previews.length, 1);
    assert.equal(f.previews[0].token, requestId);
    assert.equal(f.calls.find(call => call.channel === 'sms').body.from, OWNER_REVIEW_TEST.phoneId);
    const request = f.sqlite.prepare('SELECT * FROM review_requests').get();
    assert.equal(request.id, requestId); assert.equal(request.customer_key, null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 1);
    assert.ok(JSON.parse(request.payload).preparationContinuationAt);
    const rows = f.deliveries();
    assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => row.id).sort(), ['original-email', 'original-sms']);
    assert.ok(rows.every(row => row.status === 'sent' && row.provider_message_id && row.sent_at));
    assert.notEqual(rows.find(row => row.channel === 'email').unsubscribe_token_hash, oldUnsubscribeHash);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_customers').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_settings').get().n, 0);
    f.authorize({ preparationContinuation: true, resumeRequestId: requestId });
    await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.calls.length, 2);
  } finally { f.sqlite.close(); }
});

test('preparation continuation requires both exact source-preflight failures and rejects every attempted or changed state', async t => {
  const cases = [
    ['no continuation approval', f => f.authorize()],
    ['wrong original request ID', f => f.authorize({ preparationContinuation: true, resumeRequestId: '11111111-1111-4111-8111-111111111111' })],
    ['missing original request ID', f => f.authorize({ preparationContinuation: true })],
    ['SMS recipient changed', f => f.sqlite.prepare("UPDATE review_request_deliveries SET recipient='+12025550100' WHERE channel='sms'").run()],
    ['email recipient changed', f => f.sqlite.prepare("UPDATE review_request_deliveries SET recipient='someone@example.test' WHERE channel='email'").run()],
    ['provider ID present', f => f.sqlite.prepare("UPDATE review_request_deliveries SET provider_message_id='already-attempted' WHERE channel='sms'").run()],
    ['empty provider ID present', f => f.sqlite.prepare("UPDATE review_request_deliveries SET provider_message_id='' WHERE channel='email'").run()],
    ['sent timestamp present', f => f.sqlite.prepare("UPDATE review_request_deliveries SET sent_at=CURRENT_TIMESTAMP WHERE channel='email'").run()],
    ['provider rejected', f => f.sqlite.prepare("UPDATE review_request_deliveries SET reason='manual_owner_test_http_422_provider_rejected_or_missing_id' WHERE channel='sms'").run()],
    ['provider acceptance uncertain', f => f.sqlite.prepare("UPDATE review_request_deliveries SET reason='manual_owner_test_http_none_provider_acceptance_uncertain_verify_before_retry' WHERE channel='email'").run()],
    ['preview preparation failed', f => f.sqlite.prepare("UPDATE review_request_deliveries SET reason='manual_owner_test_http_none_preview_preparation_failed' WHERE channel='email'").run()],
    ['delivery is sending', f => f.sqlite.prepare("UPDATE review_request_deliveries SET status='sending' WHERE channel='sms'").run()],
    ['delivery is sent', f => f.sqlite.prepare("UPDATE review_request_deliveries SET status='sent' WHERE channel='email'").run()],
    ['delivery is queued', f => f.sqlite.prepare("UPDATE review_request_deliveries SET status='queued' WHERE channel='sms'").run()],
    ['missing delivery', f => f.sqlite.prepare("DELETE FROM review_request_deliveries WHERE channel='email'").run()],
    ['extra delivery', f => f.sqlite.prepare(`INSERT INTO review_request_deliveries(id,request_id,channel,status,reason) SELECT 'extra-delivery',id,'none','failed',? FROM review_requests`).run(SOURCE_FAILURE_REASON)],
    ['continuation marker present', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.preparationContinuationAt','2026-11-19T06:00:00Z')").run()],
    ['false continuation marker present', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.preparationContinuation',json('false'))").run()],
    ['null continuation marker present', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.preparationContinuationClaim',NULL)").run()],
    ['request is not manual', f => f.sqlite.prepare("UPDATE review_requests SET job_type='initial'").run()],
    ['payload is not manual', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.kind','customer_automation')").run()],
    ['first name changed', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.firstName','Other')").run()],
    ['technician changed', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.tech','Craig')").run()],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture();
    try {
      f.prepareSourceFailure();
      mutate(f);
      await assert.rejects(f.run(), error => error.status === 409);
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 1);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_customers').get().n, 0);
    } finally { f.sqlite.close(); }
  });
});

test('concurrent preparation continuations can claim the same original request only once', async () => {
  const f = fixture();
  try {
    const { requestId } = f.prepareSourceFailure();
    const attempts = await Promise.allSettled([f.run(), f.run()]);
    assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
    assert.equal(f.calls.length, 2); assert.equal(f.previews.length, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 1);
    assert.ok(f.deliveries().every(row => row.request_id === requestId && row.status === 'sent'));
  } finally { f.sqlite.close(); }
});

test('continuation rechecks ledger proof atomically after the eligibility reads', async () => {
  const f = fixture();
  try {
    f.prepareSourceFailure();
    f.beforeNextBatch(() => {
      f.sqlite.prepare("UPDATE review_request_deliveries SET provider_message_id='concurrent-provider-attempt' WHERE channel='sms'").run();
    });
    await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0);
    assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload FROM review_requests').get().payload).preparationContinuationAt, undefined);
    assert.ok(f.deliveries().every(row => row.status === 'failed'));
  } finally { f.sqlite.close(); }
});

test('a preparation continuation cannot repeat after its preview fails', async () => {
  const f = fixture();
  try {
    const { requestId } = f.prepareSourceFailure();
    f.failPreview();
    const result = await f.run();
    assert.equal(result.sms.status, 'not_attempted'); assert.equal(result.email.status, 'not_attempted');
    assert.equal(f.calls.length, 0);
    assert.ok(f.deliveries().every(row => row.status === 'failed'));
    f.authorize({ preparationContinuation: true, resumeRequestId: requestId });
    await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 1);
  } finally { f.sqlite.close(); }
});

test('provider rejection is terminal, keeps the backup send, and exposes only safe status', async t => {
  for (const channel of ['sms', 'email']) await t.test(channel, async () => {
    const f = fixture();
    try {
      f.failProvider(channel);
      const result = await f.run();
      assert.equal(f.calls.length, 2);
      assert.equal(result[channel].accepted, false); assert.equal(result[channel].httpStatus, 422);
      assert.equal(result[channel === 'sms' ? 'email' : 'sms'].accepted, true);
      assert.doesNotMatch(JSON.stringify(result), /provider-private/);
      const rejected = f.deliveries().find(row => row.channel === channel);
      assert.equal(rejected.status, 'failed'); assert.ok(rejected.failed_at);
      assert.doesNotMatch(JSON.stringify(f.deliveries()), /provider-private/);
      f.authorize();
      await assert.rejects(f.run());
      assert.equal(f.calls.length, 2); assert.ok(f.deliveries().every(row => row.status !== 'queued'));
    } finally { f.sqlite.close(); }
  });
});

test('a failed SMS ledger update preserves acceptance receipt and still sends the backup email exactly once', async () => {
  const f = fixture();
  try {
    f.failSmsLedger();
    const result = await f.run();
    assert.equal(f.calls.filter(call => call.channel === 'sms').length, 1);
    assert.equal(f.calls.filter(call => call.channel === 'email').length, 1);
    assert.equal(result.sms.accepted, true); assert.equal(result.sms.id, 'fixture-quo-message');
    assert.equal(result.sms.httpStatus, 202); assert.equal(result.sms.ledgerRecorded, false);
    assert.equal(result.email.accepted, true); assert.equal(result.email.id, 'fixture-resend-message');
    assert.equal(result.email.ledgerRecorded, true);
    const rows = f.deliveries();
    assert.equal(rows.find(row => row.channel === 'sms').status, 'sending');
    assert.equal(rows.find(row => row.channel === 'email').status, 'sent');
    f.authorize();
    await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.calls.length, 2);
  } finally { f.sqlite.close(); }
});

test('an uncertain network response is terminal and does not prevent the other authorized channel', async t => {
  for (const channel of ['sms', 'email']) await t.test(channel, async () => {
    const f = fixture();
    try {
      f.failNetwork(channel);
      const result = await f.run();
      assert.equal(f.calls.length, 2);
      assert.equal(result[channel].accepted, false); assert.equal(result[channel].status, 'acceptance_uncertain');
      assert.equal(result[channel].httpStatus, null); assert.equal(result[channel].id, null);
      assert.equal(result[channel === 'sms' ? 'email' : 'sms'].accepted, true);
      assert.equal(f.deliveries().find(row => row.channel === channel).status, 'failed');
      assert.doesNotMatch(JSON.stringify(result), /provider-private/);
      f.authorize();
      await assert.rejects(f.run(), error => error.status === 409);
      assert.equal(f.calls.length, 2);
    } finally { f.sqlite.close(); }
  });
});

test('the owner endpoint requires same-origin bounded requests and never accepts extra send controls', async () => {
  const source = readFileSync(new URL('../app/api/review-requests/owner-test/route.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const inputs = [
    [{}, {}, 403],
    [{ origin: 'https://other.example.test' }, {}, 403],
    [{ origin: 'https://www.ohiopetwastepros.com', 'sec-fetch-site': 'cross-site' }, {}, 403],
    [{ origin: 'https://www.ohiopetwastepros.com' }, { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email, enabled: true }, 400],
    [{ origin: 'https://www.ohiopetwastepros.com' }, { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email, content: 'override' }, 400],
    [{ origin: 'https://www.ohiopetwastepros.com', 'content-length': '1000' }, {}, 400],
  ];
  for (const [headers, body, status] of inputs) {
    let invoked = 0;
    const POST = vm.runInNewContext(`${source}\nPOST`, {
      Response, URL, Number, TextDecoder, Object, JSON, readBoundedBytes,
      getRuntimeEnv: () => ({}),
      runOwnerReviewTest: async () => { invoked++; throw new Error('Unexpected runner invocation'); },
    });
    const response = await POST(new Request('https://www.ohiopetwastepros.com/api/review-requests/owner-test/', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, status); assert.equal(invoked, 0);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});
