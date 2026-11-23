import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { OWNER_REVIEW_TEST, OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK, OWNER_REVIEW_INLINE_LINK, assertOwnerReviewTestRecipients, runOwnerReviewTest, runOwnerReviewRetest, runOwnerReviewGoogleLinkTest, runOwnerReviewInlineLinkTest } from '../lib/review-request-owner-test.mjs';
import { REVIEW_URL, reviewRequestPageUrl, reviewRequestImageUrl } from '../lib/review-request-content.mjs';
import { readBoundedBytes, readBoundedProviderJson } from '../lib/bounded-body.mjs';
import { outboundFetch } from '../lib/outbound-request.js';

// Execute the production helpers; only their application-specific import wiring
// is replaced so the owner tests remain independent of the Next.js runtime.
function helperSource(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
}
const sendSms = vm.runInNewContext(helperSource('../lib/quote-follow-up-delivery.js') + '\nsendQuoText', {
  outboundFetch, readBoundedProviderJson, URL,
});
const sendEmail = vm.runInNewContext(helperSource('../lib/submission-notifications.js') + '\nsendTransactionalEmail', {
  outboundFetch, readBoundedProviderJson, URL, crypto: globalThis.crypto,
});

const NOW = new Date('2026-11-19T06:00:00Z'); // 1 AM Eastern: normal automation is quiet.
const VERSION = '123e4567-e89b-42d3-a456-426614174000';
const CAPABILITY = 'ab'.repeat(32);
const SOURCE_FAILURE_REASON = 'manual_owner_test_http_none_source_line_verification_failed';
const UNSENT_REQUEST_ID = '61f7de2b-f6b6-4c2c-ace5-726424736168';
const UNCERTAIN_REASON = 'manual_owner_test_http_none_provider_acceptance_uncertain_verify_before_retry';
const GOOGLE_LINK_REQUEST_ID = 'b7b0fbfb-1111-4111-8111-111111111111';
const INLINE_LINK_REQUEST_ID = 'c8c1fcfc-2222-4222-8222-222222222222';
const DELIVERY_VERIFICATION = Object.freeze({ checkedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  quoNoMessagesAfter0600Z: true, outlookNoReviewEmail: true, gmailNoReviewEmail: true });

