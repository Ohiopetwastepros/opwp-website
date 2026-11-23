import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OWNER_REVIEW_TEST, OWNER_REVIEW_GOOGLE_LINK, assertOwnerReviewTestRecipients } from '../lib/review-request-owner-test.mjs';
import { buildReviewRequestSms } from '../lib/review-request-content.mjs';

// Future coordinator invocation only, after independent duplicate verification:
// node scripts/send-owner-review-google-link.mjs --worker-version UUID --verification-file PRIVATE_PATH
// PRIVATE_PATH must be inside receiptDir and contain checkedAt, this jobId,
// fixed recipients, verificationBaseline, and both no-additional-delivery booleans
// checked below. This script inserts one approval and can POST at most once.
const root = fileURLToPath(new URL('../', import.meta.url));
const receiptDir = 'D:/Codex Projects/_agent-runs/2026-11-19-review-google-link';
const origin = 'https://www.ohiopetwastepros.com';
const endpoint = `${origin}/api/review-requests/owner-google-link/`;
// This future send keeps deployment receipt.md/report.md intact.
const verificationBaseline = '2026-11-19T20:33:39Z';
const attemptPath = path.join(receiptDir, 'send-attempt.json');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const quoteSql = value => "'" + String(value).replaceAll("'", "''") + "'";
const eastern = value => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
}).format(new Date(value));

function wrangler(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Raw CLI output can contain authentication details; never echo it.
  if (result.status !== 0) throw new Error('wrangler_read_or_approval_failed');
  try { return JSON.parse(result.stdout); } catch { throw new Error('wrangler_response_invalid'); }
}

function d1(sql, name) {
  fs.writeFileSync(path.join(receiptDir, `${name}.sql`), sql + '\n', { flag: 'wx' });
  // The query API returns SELECT rows, unlike Wrangler's bulk --file API.
  return wrangler(['d1', 'execute', 'opwp-backend', '--remote', '--command', sql, '--yes', '--json']);
}

function assertSafeProductionVersion(expectedVersion) {
  const deployments = wrangler(['deployments', 'list', '--json']);
  if (!Array.isArray(deployments) || !deployments.length) throw new Error('deployment_not_found');
  const active = [...deployments].sort((a, b) => String(a.created_on).localeCompare(String(b.created_on))).at(-1);
  if (active.versions?.length !== 1 || active.versions[0].version_id !== expectedVersion || active.versions[0].percentage !== 100) {
    throw new Error('expected_worker_not_active_at_100_percent');
  }
  const version = wrangler(['versions', 'view', expectedVersion, '--json']);
  const bindings = version.resources?.bindings;
  if (version.id !== expectedVersion || !Array.isArray(bindings)) throw new Error('worker_version_or_bindings_mismatch');
  const plain = name => bindings.find(value => value.name === name && value.type === 'plain_text')?.text;
  for (const [name, value] of Object.entries({
    REVIEW_REQUESTS_ENABLED: 'false', QUO_FROM_NUMBER: OWNER_REVIEW_GOOGLE_LINK.from,
    QUO_API_BASE_URL: 'https://api.openphone.com', SMS_PROVIDER: 'quo',
    EMAIL_PROVIDER: 'resend', EMAIL_SENDING_ENABLED: 'true', RESEND_API_BASE_URL: 'https://api.resend.com',
    SITE_ORIGIN: origin, WORKER_ORIGIN: origin,
  })) if (plain(name) !== value) throw new Error('production_preflight_configuration_mismatch');
  if (String(plain('EMAIL_FROM') || '').toLowerCase() !== OWNER_REVIEW_GOOGLE_LINK.email ||
      String(plain('OWNER_NOTIFICATION_EMAIL') || '').toLowerCase() !== OWNER_REVIEW_GOOGLE_LINK.email) {
    throw new Error('production_email_configuration_mismatch');
  }
  if (!bindings.some(value => value.name === 'DB' && value.type === 'd1') ||
      !bindings.some(value => value.name === 'FIELD_PROOFS' && value.type === 'r2_bucket') ||
      !['QUO_API_KEY', 'RESEND_API_KEY'].every(name => bindings.some(value => value.name === name && value.type === 'secret_text'))) {
    throw new Error('required_worker_binding_missing');
  }
  return { workerVersion: version.id, activeAt100Percent: true, reviewRequestsEnabled: 'false', sourceAndProvidersVerified: true };
}

