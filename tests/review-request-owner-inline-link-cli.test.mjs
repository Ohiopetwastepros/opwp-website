import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nodePath from 'node:path';
import vm from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { OWNER_REVIEW_TEST, OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK, OWNER_REVIEW_INLINE_LINK, assertOwnerReviewTestRecipients } from '../lib/review-request-owner-test.mjs';
import { buildReviewRequestSms, REVIEW_URL } from '../lib/review-request-content.mjs';

const path = nodePath.win32;
const scriptUrl = new URL('../scripts/send-owner-review-inline-link.mjs', import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
let source = fs.readFileSync(scriptUrl, 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', JSON.stringify(scriptUrl.href));
source = source.slice(0, source.lastIndexOf('if (process.argv[1]')) + '\nglobalThis.ownerInlineLinkMain = main;';
const versionId = '168a07ec-7ef4-414f-90c4-e32a0d3cc7be';
const requestId = '50c0385f-327e-4f2c-9ed4-617a246b02ce';
const commit = 'a'.repeat(40);
const origin = 'https://www.ohiopetwastepros.com';
const receiptDir = 'D:/Codex Projects/_agent-runs/2026-11-19-review-inline-link';

function fixture({ proof = {}, missingProof = false, wrongVersion = false, priorRetest = false, raceRetest = false, transportFailure = false,
  missingPreparation = false, preparation = {}, rejected = false, responseImage = 'og.jpg', returnedRequestId = requestId } = {}) {
  const files = new Map([[path.join(receiptDir, 'receipt.md'), 'deployment receipt'], [path.join(receiptDir, 'report.md'), 'deployment report']]), commands = [], requests = [], output = [];
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE review_requests(id TEXT PRIMARY KEY,job_id TEXT UNIQUE,job_type TEXT); CREATE TABLE review_request_deliveries(request_id TEXT,channel TEXT,status TEXT,reason TEXT,recipient TEXT,provider_message_id TEXT); CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);');
  sqlite.prepare('INSERT INTO review_requests VALUES(?,?,?)').run(OWNER_REVIEW_TEST.completionRequestId, OWNER_REVIEW_TEST.jobId, 'manual_owner_test');
  sqlite.prepare('INSERT INTO review_requests VALUES(?,?,?)').run('57c65e44-d4d1-4f2f-97c2-104227fa3727', OWNER_REVIEW_RETEST.jobId, 'manual_owner_test');
  sqlite.prepare('INSERT INTO review_requests VALUES(?,?,?)').run('76891c15-8705-49d3-b22f-1c72e507873c', OWNER_REVIEW_GOOGLE_LINK.jobId, 'manual_owner_test');
  if (priorRetest) sqlite.prepare('INSERT INTO review_requests VALUES(?,?,?)').run(requestId, OWNER_REVIEW_INLINE_LINK.jobId, 'manual_owner_test');
  const verificationFile = path.join(receiptDir, 'delivery-verification.json');
  if (!missingProof) files.set(verificationFile, JSON.stringify({ checkedAt: new Date().toISOString(), jobId: OWNER_REVIEW_INLINE_LINK.jobId,
    recipients: { phone: OWNER_REVIEW_INLINE_LINK.phone, email: OWNER_REVIEW_INLINE_LINK.email },
    verificationBaseline: '2026-11-19T21:27:28Z', quoNoAdditionalReviewRequestsSinceThirdTest: true, outlookNoAdditionalReviewEmailsSinceThirdTest: true, ...proof }));
  if (!missingPreparation) files.set(path.join(receiptDir, 'future-send-preparation.json'), JSON.stringify({ requestId, jobId: OWNER_REVIEW_INLINE_LINK.jobId, firstName: 'Craig', tech: 'Tony', ...preparation }));
  const fakeFs = {
    mkdirSync() {}, existsSync: name => files.has(name),
    readFileSync(name) { if (!files.has(name)) throw new Error('fixture_file_missing'); return files.get(name); },
    writeFileSync(name, value, options = {}) {
      if (options.flag === 'wx' && files.has(name)) throw new Error('fixture_file_already_exists');
      files.set(name, String(value));
    },
  };
  const bindings = Object.entries({ REVIEW_REQUESTS_ENABLED: 'false', QUO_FROM_NUMBER: OWNER_REVIEW_INLINE_LINK.from,
    QUO_API_BASE_URL: 'https://api.openphone.com', SMS_PROVIDER: 'quo', EMAIL_PROVIDER: 'resend', EMAIL_SENDING_ENABLED: 'true',
    RESEND_API_BASE_URL: 'https://api.resend.com', SITE_ORIGIN: origin, WORKER_ORIGIN: origin,
    EMAIL_FROM: 'Craig@ohiopetwastepros.com', OWNER_NOTIFICATION_EMAIL: 'Craig@ohiopetwastepros.com' })
    .map(([name, text]) => ({ name, type: 'plain_text', text })).concat([
      { name: 'DB', type: 'd1' }, { name: 'FIELD_PROOFS', type: 'r2_bucket' },
      { name: 'QUO_API_KEY', type: 'secret_text' }, { name: 'RESEND_API_KEY', type: 'secret_text' },
    ]);
  const fakeProcess = { argv: [process.execPath, scriptPath, '--worker-version', versionId, '--verification-file', verificationFile], execPath: process.execPath, exitCode: 0 };
  const provider = channel => ({ accepted: channel !== 'sms' || !rejected, httpStatus: channel === 'sms' ? rejected ? 422 : 202 : 200,
    id: channel === 'sms' ? rejected ? null : 'AC_fixture_retest' : 'resend_fixture_retest',
    status: channel === 'sms' && rejected ? 'rejected' : 'provider_accepted_delivery_not_confirmed', error: rejected && channel === 'sms' ? 'provider_rejected_verify_before_retry' : null });
  const context = {
    fs: fakeFs, path, randomBytes, createHash, fileURLToPath, OWNER_REVIEW_TEST, OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK, OWNER_REVIEW_INLINE_LINK, assertOwnerReviewTestRecipients, buildReviewRequestSms,
    process: fakeProcess, Intl, Date, Buffer, TextDecoder, Uint8Array, JSON, Object, Number, String, URL, AbortSignal, Response,
    console: { log: value => output.push(value), error: value => output.push(value) },
    spawnSync(executable, args) {
      if (executable === 'git') return { status: 0, stdout: commit + '\n' };
      commands.push(args);
      let value;
      if (args[1] === 'deployments') value = [{ created_on: '2026-11-19T18:00:00Z', versions: [{ version_id: wrongVersion ? requestId : versionId, percentage: 100 }] }];
      else if (args[1] === 'versions') value = { id: versionId, resources: { bindings } };
      else if (args[1] === 'd1') {
        assert.ok(args.includes('--command'));
        assert.ok(!args.includes('--file'));
        const sql = args[args.indexOf('--command') + 1];
        assert.ok([...files.values()].includes(sql + '\n'), 'SQL is audited before execution');
        if (sql.startsWith('SELECT (') && raceRetest && commands.filter(call => call[1] === 'd1').length === 3) {
          sqlite.prepare('INSERT INTO review_requests VALUES(?,?,?)').run(requestId, OWNER_REVIEW_INLINE_LINK.jobId, 'manual_owner_test');
        }
        if (sql.startsWith('SELECT')) value = [{ success: true, results: sqlite.prepare(sql).all() }];
        else value = [{ success: true, results: [], meta: { changes: sqlite.prepare(sql).run().changes } }];
      } else throw new Error('fixture_unexpected_cli');
      return { status: 0, stdout: JSON.stringify(value), stderr: '' };
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (options.method === 'POST') {
        sqlite.prepare('DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=?').run(OWNER_REVIEW_INLINE_LINK.approvalKey);
        sqlite.prepare('INSERT OR IGNORE INTO review_requests VALUES(?,?,?)').run(requestId, OWNER_REVIEW_INLINE_LINK.jobId, 'manual_owner_test');
        for (const channel of ['sms', 'email']) {
          const outcome = provider(channel);
          sqlite.prepare('INSERT INTO review_request_deliveries VALUES(?,?,?,?,?,?)').run(requestId, channel, outcome.accepted ? 'sent' : 'failed',
            `manual_owner_test_http_${outcome.httpStatus}_${outcome.accepted ? 'provider_accepted_delivery_not_confirmed' : outcome.error}`,
            OWNER_REVIEW_INLINE_LINK[channel === 'sms' ? 'phone' : 'email'], outcome.id);
        }
        if (transportFailure) throw new Error('fixture SECRET must not appear');
        return Response.json({ kind: 'manual_owner_test', workerVersion: versionId, requestId: returnedRequestId,
          recipients: { phone: OWNER_REVIEW_INLINE_LINK.phone, email: OWNER_REVIEW_INLINE_LINK.email },
          previewPageUrl: `${origin}/review/r/${returnedRequestId}/`, ogImageUrl: `${origin}/review/r/${returnedRequestId}/${responseImage}`,
          sms: { ...provider('sms'), untrusted: 'fixture SECRET must not appear' }, email: provider('email'), untrusted: 'fixture SECRET must not appear' });
      }
      if (url.endsWith('og.jpg')) {
        const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 2, 118, 4, 176, 1, 0xff, 0xd9]);
        return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } });
      }
      return new Response(`<meta property="og:image" content="${origin}/review/r/${requestId}/og.jpg">`);
    },
  };
  vm.runInNewContext(source, context, { filename: scriptPath });
  const read = name => [...files].find(([file]) => file.replaceAll('\\', '/').endsWith('/' + name))?.[1];
  return { run: () => context.ownerInlineLinkMain(), files, commands, requests, output, process: fakeProcess, sqlite, read,
    result: () => JSON.parse(read('result.json')) };
}