function fixture(identity = OWNER_REVIEW_TEST) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../schema-proposals/0067_review_requests.sql', import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT)');
  const writes = [], reads = [], calls = [], previews = [], verifications = [];
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
  function authorize(overrides = {}, selectedIdentity = identity) {
    const payload = JSON.stringify({
      tokenHash: createHash('sha256').update(CAPABILITY).digest('hex'),
      expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(), workerVersion: VERSION,
      ...(selectedIdentity === OWNER_REVIEW_GOOGLE_LINK ? { requestId: GOOGLE_LINK_REQUEST_ID } : {}),
      ...(selectedIdentity === OWNER_REVIEW_INLINE_LINK ? { requestId: INLINE_LINK_REQUEST_ID } : {}), ...overrides,
    });
    sqlite.prepare('INSERT OR REPLACE INTO airtable_cockpit_snapshots(snapshot_key,payload,status) VALUES(?,?,?)')
      .run(selectedIdentity.approvalKey, payload, 'success');
  }
  let previewFailure = null, previewTech = 'tony', failureChannel = null, networkFailureChannel = null, missingIdChannel = null, malformedIdChannel = null, transportFailureName = 'Error';
  let inspectDispatch = null;
  const preparePreview = async (_env, options) => {
    previews.push(options);
    if (previewFailure) throw new Error(previewFailure);
    return { token: options.token, tech: previewTech, pageUrl: reviewRequestPageUrl(options.token), imageUrl: reviewRequestImageUrl(options.token) };
  };
  const verifyPreview = async (_env, options) => {
    verifications.push(options);
    if (previewFailure) throw new Error(previewFailure);
    return { token: options.token, tech: previewTech, pageUrl: reviewRequestPageUrl(options.token), imageUrl: reviewRequestImageUrl(options.token) };
  };
  const fetchProvider = async (url, init = {}) => {
    const parsed = new URL(url);
    assert.equal(init.method, 'POST', 'the shared sender uses its configured E.164 line without an extra phone-number lookup');
    assert.notEqual(init.redirect, 'error', 'provider POST uses the proven outbound helper redirect behavior');
    if (inspectDispatch) inspectDispatch();
    const channel = parsed.hostname === 'api.openphone.com' ? 'sms' : parsed.hostname === 'api.resend.com' ? 'email' : 'unexpected';
    const call = { channel, url: parsed.href, options: init, body: JSON.parse(init.body) };
    calls.push(call);
    if (channel === networkFailureChannel) {
      const error = new Error('provider-private-network-error'); error.name = transportFailureName; throw error;
    }
    if (channel === failureChannel) return Response.json({ message: 'provider-private-payload-do-not-expose', api_key: 'provider-private-secret-do-not-expose' }, { status: 422 });
    if (channel === missingIdChannel) return Response.json({}, { status: 202 });
    if (channel === malformedIdChannel) return Response.json({ id: 'provider-private/malformed-id' }, { status: 202 });
    if (channel === 'sms') return Response.json({ data: { id: 'fixture-quo-message', status: 'queued' } }, { status: 202 });
    if (channel === 'email') return Response.json({ id: 'fixture-resend-message' }, { status: 200 });
    throw new Error('Unexpected provider destination');
  };
  authorize();
  const run = (options = {}, selectedIdentity = identity) => (selectedIdentity === OWNER_REVIEW_INLINE_LINK ? runOwnerReviewInlineLinkTest : selectedIdentity === OWNER_REVIEW_GOOGLE_LINK ? runOwnerReviewGoogleLinkTest : selectedIdentity === OWNER_REVIEW_RETEST ? runOwnerReviewRetest : runOwnerReviewTest)(env, {
    phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email,
    authorization: `Bearer ${CAPABILITY}`, now: NOW, ...options,
  }, { preparePreview, verifyPreview, fetchProvider, sendSms, sendEmail });
  const deliveries = () => sqlite.prepare('SELECT * FROM review_request_deliveries ORDER BY channel').all();
  function prepareSourceFailure(requestId = 'ed4bd231-1111-4111-8111-111111111111') {
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
  function prepareUncertainFailure() {
    const prior = prepareSourceFailure(UNSENT_REQUEST_ID);
    sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.preparationContinuation',json('true'),'$.preparationContinuationAt',?,'$.preparationContinuationClaim','prior-preparation-claim')").run(NOW.toISOString());
    sqlite.prepare('UPDATE review_request_deliveries SET reason=?').run(UNCERTAIN_REASON);
    authorize({ verifiedUnsentCompletion: true, resumeRequestId: UNSENT_REQUEST_ID, deliveryVerification: DELIVERY_VERIFICATION });
    return prior;
  }
  return {
    sqlite, db, env, writes, reads, calls, previews, verifications, authorize, run, deliveries, prepareSourceFailure, prepareUncertainFailure,
    failPreview: () => { previewFailure = 'fixture storage unavailable'; },
    changePreviewTech: tech => { previewTech = tech; },
    failProvider: channel => { failureChannel = channel; },
    failSmsLedger: () => { failSmsLedger = true; },
    failNetwork: (channel, name = 'Error') => { networkFailureChannel = channel; transportFailureName = name; },
    omitProviderId: channel => { missingIdChannel = channel; },
    malformedProviderId: channel => { malformedIdChannel = channel; },
    inspectDispatch: callback => { inspectDispatch = callback; },
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
    assert.equal(sms.from, OWNER_REVIEW_TEST.from);
    assert.equal(sms.content, `Hi Craig, this is Craig with Ohio Pet Waste Pros. Thanks for letting Tony take care of your yard! If you were happy with the cleanup, would you take a minute to leave us a Google review? It really helps our small family business grow. You can leave one here: ${REVIEW_URL} \u{1F603}`);
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

test('a preview for another technician aborts both channels before any provider send', async t => {
  for (const completion of [false, true]) await t.test(completion ? 'existing approved preview' : 'new preview', async () => {
    const f = fixture();
    try {
      if (completion) f.prepareUncertainFailure();
      f.changePreviewTech('craig');
      const result = await f.run();
      assert.equal(f.calls.length, 0);
      assert.equal(result.sms.status, 'not_attempted'); assert.equal(result.email.status, 'not_attempted');
      assert.equal(result.sms.accepted, false); assert.equal(result.email.accepted, false);
      assert.ok(f.deliveries().every(row => row.status === 'failed' && row.provider_message_id === null && row.sent_at === null));
    } finally { f.sqlite.close(); }
  });
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

test('the separate locked retest sends once with an old sent job present and preserves its ledger', async () => {
  const f = fixture(OWNER_REVIEW_RETEST);
  try {
    assert.equal(OWNER_REVIEW_RETEST.jobId, 'manual-owner-review-test-2026-11-19-ios-preview');
    assert.equal(OWNER_REVIEW_RETEST.approvalKey, 'manual_owner_review_test:2026-11-19-ios-preview');
    assert.ok(Object.isFrozen(OWNER_REVIEW_RETEST));
    for (const key of ['phone', 'email', 'from', 'phoneId']) assert.equal(OWNER_REVIEW_RETEST[key], OWNER_REVIEW_TEST[key]);
    f.authorize({}, OWNER_REVIEW_TEST);
    const original = await f.run({}, OWNER_REVIEW_TEST);
    const originalRequest = f.sqlite.prepare('SELECT * FROM review_requests WHERE id=?').get(original.requestId);
    const originalDeliveries = f.sqlite.prepare('SELECT * FROM review_request_deliveries WHERE request_id=? ORDER BY channel').all(original.requestId);
    assert.ok(originalDeliveries.every(row => row.status === 'sent' && row.provider_message_id));
    f.authorize({}, OWNER_REVIEW_TEST);
    await assert.rejects(f.run({}, OWNER_REVIEW_TEST), error => error.status === 409);

    f.authorize();
    const result = await f.run();
    assert.notEqual(result.requestId, original.requestId);
    assert.notEqual(result.requestId, UNSENT_REQUEST_ID);
    assert.equal(f.env.REVIEW_REQUESTS_ENABLED, 'false');
    assert.equal(result.sms.accepted, true); assert.equal(result.email.accepted, true);
    assert.equal(f.calls.length, 4);
    assert.equal(f.previews.length, 2);
    assert.deepEqual(f.previews[1], { token: result.requestId, firstName: 'Craig', tech: 'Tony' });
    const emailCalls = f.calls.filter(call => call.channel === 'email');
    assert.equal(emailCalls[0].options.headers['Idempotency-Key'], `manual-owner-review-test/${OWNER_REVIEW_TEST.jobId}`);
    assert.equal(emailCalls[1].options.headers['Idempotency-Key'], `manual-owner-review-test/${OWNER_REVIEW_RETEST.jobId}`);
    assert.notEqual(emailCalls[0].options.headers['Idempotency-Key'], emailCalls[1].options.headers['Idempotency-Key']);
    const sms = f.calls.filter(call => call.channel === 'sms')[1].body;
    assert.deepEqual(sms.to, [OWNER_REVIEW_TEST.phone]); assert.equal(sms.from, OWNER_REVIEW_TEST.from);
    assert.doesNotMatch(sms.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.doesNotMatch(sms.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.doesNotMatch(sms.content, /[\u2013\u2014]|five[- ]star/i);
    assert.equal(f.sqlite.prepare('SELECT template_version FROM review_requests WHERE job_id=?').get(OWNER_REVIEW_RETEST.jobId).template_version,
      'review-request-initial-cleanup-v5');
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM review_requests WHERE id=?').get(original.requestId), originalRequest);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM review_request_deliveries WHERE request_id=? ORDER BY channel').all(original.requestId), originalDeliveries);
    f.authorize();
    await assert.rejects(f.run(), error => error.status === 409);
    f.authorize({}, OWNER_REVIEW_TEST);
    await assert.rejects(f.run({}, OWNER_REVIEW_TEST), error => error.status === 409);
    assert.equal(f.calls.length, 4);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_customers').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_settings').get().n, 0);
  } finally { f.sqlite.close(); }
});

test('the Google-link identity is isolated from both completed jobs and uses a new preview and idempotency key once', async () => {
  const f = fixture(OWNER_REVIEW_GOOGLE_LINK);
  try {
    assert.equal(OWNER_REVIEW_GOOGLE_LINK.jobId, 'manual-owner-review-test-2026-11-19-google-link');
    assert.equal(OWNER_REVIEW_GOOGLE_LINK.approvalKey, 'manual_owner_review_test:2026-11-19-google-link');
    assert.ok(Object.isFrozen(OWNER_REVIEW_GOOGLE_LINK));
    for (const key of ['phone', 'email', 'from', 'phoneId']) assert.equal(OWNER_REVIEW_GOOGLE_LINK[key], OWNER_REVIEW_TEST[key]);

    const prior = [];
    for (const identity of [OWNER_REVIEW_TEST, OWNER_REVIEW_RETEST]) {
      f.authorize({}, identity);
      prior.push(await f.run({}, identity));
    }
    const oldRequests = f.sqlite.prepare('SELECT * FROM review_requests ORDER BY job_id').all();
    const oldDeliveries = f.sqlite.prepare('SELECT * FROM review_request_deliveries ORDER BY id').all();
    // Both historical jobs exist when this separate job receives its approval.
    f.authorize();
    const result = await f.run();
    assert.equal(result.sms.accepted, true); assert.equal(result.email.accepted, true);
    assert.equal(f.env.REVIEW_REQUESTS_ENABLED, 'false');
    assert.equal(f.calls.length, 6); assert.equal(f.previews.length, 3);
    assert.equal(result.requestId, GOOGLE_LINK_REQUEST_ID, 'the private approved token is reserved for this future send');
    assert.ok(prior.every(value => value.requestId !== result.requestId));
    assert.notEqual(result.requestId, UNSENT_REQUEST_ID);
    assert.notEqual(result.requestId, '57c65e44-d4d1-4f2f-97c2-104227fa3727');
    assert.deepEqual(f.previews[2], { token: result.requestId, firstName: 'Craig', tech: 'Tony' });
    const emailCalls = f.calls.filter(call => call.channel === 'email');
    assert.equal(emailCalls[2].options.headers['Idempotency-Key'], `manual-owner-review-test/${OWNER_REVIEW_GOOGLE_LINK.jobId}`);
    assert.equal(new Set(emailCalls.map(call => call.options.headers['Idempotency-Key'])).size, 3);
    assert.ok(emailCalls[2].body.html.includes(reviewRequestImageUrl(result.requestId)));
    assert.ok(emailCalls[2].body.html.includes(`href="${REVIEW_URL}"`));
    assert.doesNotMatch(emailCalls[2].body.text, /ohiopetwastepros\.com\/review\/(?:r\/|tony\/|craig\/)/);
    const sms = f.calls.filter(call => call.channel === 'sms')[2].body;
    assert.deepEqual(Object.keys(sms).sort(), ['content', 'from', 'to'], 'Quo remains text-only');
    assert.deepEqual(sms.to, [OWNER_REVIEW_GOOGLE_LINK.phone]); assert.equal(sms.from, OWNER_REVIEW_GOOGLE_LINK.from);
    assert.doesNotMatch(sms.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.deepEqual(sms.content.match(/https?:\/\/\S+/g), [REVIEW_URL]);
    assert.doesNotMatch(sms.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.doesNotMatch(sms.content, /[\u2013\u2014]|five[- ]star|ohiopetwastepros\.com\/review\//i);
    assert.equal(f.sqlite.prepare('SELECT template_version FROM review_requests WHERE job_id=?').get(OWNER_REVIEW_GOOGLE_LINK.jobId).template_version,
      'review-request-initial-cleanup-v5');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(OWNER_REVIEW_GOOGLE_LINK.approvalKey).n, 0);
    for (const row of oldRequests) assert.deepEqual(f.sqlite.prepare('SELECT * FROM review_requests WHERE id=?').get(row.id), row);
    for (const row of oldDeliveries) assert.deepEqual(f.sqlite.prepare('SELECT * FROM review_request_deliveries WHERE id=?').get(row.id), row);
    for (const identity of [OWNER_REVIEW_TEST, OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK]) {
      f.authorize({}, identity);
      await assert.rejects(f.run({}, identity), error => error.status === 409);
    }
    assert.equal(f.calls.length, 6); assert.equal(f.previews.length, 3);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 3);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_customers').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_settings').get().n, 0);
  } finally { f.sqlite.close(); }
});

test('concurrent Google-link attempts consume the third capability only once', async () => {
  const f = fixture(OWNER_REVIEW_GOOGLE_LINK);
  try {
    const attempts = await Promise.allSettled([f.run(), f.run()]);
    assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(f.calls.length, 2); assert.equal(f.previews.length, 1); assert.equal(f.deliveries().length, 2);
  } finally { f.sqlite.close(); }
});

test('the fourth locked identity can be approved after all three jobs exist and preserves their completed rows', async () => {
  const f = fixture(OWNER_REVIEW_INLINE_LINK);
  try {
    assert.equal(OWNER_REVIEW_INLINE_LINK.jobId, 'manual-owner-review-test-2026-11-19-inline-link');
    assert.equal(OWNER_REVIEW_INLINE_LINK.approvalKey, 'manual_owner_review_test:2026-11-19-inline-link');
    assert.ok(Object.isFrozen(OWNER_REVIEW_INLINE_LINK));
    for (const key of ['phone', 'email', 'from', 'phoneId']) assert.equal(OWNER_REVIEW_INLINE_LINK[key], OWNER_REVIEW_TEST[key]);
    const oldIdentities = [OWNER_REVIEW_TEST, OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK];
    for (const identity of oldIdentities) {
      f.authorize({}, identity);
      await f.run({}, identity);
    }
    const oldRequests = f.sqlite.prepare('SELECT * FROM review_requests ORDER BY id').all();
    const oldDeliveries = f.sqlite.prepare('SELECT * FROM review_request_deliveries ORDER BY id').all();
    f.authorize();
    const result = await f.run();
    assert.equal(result.requestId, INLINE_LINK_REQUEST_ID);
    assert.equal(result.sms.accepted, true); assert.equal(result.email.accepted, true);
    assert.equal(f.env.REVIEW_REQUESTS_ENABLED, 'false');
    assert.equal(f.calls.length, 8); assert.equal(f.previews.length, 4);
    assert.deepEqual(f.previews[3], { token: INLINE_LINK_REQUEST_ID, firstName: 'Craig', tech: 'Tony' });
    const sms = f.calls.filter(call => call.channel === 'sms')[3].body;
    assert.deepEqual(Object.keys(sms).sort(), ['content', 'from', 'to']);
    assert.deepEqual(sms.to, [OWNER_REVIEW_INLINE_LINK.phone]); assert.equal(sms.from, OWNER_REVIEW_INLINE_LINK.from);
    assert.deepEqual(sms.content.match(/https?:\/\/\S+/g), [REVIEW_URL]);
    assert.ok(sms.content.includes(`You can leave one here: ${REVIEW_URL} \u{1F603}`));
    assert.doesNotMatch(sms.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
    assert.doesNotMatch(sms.content, /[\u2013\u2014]|five[- ]star/i);
    const emailCalls = f.calls.filter(call => call.channel === 'email');
    assert.equal(emailCalls[3].options.headers['Idempotency-Key'], `manual-owner-review-test/${OWNER_REVIEW_INLINE_LINK.jobId}`);
    assert.equal(new Set(emailCalls.map(call => call.options.headers['Idempotency-Key'])).size, 4);
    assert.deepEqual(emailCalls[3].body.to, [OWNER_REVIEW_INLINE_LINK.email]);
    assert.ok(emailCalls[3].body.html.includes(reviewRequestImageUrl(INLINE_LINK_REQUEST_ID)));
    assert.ok(emailCalls[3].body.html.includes(`href="${REVIEW_URL}"`));
    assert.equal(f.sqlite.prepare('SELECT template_version FROM review_requests WHERE job_id=?').get(OWNER_REVIEW_INLINE_LINK.jobId).template_version,
      'review-request-initial-cleanup-v5');
    for (const row of oldRequests) assert.deepEqual(f.sqlite.prepare('SELECT * FROM review_requests WHERE id=?').get(row.id), row);
    for (const row of oldDeliveries) assert.deepEqual(f.sqlite.prepare('SELECT * FROM review_request_deliveries WHERE id=?').get(row.id), row);
    for (const identity of [...oldIdentities, OWNER_REVIEW_INLINE_LINK]) {
      f.authorize({}, identity);
      await assert.rejects(f.run({}, identity), error => error.status === 409);
    }
    assert.equal(f.calls.length, 8); assert.equal(f.previews.length, 4);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 4);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_customers').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_settings').get().n, 0);
  } finally { f.sqlite.close(); }
});