function assertFreshDeliveryVerification(proof) {
  const age = Date.now() - Date.parse(proof?.checkedAt);
  assertOwnerReviewTestRecipients(proof?.recipients);
  if (!Number.isFinite(age) || age < 0 || age >= 5 * 60_000 || proof.jobId !== OWNER_REVIEW_GOOGLE_LINK.jobId ||
      proof.verificationBaseline !== verificationBaseline ||
      proof.quoNoAdditionalReviewRequestsSinceSecondTest !== true || proof.outlookNoAdditionalReviewEmailsSinceSecondTest !== true) {
    throw new Error('fresh_independent_delivery_verification_required');
  }
  return { checkedAt: proof.checkedAt, jobId: OWNER_REVIEW_GOOGLE_LINK.jobId,
    recipients: { phone: OWNER_REVIEW_GOOGLE_LINK.phone, email: OWNER_REVIEW_GOOGLE_LINK.email },
    verificationBaseline, quoNoAdditionalReviewRequestsSinceSecondTest: true, outlookNoAdditionalReviewEmailsSinceSecondTest: true };
}

function readDeliveryVerification(file) {
  if (!path.isAbsolute(file || '') || !path.resolve(file).startsWith(path.resolve(receiptDir) + path.sep)) {
    throw new Error('private_delivery_verification_file_required');
  }
  return assertFreshDeliveryVerification(JSON.parse(fs.readFileSync(file, 'utf8')));
}


function readPreparation() {
  let preparation;
  try { preparation = JSON.parse(fs.readFileSync(path.join(receiptDir, 'future-send-preparation.json'), 'utf8')); }
  catch { throw new Error('private_future_send_preparation_required'); }
  if (!uuid.test(preparation?.requestId || '') || preparation.requestId === OWNER_REVIEW_TEST.completionRequestId ||
      preparation.requestId === '57c65e44-d4d1-4f2f-97c2-104227fa3727' || preparation.firstName !== 'Craig' || preparation.tech !== 'Tony') {
    throw new Error('private_future_send_preparation_invalid');
  }
  return { requestId: preparation.requestId, firstName: 'Craig', tech: 'Tony' };
}

function assertUnattempted(name, expectedApprovals) {
  const response = d1(`SELECT (SELECT COUNT(*) FROM review_requests WHERE job_id=${quoteSql(OWNER_REVIEW_GOOGLE_LINK.jobId)}) AS prior_requests, (SELECT COUNT(*) FROM review_request_deliveries d JOIN review_requests r ON r.id=d.request_id WHERE r.job_id=${quoteSql(OWNER_REVIEW_GOOGLE_LINK.jobId)} AND d.provider_message_id IS NOT NULL) AS provider_ids, (SELECT COUNT(*) FROM airtable_cockpit_snapshots WHERE snapshot_key=${quoteSql(OWNER_REVIEW_GOOGLE_LINK.approvalKey)}) AS prior_approvals;`, name);
  const row = response?.[0]?.results?.[0];
  if (row?.prior_requests !== 0 || row?.provider_ids !== 0 || row?.prior_approvals !== expectedApprovals) {
    throw new Error('owner_google_link_or_approval_already_exists_no_send');
  }
}

async function boundedBytes(response, limit) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('response_size_limit');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function safeProvider(value) {
  return {
    accepted: typeof value?.accepted === 'boolean' ? value.accepted : null,
    httpStatus: Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null,
    status: typeof value?.status === 'string' && /^[a-z0-9_:-]{1,100}$/.test(value.status) ? value.status : null,
    id: typeof value?.id === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value.id) ? value.id : null,
    error: typeof value?.error === 'string' && /^[a-z0-9_:-]{1,100}$/.test(value.error) ? value.error : null,
  };
}

