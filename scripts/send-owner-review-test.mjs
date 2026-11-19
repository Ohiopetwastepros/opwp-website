import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OWNER_REVIEW_TEST, assertOwnerReviewTestRecipients } from '../lib/review-request-owner-test.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const receiptDir = 'D:/Codex Projects/_agent-runs/2026-11-19-owner-review-test';
const origin = 'https://www.ohiopetwastepros.com';
const endpoint = `${origin}/api/review-requests/owner-test/`;
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
  // Captured CLI output can contain authentication details. Never echo it.
  if (result.status !== 0) throw new Error('wrangler_read_or_approval_failed');
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('wrangler_response_invalid'); }
}

function d1(sql, name) {
  const file = path.join(receiptDir, `${name}.sql`);
  fs.writeFileSync(file, sql + '\n', { flag: 'wx' });
  // --file uses Wrangler's bulk-import API and does not return SELECT rows.
  // Pass SQL as one spawnSync argument so JSON contains query results while
  // retaining the private SQL file as the local audit record.
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
  if (version.id !== expectedVersion) throw new Error('worker_version_mismatch');
  const bindings = version.resources?.bindings;
  if (!Array.isArray(bindings)) throw new Error('worker_bindings_unavailable');
  const plain = name => bindings.find(value => value.name === name && value.type === 'plain_text')?.text;
  const expected = {
    REVIEW_REQUESTS_ENABLED: 'false', QUO_FROM_NUMBER: OWNER_REVIEW_TEST.from,
    QUO_API_BASE_URL: 'https://api.openphone.com', SMS_PROVIDER: 'quo',
    EMAIL_PROVIDER: 'resend', EMAIL_SENDING_ENABLED: 'true', RESEND_API_BASE_URL: 'https://api.resend.com',
    SITE_ORIGIN: origin, WORKER_ORIGIN: origin,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (plain(name) !== value) throw new Error('production_preflight_configuration_mismatch');
  }
  if (String(plain('EMAIL_FROM') || '').toLowerCase() !== OWNER_REVIEW_TEST.email ||
      String(plain('OWNER_NOTIFICATION_EMAIL') || '').toLowerCase() !== OWNER_REVIEW_TEST.email) {
    throw new Error('production_email_configuration_mismatch');
  }
  if (!bindings.some(value => value.name === 'DB' && value.type === 'd1') ||
      !bindings.some(value => value.name === 'FIELD_PROOFS' && value.type === 'r2_bucket') ||
      !['QUO_API_KEY', 'RESEND_API_KEY'].every(name => bindings.some(value => value.name === name && value.type === 'secret_text'))) {
    throw new Error('required_worker_binding_missing');
  }
  return { workerVersion: version.id, activeAt100Percent: true, reviewRequestsEnabled: 'false', sourceAndProvidersVerified: true };
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

function safeResult(value, expectedVersion) {
  if (value?.kind !== 'manual_owner_test' || value.workerVersion !== expectedVersion) throw new Error('test_response_identity_mismatch');
  assertOwnerReviewTestRecipients(value.recipients);
  if (!uuid.test(value.requestId || '')) throw new Error('test_response_request_id_invalid');
  const page = `${origin}/review/r/${value.requestId}/`;
  if (value.previewPageUrl !== page || value.ogImageUrl !== `${page}og.png`) throw new Error('test_response_preview_invalid');
  return {
    kind: 'manual_owner_test', workerVersion: expectedVersion,
    recipients: { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email },
    requestId: value.requestId, previewPageUrl: page, ogImageUrl: `${page}og.png`,
    sms: safeProvider(value.sms), email: safeProvider(value.email),
  };
}

function recoverLedgerOutcome(result) {
  const response = d1(`SELECT r.id AS request_id,r.job_type,d.channel,d.status,d.reason,d.provider_message_id FROM review_requests r LEFT JOIN review_request_deliveries d ON d.request_id=r.id WHERE r.job_id=${quoteSql(OWNER_REVIEW_TEST.jobId)} LIMIT 3;`, 'owner-test-ledger-recovery');
  const rows = response?.[0]?.results;
  if (!Array.isArray(rows) || !rows.length) return { found: false, readOnly: true };
  const requestId = rows[0].request_id;
  if (!uuid.test(requestId || '') || rows.length > 2 || rows.some(row => row.request_id !== requestId || row.job_type !== 'manual_owner_test')) {
    throw new Error('ledger_recovery_identity_invalid');
  }
  result.requestId = requestId;
  result.previewPageUrl = `${origin}/review/r/${requestId}/`;
  result.ogImageUrl = `${result.previewPageUrl}og.png`;
  for (const row of rows) {
    if (!['sms', 'email'].includes(row.channel)) continue;
    const reason = String(row.reason || '');
    const match = /^manual_owner_test_http_(\d{3}|none)_(.*)$/.exec(reason);
    const httpStatus = match && match[1] !== 'none' ? Number(match[1]) : null;
    const accepted = row.status === 'sent' ? true : row.status === 'failed' && !reason.includes('uncertain') ? false : null;
    result[row.channel] = safeProvider({ accepted, httpStatus, id: row.provider_message_id,
      status: accepted === true ? 'provider_accepted_delivery_not_confirmed' : accepted === false ? 'failed' : 'acceptance_uncertain',
      error: accepted === true ? null : match?.[2] || reason.replace(/^manual_owner_test_/, '') });
    result[row.channel].recoveredFromLedger = true;
  }
  return { found: true, readOnly: true };
}

async function verifyPreview(result) {
  const page = await fetch(result.previewPageUrl, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const html = new TextDecoder().decode(await boundedBytes(page, 1024 * 1024));
  const image = await fetch(result.ogImageUrl, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const bytes = await boundedBytes(image, 4 * 1024 * 1024);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = bytes.length >= 24 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {
    pageHttpStatus: page.status, imageHttpStatus: image.status,
    personalizedOgTagPresent: page.ok && /property="og:image"/.test(html) && html.includes(result.ogImageUrl),
    imageContentType: image.headers.get('content-type') === 'image/png' ? 'image/png' : 'unexpected',
    png1200x630: image.ok && png && view.getUint32(16) === 1200 && view.getUint32(20) === 630,
  };
}

function writeReceipt(result) {
  const status = value => value?.accepted === true ? 'Accepted' : value?.accepted === false ? 'Rejected' : 'Unknown / not confirmed';
  const lines = [
    '# Owner review-request test receipt', '',
    `Timestamp (America/New_York): ${eastern(result.timestamp)}`,
    `Timestamp (UTC): ${result.timestamp}`,
    `SMS recipient: ${OWNER_REVIEW_TEST.phone}`,
    `Email recipient: ${OWNER_REVIEW_TEST.email}`,
    `SMS source: ${OWNER_REVIEW_TEST.from} (Quo phone id ${OWNER_REVIEW_TEST.phoneId})`,
    `Worker version: ${result.workerVersion}`,
    `REVIEW_REQUESTS_ENABLED: ${result.preflight?.reviewRequestsEnabled || 'not verified'}`,
    `Test endpoint HTTP: ${result.endpointHttpStatus ?? 'no response'}`,
    `Quo message id: ${result.sms?.id || 'not returned'}`,
    `Quo acceptance: ${status(result.sms)}; HTTP ${result.sms?.httpStatus ?? 'not returned'}; status ${result.sms?.status || 'not returned'}`,
    `Resend id: ${result.email?.id || 'not returned'}`,
    `Resend acceptance: ${status(result.email)}; HTTP ${result.email?.httpStatus ?? 'not returned'}; status ${result.email?.status || 'not returned'}`,
    `Live preview page URL: ${result.previewPageUrl || 'not returned'}`,
    `og:image URL: ${result.ogImageUrl || 'not returned'}`,
    `POST attempts: ${result.postAttempts}`,
    ...(result.ledgerRecovery ? [`Read-only ledger recovery: ${result.ledgerRecovery.found === true ? 'provider results recovered' : 'provider results not recovered'}`] : []),
    ...(result.error ? [`Error: ${result.error}`] : []),
    ...(result.sms?.error ? [`Quo error: ${result.sms.error}`] : []),
    ...(result.email?.error ? [`Resend error: ${result.email.error}`] : []),
    '', 'This is a manual owner test. Provider acceptance does not confirm device or inbox delivery.',
    'No provider retries or alternate destinations are permitted.', '',
  ];
  fs.writeFileSync(path.join(receiptDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(receiptDir, 'receipt.md'), lines.join('\n'));
  fs.writeFileSync(path.join(receiptDir, 'report.md'), [
    '# Owner review-request test report', '',
    `Recorded ${eastern(result.timestamp)} (America/New_York).`, '',
    `Worker: ${result.workerVersion}. Global review automation flag: ${result.preflight?.reviewRequestsEnabled || 'not verified'}.`,
    `One locked test POST was permitted; actual POST attempts: ${result.postAttempts}.`,
    `Quo: ${status(result.sms)}. Resend: ${status(result.email)}.`,
    'Recipients and source line are fixed in code. The test is identified separately in the review-request ledger.',
    'The CLI writes only a short-lived one-off approval record; it does not write Worker vars, secrets or migrations.',
    result.previewVerification ? `Read-only preview verification: ${JSON.stringify(result.previewVerification)}.` : 'Preview verification was not completed.',
    ...(result.ledgerRecovery ? [`Read-only ledger recovery: ${JSON.stringify(result.ledgerRecovery)}.`] : []),
    ...(result.error ? [`Error: ${result.error}. No automatic retry was attempted.`] : []),
    '', 'See receipt.md and result.json for provider IDs, HTTP statuses and live URLs.', '',
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--worker-version' || !uuid.test(args[1])) {
    throw new Error('usage_node_scripts_send_owner_review_test_mjs_worker_version_UUID');
  }
  fs.mkdirSync(receiptDir, { recursive: true });
  // An earlier uncertain attempt is terminal. Never replace its receipt or token.
  if (fs.existsSync(attemptPath)) throw new Error('owner_test_attempt_already_recorded_no_retry');
  const result = { timestamp: new Date().toISOString(), workerVersion: args[1], postAttempts: 0,
    recipients: { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email } };
  try {
    assertOwnerReviewTestRecipients(result.recipients);
    result.preflight = assertSafeProductionVersion(result.workerVersion);
    const preflight = d1(`SELECT (SELECT COUNT(*) FROM review_requests WHERE job_id=${quoteSql(OWNER_REVIEW_TEST.jobId)}) AS prior_requests, (SELECT COUNT(*) FROM airtable_cockpit_snapshots WHERE snapshot_key=${quoteSql(OWNER_REVIEW_TEST.approvalKey)}) AS prior_approvals;`, `preflight-${Date.now()}`);
    const row = preflight?.[0]?.results?.[0];
    if (row?.prior_requests !== 0 || row?.prior_approvals !== 0) throw new Error('owner_test_or_approval_already_exists_no_retry');
    fs.writeFileSync(attemptPath, JSON.stringify({ kind: 'manual_owner_test', timestamp: result.timestamp,
      workerVersion: result.workerVersion, recipients: result.recipients, retryAllowed: false }, null, 2) + '\n', { flag: 'wx' });
    const bearer = randomBytes(32).toString('hex');
    const approval = JSON.stringify({ tokenHash: createHash('sha256').update(bearer).digest('hex'),
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), workerVersion: result.workerVersion });
    const inserted = d1(`INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) SELECT ${quoteSql(OWNER_REVIEW_TEST.approvalKey)},${quoteSql(approval)},'success',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM review_requests WHERE job_id=${quoteSql(OWNER_REVIEW_TEST.jobId)});`, 'owner-test-approval');
    if (inserted?.[0]?.meta?.changes !== 1) throw new Error('one_off_approval_not_inserted_no_send');
    // Recheck production after the approval write. No POST may target a newer or
    // partially rolled-out Worker, even if a deployment raced with preflight.
    assertSafeProductionVersion(result.workerVersion);
    result.postAttempts = 1;
    result.postInitiatedAt = new Date().toISOString();
    fs.writeFileSync(attemptPath, JSON.stringify({ kind: 'manual_owner_test', timestamp: result.timestamp,
      postInitiatedAt: result.postInitiatedAt, workerVersion: result.workerVersion,
      recipients: result.recipients, retryAllowed: false }, null, 2) + '\n');
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${bearer}`, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(result.recipients),
    });
    result.endpointHttpStatus = response.status;
    const bytes = await boundedBytes(response, 64 * 1024);
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error('test_endpoint_non_json_response_no_retry'); }
    if (!response.ok) throw new Error(`test_endpoint_rejected_http_${response.status}_no_retry`);
    Object.assign(result, safeResult(data, result.workerVersion));
    try { result.previewVerification = await verifyPreview(result); }
    catch { result.previewVerification = { error: 'read_only_preview_verification_failed' }; }
    if (!result.sms.accepted || !result.email.accepted) result.error = 'one_or_more_providers_did_not_confirm_acceptance_no_retry';
  } catch (error) {
    result.error = typeof error?.message === 'string' && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'owner_test_failed_no_retry';
    if (result.postAttempts === 1) {
      // A timed-out request may still have reached both providers. Recover only
      // the fixed manual test's receipt. This SELECT never queues or sends.
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
  console.log(JSON.stringify({ receipt: path.join(receiptDir, 'receipt.md'), workerVersion: result.workerVersion,
    postAttempts: result.postAttempts, smsAccepted: result.sms?.accepted ?? null, emailAccepted: result.email?.accepted ?? null,
    ...(result.error ? { error: result.error } : {}) }));
  if (result.error) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const reason = typeof error?.message === 'string' && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'owner_test_refused_or_unavailable';
    console.error(`${reason}; no automatic retry is permitted.`);
    process.exitCode = 1;
  });
}