test('concurrent inline-link attempts consume the fourth capability only once', async () => {
  const f = fixture(OWNER_REVIEW_INLINE_LINK);
  try {
    const attempts = await Promise.allSettled([f.run(), f.run()]);
    assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(f.calls.length, 2); assert.equal(f.previews.length, 1); assert.equal(f.deliveries().length, 2);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots').get().n, 0);
  } finally { f.sqlite.close(); }
});

test('the inline-link capability excludes every historical preview, invalid token and existing request id', async t => {
  for (const requestId of [undefined, '', 'not-a-token', UNSENT_REQUEST_ID,
    '57c65e44-d4d1-4f2f-97c2-104227fa3727', '76891c15-8705-49d3-b22f-1c72e507873c']) await t.test(String(requestId), async () => {
    const f = fixture(OWNER_REVIEW_INLINE_LINK);
    try {
      f.authorize({ requestId });
      await assert.rejects(f.run(), error => error.status === 400);
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.deliveries().length, 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(OWNER_REVIEW_INLINE_LINK.approvalKey).n, 1);
    } finally { f.sqlite.close(); }
  });
  await t.test('an otherwise valid token already belongs to another job', async () => {
    const f = fixture(OWNER_REVIEW_INLINE_LINK);
    try {
      f.authorize({}, OWNER_REVIEW_TEST);
      const original = await f.run({}, OWNER_REVIEW_TEST);
      const beforeRequests = f.sqlite.prepare('SELECT * FROM review_requests').all();
      const beforeDeliveries = f.deliveries();
      f.authorize({ requestId: original.requestId });
      await assert.rejects(f.run(), error => error.status === 400);
      assert.equal(f.calls.length, 2); assert.equal(f.previews.length, 1);
      assert.deepEqual(f.sqlite.prepare('SELECT * FROM review_requests').all(), beforeRequests);
      assert.deepEqual(f.deliveries(), beforeDeliveries);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(OWNER_REVIEW_INLINE_LINK.approvalKey).n, 1);
    } finally { f.sqlite.close(); }
  });
});

