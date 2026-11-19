import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OWNER_REVIEW_TEST, assertOwnerReviewTestRecipients } from '../lib/review-request-owner-test.mjs';

const scriptUrl = new URL('../scripts/send-owner-review-test.mjs', import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
let source = fs.readFileSync(scriptUrl, 'utf8').replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(scriptUrl.href));
source = source.slice(0, source.lastIndexOf('if (process.argv[1]')) + '\nglobalThis.ownerTestMain = main;';
const versionId = '168a07ec-7ef4-414f-90c4-e32a0d3cc7be';
const requestId = '50c0385f-327e-4f2c-9ed4-617a246b02ce';
const origin = 'https://www.ohiopetwastepros.com';

function fixture({ wrongVersion = false, priorRequest = false, providerReject = false, transportFailure = false, ledgerAccepted = false,
  continuation = false, continuationRow = {}, continuationCount = 2, localProviderAttempt = false } = {}) {
  const files = new Map(), commands = [], requests = [], output = [];
  const receiptDir = 'D:/Codex Projects/_agent-runs/2026-11-19-owner-review-test';
  const fakeFs = {
    mkdirSync() {}, existsSync: name => files.has(name),
    readFileSync(name) { if (!files.has(name)) throw new Error('fixture_file_missing'); return files.get(name); },
    writeFileSync(name, value, options = {}) {
      if (options.flag === 'wx' && files.has(name)) throw new Error('fixture_file_already_exists');
      files.set(name, String(value));
    },
  };
  const plain = {
    REVIEW_REQUESTS_ENABLED: 'false', QUO_FROM_NUMBER: OWNER_REVIEW_TEST.from,
    QUO_API_BASE_URL: 'https://api.openphone.com', SMS_PROVIDER: 'quo',
    EMAIL_PROVIDER: 'resend', EMAIL_SENDING_ENABLED: 'true', RESEND_API_BASE_URL: 'https://api.resend.com',
    SITE_ORIGIN: origin, WORKER_ORIGIN: origin, EMAIL_FROM: 'Craig@ohiopetwastepros.com', OWNER_NOTIFICATION_EMAIL: 'Craig@ohiopetwastepros.com',
  };
  const bindings = Object.entries(plain).map(([name, text]) => ({ name, type: 'plain_text', text })).concat([
    { name: 'DB', type: 'd1' }, { name: 'FIELD_PROOFS', type: 'r2_bucket' },
    { name: 'QUO_API_KEY', type: 'secret_text' }, { name: 'RESEND_API_KEY', type: 'secret_text' },
  ]);
  const fakeProcess = { argv: [process.execPath, scriptPath, '--worker-version', versionId, ...(continuation ? ['--continue-preparation'] : [])], execPath: process.execPath, exitCode: 0 };
  if (continuation) {
    const recipients = { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email };
    files.set(path.join(receiptDir, 'send-attempt.json'), JSON.stringify({ kind: 'manual_owner_test', workerVersion: versionId, recipients, postInitiatedAt: '2026-11-19T06:00:00Z', retryAllowed: false }));
    const outcome = { accepted: false, httpStatus: null, id: null, status: 'not_attempted', error: 'source_line_verification_failed' };
    files.set(path.join(receiptDir, 'result.json'), JSON.stringify({ kind: 'manual_owner_test', workerVersion: versionId, recipients, requestId,
      sms: localProviderAttempt ? { ...outcome, status: 'acceptance_uncertain' } : outcome, email: outcome }));
    files.set(path.join(receiptDir, 'receipt.md'), 'Original source preflight receipt; neither provider attempted.');
    files.set(path.join(receiptDir, 'report.md'), 'Original source preflight report.');
  }
  const context = {
    fs: fakeFs, path, randomBytes, createHash, fileURLToPath, OWNER_REVIEW_TEST, assertOwnerReviewTestRecipients,
    process: fakeProcess, Intl, Date, Buffer, TextDecoder, Uint8Array, DataView, JSON, Object, Number, String, URL,
    AbortSignal, Response, console: { log: value => output.push(value), error: value => output.push(value) },
    spawnSync(_executable, args) {
      commands.push(args);
      let value;
      if (args[1] === 'deployments') value = [{ created_on: '2026-11-19T06:00:00Z', versions: [{ version_id: wrongVersion ? requestId : versionId, percentage: 100 }] }];
      else if (args[1] === 'versions') value = { id: versionId, resources: { bindings } };
      else if (args[1] === 'd1') {
        assert.ok(args.includes('--command'), 'D1 must use the query API that returns SELECT rows');
        assert.ok(!args.includes('--file'), 'D1 bulk import does not return SELECT rows');
        const sql = args[args.indexOf('--command') + 1];
        assert.equal(typeof sql, 'string');
        assert.ok([...files.values()].some(value => value === sql + '\n'), 'each command retains its private SQL audit file');
        value = sql.includes('r.job_type,r.payload,r.customer_key,d.channel') ? [{ results: Array.from({ length: continuationCount }, (_, index) => {
          const channel = index === 0 ? 'sms' : 'email';
          return { request_id: requestId, job_type: 'manual_owner_test', customer_key: null, payload: JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony' }),
            channel, status: 'failed', reason: 'manual_owner_test_http_none_source_line_verification_failed',
            recipient: channel === 'sms' ? OWNER_REVIEW_TEST.phone : OWNER_REVIEW_TEST.email,
            provider_message_id: null, sent_at: null, prior_approvals: 0, ...(index === 0 ? continuationRow : {}) };
        }), success: true }] : sql.startsWith('SELECT r.id') ? [{ results: ledgerAccepted ? ['sms', 'email'].map(channel => ({
          request_id: requestId, job_type: 'manual_owner_test', channel, status: 'sent',
          reason: `manual_owner_test_http_${channel === 'sms' ? 202 : 200}_provider_accepted_delivery_not_confirmed`,
          provider_message_id: `${channel}_fixture_recovered`,
        })) : [], success: true }] : sql.startsWith('SELECT') ? [{ results: [{ prior_requests: priorRequest ? 1 : 0, prior_approvals: 0 }], success: true }]
          : [{ results: [], success: true, meta: { changes: 1 } }];
      } else throw new Error('fixture_unexpected_command');
      return { status: 0, stdout: JSON.stringify(value), stderr: '' };
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (options.method === 'POST') {
        if (transportFailure) throw new Error('fixture SECRET must never reach receipts');
        return Response.json({ kind: 'manual_owner_test', workerVersion: versionId,
          recipients: { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email }, requestId,
          previewPageUrl: `${origin}/review/r/${requestId}/`, ogImageUrl: `${origin}/review/r/${requestId}/og.png`,
          sms: { accepted: !providerReject, httpStatus: providerReject ? 429 : 202,
            id: providerReject ? null : 'AC_fixture_owner', status: providerReject ? 'rejected' : 'provider_accepted_delivery_not_confirmed',
            error: providerReject ? 'provider_rejected_or_missing_id' : null, untrusted: 'fixture SECRET must never reach receipts' },
          email: { accepted: true, httpStatus: 200, id: 'resend_fixture_owner', status: 'provider_accepted_delivery_not_confirmed', error: null },
          untrusted: 'fixture SECRET must never reach receipts' });
      }
      if (url.endsWith('og.png')) {
        const bytes = Buffer.alloc(24);
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
        bytes.writeUInt32BE(1200, 16); bytes.writeUInt32BE(630, 20);
        return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
      }
      return new Response(`<meta property="og:image" content="${origin}/review/r/${requestId}/og.png">`);
    },
  };
  vm.runInNewContext(source, context, { filename: scriptPath });
  const read = basename => [...files].find(([name]) => name.replaceAll('\\', '/').endsWith(`/${basename}`))?.[1];
  return { run: () => context.ownerTestMain(), files, commands, requests, output, process: fakeProcess, read,
    result: () => JSON.parse(read('result.json')) };
}