test('Inline link CLI approves the new job with all three previous jobs present and sends exactly one locked JPEG request', async () => {
  const f = fixture();
  await f.run();
  const posts = f.requests.filter(call => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `${origin}/api/review-requests/owner-inline-link/`);
  assert.deepEqual(JSON.parse(posts[0].options.body), { phone: OWNER_REVIEW_INLINE_LINK.phone, email: OWNER_REVIEW_INLINE_LINK.email });
  const bearer = posts[0].options.headers.Authorization.slice(7);
  assert.match(bearer, /^[a-f0-9]{64}$/);
  const sql = f.read('owner-inline-link-approval.sql');
  assert.ok(sql.includes(createHash('sha256').update(bearer).digest('hex')));
  assert.ok(sql.endsWith(`WHERE NOT EXISTS(SELECT 1 FROM review_requests WHERE job_id='${OWNER_REVIEW_INLINE_LINK.jobId}');\n`));
  assert.ok(!sql.includes(`job_id='${OWNER_REVIEW_TEST.jobId}'`));
  assert.ok(!sql.includes(`job_id='${OWNER_REVIEW_RETEST.jobId}'`));
  assert.ok(!sql.includes(`job_id='${OWNER_REVIEW_GOOGLE_LINK.jobId}'`));
  assert.deepEqual(f.sqlite.prepare('SELECT job_id FROM review_requests ORDER BY job_id').all().map(row => row.job_id),
    [OWNER_REVIEW_TEST, OWNER_REVIEW_RETEST, OWNER_REVIEW_GOOGLE_LINK, OWNER_REVIEW_INLINE_LINK].map(identity => identity.jobId).sort());
  assert.ok(sql.includes(`\"workerVersion\":\"${versionId}\"`));
  const expiresAt = /"expiresAt":"([^"]+)"/.exec(sql)?.[1];
  assert.ok(Date.parse(expiresAt) > Date.now() && Date.parse(expiresAt) <= Date.now() + 15 * 60_000);
  assert.ok([...f.files.keys()].every(file => path.resolve(file).startsWith(path.resolve(receiptDir) + path.sep)));
  assert.equal(f.read('receipt.md'), 'deployment receipt');
  assert.equal(f.read('report.md'), 'deployment report');
  for (const content of f.files.values()) assert.ok(!content.includes(bearer), 'bearer remains in memory');
  assert.ok(sql.includes(`\"requestId\":\"${requestId}\"`));
  assert.equal(f.result().commit, commit);
  assert.equal(f.result().sms.accepted, true); assert.equal(f.result().email.accepted, true);
  assert.equal(f.result().previewVerification.jpeg1200x630, true);
  assert.equal(f.result().previewVerification.personalizedOgTagPresent, true);
  assert.equal(f.result().previewVerification.noImageRobotsTag, true);
  assert.doesNotMatch(f.result().smsBody, /Reply STOP to opt out|Text STOP to unsubscribe/i);
  assert.ok(f.result().smsBody.includes('You can leave one here: ' + REVIEW_URL + ' '));
  assert.ok(f.result().smsBody.includes(REVIEW_URL));
  assert.doesNotMatch(f.result().smsBody, /ohiopetwastepros\.com\/review\//);
  assert.equal(f.commands.filter(args => args[1] === 'd1').length, 3, 'absence checked before approval and immediately before POST');
  assert.equal(f.process.exitCode, 0);
  assert.doesNotMatch(f.read('result.json') + f.read('future-send-receipt.md') + f.output.join(''), /fixture SECRET/);
  const original = f.read('future-send-receipt.md');
  await assert.rejects(f.run(), /owner_inline_link_attempt_already_recorded_no_retry/);
  assert.equal(f.requests.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(f.read('future-send-receipt.md'), original);
});