test('the inline-link identity requires a current fifteen-minute capability pinned to the running Worker', async t => {
  for (const [name, overrides] of [
    ['expired', { expiresAt: NOW.toISOString() }],
    ['too long', { expiresAt: new Date(NOW.getTime() + 15 * 60_000 + 1).toISOString() }],
    ['wrong version', { workerVersion: '11111111-1111-4111-8111-111111111111' }],
  ]) await t.test(name, async () => {
    const f = fixture(OWNER_REVIEW_INLINE_LINK);
    try {
      f.authorize(overrides);
      await assert.rejects(f.run(), error => error.status === 403);
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.deliveries().length, 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(OWNER_REVIEW_INLINE_LINK.approvalKey).n, 1);
    } finally { f.sqlite.close(); }
  });
});

test('the Google-link capability requires its own valid opaque request id and excludes completed previews', async t => {
  for (const requestId of [undefined, '', 'not-a-token', UNSENT_REQUEST_ID, '57c65e44-d4d1-4f2f-97c2-104227fa3727']) await t.test(String(requestId), async () => {
    const f = fixture(OWNER_REVIEW_GOOGLE_LINK);
    try {
      f.authorize({ requestId });
      await assert.rejects(f.run(), error => error.status === 400);
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.deliveries().length, 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(OWNER_REVIEW_GOOGLE_LINK.approvalKey).n, 1);
    } finally { f.sqlite.close(); }
  });
});