test('owner CLI preflights deployed version and sends one same-origin fixed-recipient POST with an in-memory capability', async () => {
  const f = fixture();
  await f.run();
  const posts = f.requests.filter(request => request.options.method === 'POST');
  assert.equal(posts.length, 1);
  const post = posts[0];
  assert.equal(post.url, `${origin}/api/review-requests/owner-test/`);
  assert.equal(post.options.headers.Origin, origin);
  assert.deepEqual(JSON.parse(post.options.body), { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email });
  assert.match(post.options.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
  const bearer = post.options.headers.Authorization.slice(7);
  const approvalSql = f.read('owner-test-approval.sql');
  assert.ok(approvalSql.includes(createHash('sha256').update(bearer).digest('hex')));
  for (const value of f.files.values()) assert.ok(!value.includes(bearer));
  assert.equal(f.commands.filter(args => args[1] === 'deployments').length, 2);
  assert.equal(f.commands.filter(args => args[1] === 'd1').length, 2);
  for (const args of f.commands.filter(args => args[1] === 'd1')) {
    assert.deepEqual(Array.from(args).slice(1, 6), ['d1', 'execute', 'opwp-backend', '--remote', '--command']);
    assert.equal(args.at(-1), '--json');
    assert.ok(!args.includes('--file'));
  }
  assert.ok(f.commands.every(args => !args.includes('secret') && !args.includes('deploy') && !args.includes('migrations')));
  const result = f.result();
  assert.equal(result.sms.accepted, true); assert.equal(result.sms.httpStatus, 202);
  assert.equal(result.email.accepted, true); assert.equal(result.email.httpStatus, 200);
  assert.equal(result.previewVerification.png1200x630, true);
  assert.equal(result.preflight.reviewRequestsEnabled, 'false');
  assert.equal(f.process.exitCode, 0);
  assert.match(f.read('receipt.md'), /America\/New_York/);
  assert.match(f.read('receipt.md'), /Quo acceptance: Accepted; HTTP 202; status provider_accepted/);
  assert.doesNotMatch(f.read('result.json') + f.read('receipt.md') + f.read('report.md') + f.output.join(''), /fixture SECRET/);
});

test('owner CLI keeps provider rejection receipt and cannot be invoked twice', async () => {
  const f = fixture({ providerReject: true });
  await f.run();
  const previousReceipt = f.read('receipt.md');
  assert.equal(f.result().sms.accepted, false);
  assert.equal(f.result().sms.httpStatus, 429);
  assert.equal(f.result().email.accepted, true);
  assert.equal(f.process.exitCode, 1);
  await assert.rejects(f.run(), /owner_test_attempt_already_recorded_no_retry/);
  assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 1);
  assert.equal(f.read('receipt.md'), previousReceipt);
});