function setRequest(result, requestId) {
  if (!uuid.test(requestId || '') || (result.reservedRequestId && requestId !== result.reservedRequestId)) throw new Error('test_response_request_id_invalid');
  result.requestId = requestId;
  result.previewPageUrl = `${origin}/review/r/${requestId}/`;
  result.ogImageUrl = `${result.previewPageUrl}og.jpg`;
  result.smsBody = buildReviewRequestSms({ template: 'initial-cleanup', firstName: 'Craig', tech: 'Tony', previewToken: requestId });
}

function safeResult(value, expectedVersion, reservedRequestId) {
  if (value?.kind !== 'manual_owner_test' || value.workerVersion !== expectedVersion) throw new Error('test_response_identity_mismatch');
  assertOwnerReviewTestRecipients(value.recipients);
  const result = { reservedRequestId };
  setRequest(result, value.requestId);
  if (value.previewPageUrl !== result.previewPageUrl || value.ogImageUrl !== result.ogImageUrl) throw new Error('test_response_preview_invalid');
  return { ...result, kind: 'manual_owner_test', sms: safeProvider(value.sms), email: safeProvider(value.email) };
}

function recoverLedgerOutcome(result) {
  const response = d1(`SELECT r.id AS request_id,r.job_type,d.channel,d.status,d.reason,d.recipient,d.provider_message_id FROM review_requests r LEFT JOIN review_request_deliveries d ON d.request_id=r.id WHERE r.job_id=${quoteSql(OWNER_REVIEW_GOOGLE_LINK.jobId)} LIMIT 3;`, 'owner-google-link-ledger-recovery');
  const rows = response?.[0]?.results;
  if (!Array.isArray(rows) || !rows.length) return { found: false, readOnly: true };
  const requestId = rows[0].request_id;
  if (rows.length > 2 || rows.some(row => row.request_id !== requestId || row.job_type !== 'manual_owner_test')) throw new Error('ledger_recovery_identity_invalid');
  setRequest(result, requestId);
  for (const row of rows) {
    if (!['sms', 'email'].includes(row.channel)) continue;
    if (row.recipient !== OWNER_REVIEW_GOOGLE_LINK[row.channel === 'sms' ? 'phone' : 'email']) throw new Error('ledger_recovery_recipient_invalid');
    const reason = String(row.reason || '');
    const match = /^manual_owner_test_http_(\d{3}|none)_(.*)$/.exec(reason);
    const uncertain = /uncertain|provider_(?:network|timeout|internal|missing_provider_id|rejected_or_missing_id)(?:_|$)|missing_provider_id/.test(reason);
    const accepted = row.status === 'sent' ? true : row.status === 'failed' && !uncertain ? false : null;
    result[row.channel] = { ...safeProvider({ accepted, httpStatus: match && match[1] !== 'none' ? Number(match[1]) : null,
      id: row.provider_message_id, status: accepted === true ? 'provider_accepted_delivery_not_confirmed' : accepted === false ? 'failed' : 'acceptance_uncertain',
      error: accepted === true ? null : match?.[2] || reason.replace(/^manual_owner_test_/, '') }), recoveredFromLedger: true };
  }
  return { found: true, readOnly: true };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 3 < bytes.length;) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) return { height: bytes[offset + 3] * 256 + bytes[offset + 4], width: bytes[offset + 5] * 256 + bytes[offset + 6] };
    offset += length;
  }
  return null;
}

async function verifyPreview(result) {
  const options = { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'facebookexternalhit/1.1 Facebot Twitterbot/1.0' } };
  const page = await fetch(result.previewPageUrl, options);
  const html = new TextDecoder().decode(await boundedBytes(page, 1024 * 1024));
  const image = await fetch(result.ogImageUrl, { ...options, signal: AbortSignal.timeout(20000) });
  const bytes = await boundedBytes(image, 1_000_000);
  const dimensions = jpegDimensions(bytes);
  return { pageHttpStatus: page.status, imageHttpStatus: image.status,
    personalizedOgTagPresent: page.ok && /property="og:image"/.test(html) && html.includes(result.ogImageUrl),
    imageContentType: image.headers.get('content-type'), imageBytes: bytes.byteLength,
    jpeg1200x630: image.ok && image.headers.get('content-type') === 'image/jpeg' && dimensions?.width === 1200 && dimensions?.height === 630,
    noImageRobotsTag: !image.headers.has('x-robots-tag') };
}