test('the Google-link identity requires a current fifteen-minute capability pinned to the running Worker', async t => {
  for (const [name, overrides] of [
    ['expired', { expiresAt: NOW.toISOString() }],
    ['too long', { expiresAt: new Date(NOW.getTime() + 15 * 60_000 + 1).toISOString() }],
    ['wrong version', { workerVersion: '11111111-1111-4111-8111-111111111111' }],
  ]) await t.test(name, async () => {
    const f = fixture(OWNER_REVIEW_GOOGLE_LINK);
    try {
      f.authorize(overrides);
      await assert.rejects(f.run(), error => error.status === 403);
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.deliveries().length, 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(OWNER_REVIEW_GOOGLE_LINK.approvalKey).n, 1);
    } finally { f.sqlite.close(); }
  });
});

test('the separate owner tests cannot acquire the original preparation or verified-unsent continuation capability', async t => {
  for (const identity of [OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK, OWNER_REVIEW_INLINE_LINK]) {
  for (const approval of [
    { preparationContinuation: true, resumeRequestId: UNSENT_REQUEST_ID },
    { verifiedUnsentCompletion: true, resumeRequestId: UNSENT_REQUEST_ID, deliveryVerification: DELIVERY_VERIFICATION },
    { preparationContinuation: false }, { verifiedUnsentCompletion: false }, { resumeRequestId: UNSENT_REQUEST_ID },
  ]) await t.test(`${identity.jobId}: ${Object.keys(approval)[0]}`, async () => {
    const f = fixture(identity);
    try {
      f.authorize(approval);
      await assert.rejects(f.run(), error => error.status === 409);
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0);
      assert.equal(f.deliveries().length, 0);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 0);
    } finally { f.sqlite.close(); }
  });
  }
});