test('owner CLI sends nothing when expected Worker is not active or a ledger attempt exists', async t => {
  for (const options of [{ wrongVersion: true }, { priorRequest: true }]) await t.test(JSON.stringify(options), async () => {
    const f = fixture(options);
    await f.run();
    assert.equal(f.requests.length, 0);
    assert.ok(!f.read('send-attempt.json'));
    assert.ok(!f.read('owner-test-approval.sql'));
    assert.equal(f.result().postAttempts, 0);
    assert.equal(f.process.exitCode, 1);
  });
});

test('owner CLI treats an uncertain transport outcome as terminal and redacts raw errors', async () => {
  const f = fixture({ transportFailure: true });
  await f.run();
  assert.equal(f.requests.length, 1);
  assert.equal(f.result().postAttempts, 1);
  assert.equal(f.result().error, 'owner_test_failed_no_retry');
  assert.match(f.read('receipt.md'), /Unknown \/ not confirmed/);
  assert.doesNotMatch(f.read('result.json') + f.read('receipt.md') + f.read('report.md') + f.output.join(''), /fixture SECRET/);
  await assert.rejects(f.run(), /already_recorded_no_retry/);
  assert.equal(f.requests.length, 1);
});

test('owner CLI recovers provider IDs and HTTP acceptance from a read-only ledger query after transport failure', async () => {
  const f = fixture({ transportFailure: true, ledgerAccepted: true });
  await f.run();
  const result = f.result();
  assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 1);
  assert.equal(result.ledgerRecovery.found, true);
  assert.equal(result.ledgerRecovery.readOnly, true);
  assert.equal(result.sms.accepted, true);
  assert.equal(result.sms.id, 'sms_fixture_recovered');
  assert.equal(result.sms.httpStatus, 202);
  assert.equal(result.email.accepted, true);
  assert.equal(result.email.httpStatus, 200);
  assert.equal(result.email.recoveredFromLedger, true);
  assert.equal(result.previewVerification.png1200x630, true);
  assert.match(f.read('owner-test-ledger-recovery.sql'), /^SELECT /);
  assert.doesNotMatch(f.read('owner-test-ledger-recovery.sql'), /INSERT|UPDATE|DELETE/);
  assert.equal(f.process.exitCode, 1, 'the original transport error stays visible after recovery');
});