function commitId() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(result.stdout.trim())) throw new Error('commit_unavailable');
  return result.stdout.trim();
}

function writeReceipt(result) {
  const acceptance = value => value?.accepted === true ? 'Accepted' : value?.accepted === false ? 'Rejected or not attempted' : 'Unknown';
  const lines = [
    '# Owner review-request direct Google link send receipt', '',
    `Timestamp (America/New_York): ${eastern(result.timestamp)}`, `Timestamp (UTC): ${result.timestamp}`,
    `Job id: ${OWNER_REVIEW_GOOGLE_LINK.jobId}`, `Commit: ${result.commit}`, `Worker version: ${result.workerVersion}`,
    `SMS recipient: ${OWNER_REVIEW_GOOGLE_LINK.phone}`, `Email recipient: ${OWNER_REVIEW_GOOGLE_LINK.email}`,
    `SMS source: ${OWNER_REVIEW_GOOGLE_LINK.from} (Quo phone id ${OWNER_REVIEW_GOOGLE_LINK.phoneId})`,
    `REVIEW_REQUESTS_ENABLED: ${result.preflight?.reviewRequestsEnabled || 'not verified'}`,
    `Test endpoint HTTP: ${result.endpointHttpStatus ?? 'no response'}`, `POST attempts: ${result.postAttempts}`,
    ...(result.postInitiatedAt ? [`POST initiated (America/New_York): ${eastern(result.postInitiatedAt)}`, `POST initiated (UTC): ${result.postInitiatedAt}`] : []),
    `Quo message id: ${result.sms?.id || 'not returned'}; HTTP ${result.sms?.httpStatus ?? 'not returned'}; ${acceptance(result.sms)}`,
    `Resend id: ${result.email?.id || 'not returned'}; HTTP ${result.email?.httpStatus ?? 'not returned'}; ${acceptance(result.email)}`,
    ...(result.sms?.error ? [`Quo error: ${result.sms.error}`] : []),
    ...(result.email?.error ? [`Resend error: ${result.email.error}`] : []),
    `Live preview page URL: ${result.previewPageUrl || 'not returned'}`, `og:image URL: ${result.ogImageUrl || 'not returned'}`,
    ...(result.smsBody ? ['', 'Exact SMS body:', '', '```text', result.smsBody, '```'] : []),
    ...(result.error ? ['', `Error: ${result.error}`] : []), '',
    'No provider retries or alternate recipients are permitted. Provider acceptance does not confirm device or inbox delivery.', '',
  ];
  fs.writeFileSync(path.join(receiptDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(receiptDir, 'future-send-receipt.md'), lines.join('\n'), { flag: 'wx' });
  // Preserve this change's deployment receipt.md/report.md as separate evidence.
  fs.writeFileSync(path.join(receiptDir, 'future-send-report.md'), [...lines,
    `Fresh independent pre-send verification: ${JSON.stringify(result.deliveryVerification || null)}`,
    `Read-only preview verification: ${JSON.stringify(result.previewVerification || null)}`,
    `Read-only ledger recovery: ${JSON.stringify(result.ledgerRecovery || null)}`,
    'The first and second owner tests and their evidence were not changed. This CLI writes one short-lived approval for the third job; no Worker configuration or migrations.', '',
  ].join('\n'), { flag: 'wx' });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--worker-version' || !uuid.test(args[1]) || args[2] !== '--verification-file' || !args[3]) {
    throw new Error('usage_worker_version_UUID_verification_file_PRIVATE_PATH');
  }
  fs.mkdirSync(receiptDir, { recursive: true });
  if (fs.existsSync(attemptPath) || fs.existsSync(path.join(receiptDir, 'result.json'))) throw new Error('owner_google_link_attempt_already_recorded_no_retry');
  const preparation = readPreparation();
  const deliveryVerification = readDeliveryVerification(args[3]);
  const result = { kind: 'manual_owner_test', jobId: OWNER_REVIEW_GOOGLE_LINK.jobId, timestamp: new Date().toISOString(),
    commit: commitId(), workerVersion: args[1], postAttempts: 0, deliveryVerification, reservedRequestId: preparation.requestId,
    recipients: { phone: OWNER_REVIEW_GOOGLE_LINK.phone, email: OWNER_REVIEW_GOOGLE_LINK.email } };
  try {
    result.preflight = assertSafeProductionVersion(result.workerVersion);
    assertUnattempted('owner-google-link-preflight', 0);
    // A durable exclusive marker makes every later failure terminal for this CLI.
    fs.writeFileSync(attemptPath, JSON.stringify({ ...result, retryAllowed: false }, null, 2) + '\n', { flag: 'wx' });
    const bearer = randomBytes(32).toString('hex');
    const approval = JSON.stringify({ tokenHash: createHash('sha256').update(bearer).digest('hex'),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), workerVersion: result.workerVersion, requestId: preparation.requestId, deliveryVerification });
    const inserted = d1(`INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) SELECT ${quoteSql(OWNER_REVIEW_GOOGLE_LINK.approvalKey)},${quoteSql(approval)},'success',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM review_requests WHERE job_id=${quoteSql(OWNER_REVIEW_GOOGLE_LINK.jobId)});`, 'owner-google-link-approval');
    if (inserted?.[0]?.meta?.changes !== 1) throw new Error('one_off_approval_not_inserted_no_send');
    assertSafeProductionVersion(result.workerVersion);
    assertUnattempted('owner-google-link-immediate-prepost', 1);
    assertFreshDeliveryVerification(readDeliveryVerification(args[3]));
    result.postAttempts = 1;
    result.postInitiatedAt = new Date().toISOString();
    fs.writeFileSync(attemptPath, JSON.stringify({ ...result, retryAllowed: false }, null, 2) + '\n');
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${bearer}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(result.recipients) });
    result.endpointHttpStatus = response.status;
    let data;
    try { data = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 64 * 1024))); }
    catch { throw new Error('test_endpoint_non_json_response_no_retry'); }
    if (!response.ok) throw new Error(`test_endpoint_rejected_http_${response.status}_no_retry`);
    Object.assign(result, safeResult(data, result.workerVersion, preparation.requestId));
    try { result.previewVerification = await verifyPreview(result); }
    catch { result.previewVerification = { error: 'read_only_preview_verification_failed' }; }
    if (!result.sms.accepted || !result.email.accepted) result.error = 'one_or_more_providers_did_not_confirm_acceptance_no_retry';
  } catch (error) {
    result.error = typeof error?.message === 'string' && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'owner_google_link_failed_no_retry';
    if (result.postAttempts === 1) {
      try { result.ledgerRecovery = recoverLedgerOutcome(result); }
      catch { result.ledgerRecovery = { found: null, readOnly: true, error: 'ledger_recovery_unavailable' }; }
      if (result.previewPageUrl) {
        try { result.previewVerification = await verifyPreview(result); }
        catch { result.previewVerification = { error: 'read_only_preview_verification_failed' }; }
      }
    }
  }
  result.completedAt = new Date().toISOString();
  writeReceipt(result);
  console.log(JSON.stringify({ receipt: path.join(receiptDir, 'future-send-receipt.md'), workerVersion: result.workerVersion,
    postAttempts: result.postAttempts, smsAccepted: result.sms?.accepted ?? null, emailAccepted: result.email?.accepted ?? null,
    ...(result.error ? { error: result.error } : {}) }));
  if (result.error) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const reason = typeof error?.message === 'string' && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'owner_google_link_refused_or_unavailable';
    console.error(`${reason}; no automatic retry is permitted.`);
    process.exitCode = 1;
  });
}