test('the separate owner tests enforce the same fixed recipients and disabled automation flag before preparation', async t => {
  for (const identity of [OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK, OWNER_REVIEW_INLINE_LINK]) {
  for (const [name, options, flag] of [
    ['another phone', { phone: '+12025550100' }, 'false'],
    ['another email', { email: 'someone@example.test' }, 'false'],
    ['multiple recipients', { phone: [OWNER_REVIEW_TEST.phone, '+12025550100'] }, 'false'],
    ['flag true', {}, 'true'], ['flag missing', {}, undefined],
  ]) await t.test(`${identity.jobId}: ${name}`, async () => {
    const f = fixture(identity);
    try {
      f.env.REVIEW_REQUESTS_ENABLED = flag;
      await assert.rejects(f.run(options), error => error.status === (flag === 'false' ? 400 : 403));
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0);
      assert.equal(f.deliveries().length, 0);
      assert.equal(f.writes.length, 0);
    } finally { f.sqlite.close(); }
  });
  }
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
    assert.equal(f.calls.find(call => call.channel === 'sms').body.from, OWNER_REVIEW_TEST.from);
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

test('verified-unsent completion claims the same locked request once and reuses its existing preview', async () => {
  const f = fixture();
  try {
    const { requestId } = f.prepareUncertainFailure();
    f.inspectDispatch(() => {
      const payload = JSON.parse(f.sqlite.prepare('SELECT payload FROM review_requests').get().payload);
      assert.equal(payload.verifiedUnsentCompletion, true, 'the one-use marker is stored before either provider POST');
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots').get().n, 0);
    });
    const result = await f.run();
    assert.equal(result.requestId, UNSENT_REQUEST_ID);
    assert.equal(result.requestId, requestId);
    assert.equal(f.previews.length, 0, 'completion must not recreate the approved preview');
    assert.equal(f.verifications.length, 1);
    assert.equal(f.verifications[0].token, requestId);
    assert.equal(f.calls.length, 2);
    assert.equal(result.sms.accepted, true); assert.equal(result.sms.httpStatus, 202);
    assert.equal(result.email.accepted, true); assert.equal(result.email.httpStatus, 200);
    assert.equal(f.calls.find(call => call.channel === 'sms').body.from, OWNER_REVIEW_TEST.from);
    assert.deepEqual(f.calls.find(call => call.channel === 'sms').body.to, [OWNER_REVIEW_TEST.phone]);
    assert.deepEqual(f.calls.find(call => call.channel === 'email').body.to, [OWNER_REVIEW_TEST.email]);
    assert.match(f.calls.find(call => call.channel === 'sms').body.content, /You can leave one here: https:\/\/g\.page\/r\/CXzwhf5RzsotEAE\/review \u{1F603}$/u);
    assert.match(f.calls.find(call => call.channel === 'email').body.text, /Email: craig@ohiopetwastepros\.com/);
    const request = f.sqlite.prepare('SELECT * FROM review_requests').get();
    const payload = JSON.parse(request.payload);
    assert.equal(payload.preparationContinuation, true, 'prior preparation evidence remains present');
    assert.equal(payload.verifiedUnsentCompletion, true);
    assert.ok(f.deliveries().every(row => row.request_id === requestId && row.status === 'sent' && row.provider_message_id && row.sent_at));
    assert.deepEqual(f.deliveries().map(row => row.id).sort(), ['original-email', 'original-sms']);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_requests').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM review_request_customers').get().n, 0);
    assert.equal(f.env.REVIEW_REQUESTS_ENABLED, 'false');
    f.authorize({ verifiedUnsentCompletion: true, resumeRequestId: requestId, deliveryVerification: DELIVERY_VERIFICATION });
    await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.calls.length, 2);
  } finally { f.sqlite.close(); }
});

test('verified-unsent completion refuses missing, stale or contrary independent delivery evidence', async t => {
  const approvals = [
    ['missing evidence', { deliveryVerification: undefined }],
    ['malformed check time', { deliveryVerification: { ...DELIVERY_VERIFICATION, checkedAt: 'invalid' } }],
    ['stale evidence', { deliveryVerification: { ...DELIVERY_VERIFICATION, checkedAt: new Date(NOW.getTime() - 300_001).toISOString() } }],
    ['future evidence', { deliveryVerification: { ...DELIVERY_VERIFICATION, checkedAt: new Date(NOW.getTime() + 1).toISOString() } }],
    ...['quoNoMessagesAfter0600Z', 'outlookNoReviewEmail', 'gmailNoReviewEmail'].flatMap(key => [
      [`${key} false`, { deliveryVerification: { ...DELIVERY_VERIFICATION, [key]: false } }],
      [`${key} absent`, { deliveryVerification: { ...DELIVERY_VERIFICATION, [key]: undefined } }],
    ]),
    ['wrong request', { resumeRequestId: '11111111-1111-4111-8111-111111111111' }],
    ['mixed continuation approval', { preparationContinuation: true }],
  ];
  for (const [name, overrides] of approvals) await t.test(name, async () => {
    const f = fixture();
    try {
      f.prepareUncertainFailure();
      f.authorize({ verifiedUnsentCompletion: true, resumeRequestId: UNSENT_REQUEST_ID, deliveryVerification: DELIVERY_VERIFICATION, ...overrides });
      await assert.rejects(f.run());
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.verifications.length, 0);
      assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload FROM review_requests').get().payload).verifiedUnsentCompletion, undefined);
    } finally { f.sqlite.close(); }
  });
});