test('explicit preparation continuation preserves original guards/evidence and targets the same request once', async () => {
  const f = fixture({ continuation: true });
  const initialAttempt = f.read('send-attempt.json'), initialResult = f.read('result.json'), initialReceipt = f.read('receipt.md');
  await f.run();
  assert.equal(f.read('send-attempt.json'), initialAttempt, 'the original attempt guard is immutable');
  assert.equal(f.read('source-preflight-result.json'), initialResult);
  assert.equal(f.read('source-preflight-receipt.md'), initialReceipt);
  assert.ok(f.read('source-preflight-report.md'));
  const lock = JSON.parse(f.read('preparation-continuation.json'));
  assert.equal(lock.requestId, requestId);
  assert.equal(lock.preparationContinuation, true);
  assert.equal(lock.retryAllowed, false);
  const sql = f.read('owner-test-preparation-continuation-approval.sql');
  assert.ok(sql.includes(`"resumeRequestId":"${requestId}"`));
  assert.ok(sql.includes('"preparationContinuation":true'));
  assert.match(sql, /manual_owner_test_http_none_source_line_verification_failed/);
  assert.match(sql, /provider_message_id IS NULL AND sent_at IS NULL/);
  assert.match(sql, /status='failed'/);
  assert.ok(!f.read('owner-test-approval.sql'));
  assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 1);
  assert.equal(f.result().requestId, requestId);
  assert.equal(f.result().preparationContinuation, true);
  assert.equal(f.process.exitCode, 0);
  await assert.rejects(f.run(), /preparation_continuation_already_recorded_no_retry/);
  assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 1);
  assert.equal(f.read('send-attempt.json'), initialAttempt);
});

test('preparation continuation rejects every provider attempt, changed recipient, partial ledger and prior continuation', async t => {
  const cases = [
    { status: 'sending' }, { status: 'sent' }, { status: 'queued' },
    { provider_message_id: 'AC_existing' }, { sent_at: '2026-11-19 06:01:00' },
    { reason: 'manual_owner_test_http_429_provider_rejected_or_missing_id' },
    { reason: 'manual_owner_test_http_none_provider_acceptance_uncertain_verify_before_retry' },
    { reason: 'manual_owner_test_http_none_preview_preparation_failed' },
    { recipient: '+12025550100' }, { job_type: 'initial' }, { request_id: versionId }, { customer_key: 'customer-record' },
    { prior_approvals: 1 },
    { payload: JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony', preparationContinuation: true }) },
    { payload: JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony', preparationContinuation: false }) },
    { payload: JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony', preparationContinuationAt: null }) },
    { payload: JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony', preparationContinuationClaim: null }) },
    { payload: JSON.stringify({ kind: 'customer_automation', firstName: 'Craig', tech: 'Tony' }) },
  ];
  for (const continuationRow of cases) await t.test(JSON.stringify(continuationRow), async () => {
    const f = fixture({ continuation: true, continuationRow });
    const initialResult = f.read('result.json'), initialReceipt = f.read('receipt.md'), initialAttempt = f.read('send-attempt.json');
    await f.run();
    assert.equal(f.requests.length, 0);
    assert.ok(!f.read('preparation-continuation.json'));
    assert.ok(!f.read('owner-test-preparation-continuation-approval.sql'));
    assert.equal(f.read('send-attempt.json'), initialAttempt);
    assert.equal(f.read('result.json'), initialResult);
    assert.equal(f.read('receipt.md'), initialReceipt);
    assert.equal(f.process.exitCode, 1);
  });
  for (const continuationCount of [1, 3]) await t.test(`row count ${continuationCount}`, async () => {
    const f = fixture({ continuation: true, continuationCount });
    await f.run();
    assert.equal(f.requests.length, 0);
    assert.ok(!f.read('preparation-continuation.json'));
    assert.ok(!f.read('owner-test-preparation-continuation-approval.sql'));
  });
});

test('preparation continuation requires original local evidence that neither provider was attempted', async () => {
  const f = fixture({ continuation: true, localProviderAttempt: true });
  const original = f.read('result.json');
  await assert.rejects(f.run(), /preparation_continuation_requires_zero_provider_attempts/);
  assert.equal(f.commands.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.read('result.json'), original);
  assert.ok(!f.read('preparation-continuation.json'));
});