test('Inline link CLI requires fresh independent locked-recipient proof before any remote call', async t => {
  for (const options of [
    { missingProof: true }, { proof: { checkedAt: new Date(Date.now() - 5 * 60_000).toISOString() } },
    { proof: { checkedAt: new Date(Date.now() + 60_000).toISOString() } },
    { proof: { quoNoAdditionalReviewRequestsSinceThirdTest: false } }, { proof: { outlookNoAdditionalReviewEmailsSinceThirdTest: false } },
    { proof: { verificationBaseline: '2026-11-19T07:12:06Z' } }, { proof: { verificationBaseline: '2026-11-19T20:33:39Z' } },
    { proof: { recipients: { phone: OWNER_REVIEW_INLINE_LINK.phone, email: 'someone@example.com' } } },
    { proof: { jobId: OWNER_REVIEW_TEST.jobId } }, { proof: { jobId: OWNER_REVIEW_GOOGLE_LINK.jobId } }, { proof: { jobId: OWNER_REVIEW_RETEST.jobId } }, { proof: { recipients: { phone: '+12025550100', email: OWNER_REVIEW_INLINE_LINK.email } } },
  ]) await t.test(JSON.stringify(options), async () => {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.equal(f.commands.length, 0); assert.equal(f.requests.length, 0);
    assert.ok(!f.read('send-attempt.json'));
  });
  const f = fixture();
  f.process.argv[5] = 'C:/public-proof.json';
  await assert.rejects(f.run(), /private_delivery_verification_file_required/);
  assert.equal(f.commands.length, 0);
});