test('verified-unsent completion refuses any changed ledger or an existing completion marker', async t => {
  const cases = [
    ['SMS provider ID present', f => f.sqlite.prepare("UPDATE review_request_deliveries SET provider_message_id='already-attempted' WHERE channel='sms'").run()],
    ['email provider ID empty', f => f.sqlite.prepare("UPDATE review_request_deliveries SET provider_message_id='' WHERE channel='email'").run()],
    ['SMS sent timestamp present', f => f.sqlite.prepare("UPDATE review_request_deliveries SET sent_at=CURRENT_TIMESTAMP WHERE channel='sms'").run()],
    ['email sent timestamp present', f => f.sqlite.prepare("UPDATE review_request_deliveries SET sent_at=CURRENT_TIMESTAMP WHERE channel='email'").run()],
    ['SMS recipient changed', f => f.sqlite.prepare("UPDATE review_request_deliveries SET recipient='+12025550100' WHERE channel='sms'").run()],
    ['email recipient changed', f => f.sqlite.prepare("UPDATE review_request_deliveries SET recipient='other@example.test' WHERE channel='email'").run()],
    ['reason changed', f => f.sqlite.prepare('UPDATE review_request_deliveries SET reason=? WHERE channel=\'sms\'').run(SOURCE_FAILURE_REASON)],
    ['sending status', f => f.sqlite.prepare("UPDATE review_request_deliveries SET status='sending' WHERE channel='email'").run()],
    ['missing channel', f => f.sqlite.prepare("DELETE FROM review_request_deliveries WHERE channel='email'").run()],
    ['nonmanual request', f => f.sqlite.prepare("UPDATE review_requests SET job_type='initial'").run()],
    ['missing preparation marker', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_remove(payload,'$.preparationContinuation')").run()],
    ['completion marker false', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.verifiedUnsentCompletion',json('false'))").run()],
    ['completion marker null', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.verifiedUnsentCompletionAt',NULL)").run()],
    ['completion claim present', f => f.sqlite.prepare("UPDATE review_requests SET payload=json_set(payload,'$.verifiedUnsentCompletionClaim','previous')").run()],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture();
    try {
      f.prepareUncertainFailure(); mutate(f);
      await assert.rejects(f.run());
      assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.verifications.length, 0);
    } finally { f.sqlite.close(); }
  });
});

test('concurrent verified-unsent completions claim the original rows once', async () => {
  const f = fixture();
  try {
    f.prepareUncertainFailure();
    const attempts = await Promise.allSettled([f.run(), f.run()]);
    assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
    assert.equal(f.calls.length, 2); assert.equal(f.previews.length, 0); assert.equal(f.verifications.length, 1);
    assert.equal(f.deliveries().length, 2);
  } finally { f.sqlite.close(); }
});

test('verified-unsent completion rechecks provider evidence atomically before claiming', async () => {
  const f = fixture();
  try {
    f.prepareUncertainFailure();
    f.beforeNextBatch(() => f.sqlite.prepare("UPDATE review_request_deliveries SET provider_message_id='concurrent-provider-id' WHERE channel='sms'").run());
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.verifications.length, 0);
    assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload FROM review_requests').get().payload).verifiedUnsentCompletion, undefined);
  } finally { f.sqlite.close(); }
});

test('verified-unsent completion cannot repeat after existing preview verification fails', async () => {
  const f = fixture();
  try {
    f.prepareUncertainFailure(); f.failPreview();
    const result = await f.run();
    assert.equal(result.sms.status, 'not_attempted'); assert.equal(result.email.status, 'not_attempted');
    assert.equal(f.calls.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.verifications.length, 1);
    f.authorize({ verifiedUnsentCompletion: true, resumeRequestId: UNSENT_REQUEST_ID, deliveryVerification: DELIVERY_VERIFICATION });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 0); assert.equal(f.verifications.length, 1);
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
      assert.equal(result[channel].error, 'provider_network_verify_before_retry');
      assert.equal(result[channel === 'sms' ? 'email' : 'sms'].accepted, true);
      assert.equal(f.deliveries().find(row => row.channel === channel).status, 'failed');
      assert.doesNotMatch(JSON.stringify(result), /provider-private/);
      f.authorize();
      await assert.rejects(f.run(), error => error.status === 409);
      assert.equal(f.calls.length, 2);
    } finally { f.sqlite.close(); }
  });
});

test('transport timeouts retain a safe distinct category and never retry either provider', async t => {
  for (const channel of ['sms', 'email']) await t.test(channel, async () => {
    const f = fixture();
    try {
      f.failNetwork(channel, 'AbortError');
      const result = await f.run();
      assert.equal(f.calls.filter(call => call.channel === channel).length, 1);
      assert.equal(f.calls.length, 2);
      assert.equal(result[channel].error, 'provider_timeout_verify_before_retry');
      assert.equal(result[channel].status, 'acceptance_uncertain');
      assert.equal(result[channel].httpStatus, null);
      assert.equal(result[channel].id, null);
      assert.doesNotMatch(JSON.stringify(result), /provider-private/);
      f.authorize();
      await assert.rejects(f.run());
      assert.equal(f.calls.length, 2);
    } finally { f.sqlite.close(); }
  });
});

test('an HTTP success without a provider ID retains its real status and stays terminal', async t => {
  for (const channel of ['sms', 'email']) await t.test(channel, async () => {
    const f = fixture();
    try {
      f.omitProviderId(channel);
      const result = await f.run();
      assert.equal(result[channel].accepted, false);
      assert.equal(result[channel].httpStatus, 202);
      assert.equal(result[channel].id, null);
      assert.equal(result[channel].error, 'provider_missing_provider_id_verify_before_retry');
      assert.equal(result[channel].status, 'acceptance_uncertain');
      assert.equal(f.calls.length, 2);
      assert.match(f.deliveries().find(row => row.channel === channel).reason, /^manual_owner_test_http_202_/);
      f.authorize();
      await assert.rejects(f.run());
      assert.equal(f.calls.length, 2);
    } finally { f.sqlite.close(); }
  });
});

test('a malformed provider ID on HTTP success remains uncertain with the real HTTP status', async t => {
  for (const channel of ['sms', 'email']) await t.test(channel, async () => {
    const f = fixture();
    try {
      f.malformedProviderId(channel);
      const result = await f.run();
      assert.equal(result[channel].accepted, false);
      assert.equal(result[channel].httpStatus, 202);
      assert.equal(result[channel].id, null);
      assert.equal(result[channel].status, 'acceptance_uncertain');
      assert.equal(result[channel].error, 'provider_missing_provider_id_verify_before_retry');
      assert.doesNotMatch(JSON.stringify(result), /provider-private/);
      const delivery = f.deliveries().find(row => row.channel === channel);
      assert.equal(delivery.status, 'failed'); assert.equal(delivery.provider_message_id, null); assert.equal(delivery.sent_at, null);
      assert.match(delivery.reason, /^manual_owner_test_http_202_/);
      assert.equal(f.calls.length, 2);
      f.authorize();
      await assert.rejects(f.run());
      assert.equal(f.calls.length, 2);
    } finally { f.sqlite.close(); }
  });
});

test('all owner endpoints require same-origin bounded requests and never accept extra send controls', async t => {
  const inputs = [
    [{}, {}, 403],
    [{ origin: 'https://other.example.test' }, {}, 403],
    [{ origin: 'https://www.ohiopetwastepros.com', 'sec-fetch-site': 'cross-site' }, {}, 403],
    [{ origin: 'https://www.ohiopetwastepros.com' }, { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email, enabled: true }, 400],
    [{ origin: 'https://www.ohiopetwastepros.com' }, { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email, content: 'override' }, 400],
    [{ origin: 'https://www.ohiopetwastepros.com' }, { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email, jobId: OWNER_REVIEW_TEST.jobId }, 400],
    [{ origin: 'https://www.ohiopetwastepros.com' }, { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email, preparationContinuation: true }, 400],
    [{ origin: 'https://www.ohiopetwastepros.com', 'content-length': '1000' }, {}, 400],
  ];
  for (const endpoint of ['owner-test', 'owner-retest', 'owner-google-link', 'owner-inline-link']) await t.test(endpoint, async () => {
    const source = readFileSync(new URL(`../app/api/review-requests/${endpoint}/route.js`, import.meta.url), 'utf8')
      .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    for (const [headers, body, status] of inputs) {
    let invoked = 0;
    const POST = vm.runInNewContext(`${source}\nPOST`, {
      Response, URL, Number, TextDecoder, Object, JSON, readBoundedBytes,
      getRuntimeEnv: () => ({}),
      runOwnerReviewTest: async () => { invoked++; throw new Error('Unexpected runner invocation'); },
      runOwnerReviewRetest: async () => { invoked++; throw new Error('Unexpected runner invocation'); },
      runOwnerReviewGoogleLinkTest: async () => { invoked++; throw new Error('Unexpected runner invocation'); },
      runOwnerReviewInlineLinkTest: async () => { invoked++; throw new Error('Unexpected runner invocation'); },
    });
    const response = await POST(new Request(`https://www.ohiopetwastepros.com/api/review-requests/${endpoint}/`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, status); assert.equal(invoked, 0);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  });
});

test('the separate owner endpoints invoke only their fixed wrappers and forward no caller send controls', async t => {
  for (const [endpoint, runner] of [['owner-retest', 'runOwnerReviewRetest'], ['owner-google-link', 'runOwnerReviewGoogleLinkTest'], ['owner-inline-link', 'runOwnerReviewInlineLinkTest']]) await t.test(endpoint, async () => {
  const source = readFileSync(new URL(`../app/api/review-requests/${endpoint}/route.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const calls = [], env = { fixed: true };
  const POST = vm.runInNewContext(`${source}\nPOST`, {
    Response, URL, Number, TextDecoder, Object, JSON, readBoundedBytes,
    getRuntimeEnv: () => env,
    runOwnerReviewTest: async () => { throw new Error('The original capability must not be selected'); },
    runOwnerReviewRetest: async () => { throw new Error('The iOS capability must not be selected'); },
    runOwnerReviewGoogleLinkTest: async () => { throw new Error('The Google-link capability must not be selected'); },
    runOwnerReviewInlineLinkTest: async () => { throw new Error('The inline-link capability must not be selected'); },
    [runner]: async (...args) => { calls.push(args); return { kind: 'manual_owner_test' }; },
  });
  const response = await POST(new Request(`https://www.ohiopetwastepros.com/api/review-requests/${endpoint}/`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://www.ohiopetwastepros.com', authorization: `Bearer ${CAPABILITY}` },
    body: JSON.stringify({ phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email }),
  }));
  assert.equal(response.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0][0], env);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email, authorization: `Bearer ${CAPABILITY}`,
  });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  });
});