test('Inline link CLI aborts without POST on wrong version, duplicate ledger or a racing attempt', async t => {
  for (const options of [{ wrongVersion: true }, { priorRetest: true }, { raceRetest: true }]) await t.test(JSON.stringify(options), async () => {
    const f = fixture(options);
    await f.run();
    assert.equal(f.requests.length, 0); assert.equal(f.result().postAttempts, 0);
    assert.equal(f.process.exitCode, 1);
  });
});

test('Inline link CLI recovers uncertain HTTP outcome through SELECT only and never retries', async () => {
  const f = fixture({ transportFailure: true });
  await f.run();
  assert.equal(f.requests.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(f.result().sms.id, 'AC_fixture_retest');
  assert.equal(f.result().email.id, 'resend_fixture_retest');
  assert.equal(f.result().ledgerRecovery.found, true);
  assert.match(f.read('owner-inline-link-ledger-recovery.sql'), /^SELECT/);
  assert.doesNotMatch(f.read('result.json') + f.read('future-send-report.md'), /fixture SECRET/);
  await assert.rejects(f.run(), /owner_inline_link_attempt_already_recorded_no_retry/);
});

test('Inline link CLI retains rejection and refuses stale PNG response after send without repeating POST', async t => {
  for (const options of [{ rejected: true }, { responseImage: 'og.png' }, { returnedRequestId: 'invalid' }]) await t.test(JSON.stringify(options), async () => {
    const f = fixture(options);
    await f.run();
    assert.equal(f.requests.filter(call => call.options.method === 'POST').length, 1);
    assert.equal(f.process.exitCode, 1);
    if (options.rejected) { assert.equal(f.result().sms.httpStatus, 422); assert.equal(f.result().sms.accepted, false); }
    await assert.rejects(f.run(), /owner_inline_link_attempt_already_recorded_no_retry/);
  });
});


test('Inline link CLI requires a new fixed-name reservation before any remote call', async t => {
  for (const options of [
    { missingPreparation: true }, { preparation: { requestId: 'invalid' } },
    { preparation: { requestId: OWNER_REVIEW_TEST.completionRequestId } },
    { preparation: { requestId: '57c65e44-d4d1-4f2f-97c2-104227fa3727' } },
    { preparation: { requestId: '76891c15-8705-49d3-b22f-1c72e507873c' } },
    { preparation: { jobId: OWNER_REVIEW_GOOGLE_LINK.jobId } }, { preparation: { firstName: 'Other' } }, { preparation: { tech: 'Craig' } },
  ]) await t.test(JSON.stringify(options), async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), /private_future_send_preparation/);
    assert.equal(f.commands.length, 0); assert.equal(f.requests.length, 0);
    assert.ok(!f.read('send-attempt.json')); assert.ok(!f.read('result.json'));
    assert.equal(f.read('receipt.md'), 'deployment receipt'); assert.equal(f.read('report.md'), 'deployment report');
  });
});

test('Inline link CLI rejects a different valid response token and never repeats the POST', async () => {
  const f = fixture({ returnedRequestId: versionId });
  await f.run();
  assert.equal(f.requests.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(f.result().error, 'test_response_request_id_invalid');
  assert.equal(f.result().reservedRequestId, requestId);
  await assert.rejects(f.run(), /already_recorded_no_retry/);
  assert.equal(f.requests.filter(call => call.options.method === 'POST').length, 1);
});
