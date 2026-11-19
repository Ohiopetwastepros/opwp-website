import { buildReviewRequestSms, buildReviewRequestEmail, REVIEW_SITE_ORIGIN, reviewRequestPageUrl, reviewRequestImageUrl } from './review-request-content.mjs';
import { reviewRequestTemplateVersion } from './review-request-templates.mjs';
import { prepareReviewPreview, getReviewPreview } from './review-previews.mjs';
import { reviewHash, reviewEasternDate } from './review-request-policy.mjs';
import { validReviewPreviewToken } from './review-preview-token.mjs';

// These are explicitly authorized owner tests, never customer queue jobs.
// Changing a destination or allowing another run requires a source change.
export const OWNER_REVIEW_TEST = Object.freeze({
  phone: '+14192620424', email: 'craig@ohiopetwastepros.com',
  from: '+14192622371', phoneId: 'PNMNGRvTTx',
  jobId: 'manual-owner-review-test-2026-11-19',
  approvalKey: 'manual_owner_review_test:2026-11-19',
  completionRequestId: '61f7de2b-f6b6-4c2c-ace5-726424736168',
});

// Separate consume-once capability for the approved iOS preview retest.
export const OWNER_REVIEW_RETEST = Object.freeze({
  phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email,
  from: OWNER_REVIEW_TEST.from, phoneId: OWNER_REVIEW_TEST.phoneId,
  jobId: 'manual-owner-review-test-2026-11-19-ios-preview',
  approvalKey: 'manual_owner_review_test:2026-11-19-ios-preview',
});

// Dynamic imports preserve the shared production implementations while keeping
// this capability module usable by the standalone, read-only CLI preflight.
async function sendSms(...args) { return (await import('./quote-follow-up-delivery.js')).sendQuoText(...args); }
async function sendEmail(...args) { return (await import('./submission-notifications.js')).sendTransactionalEmail(...args); }
async function verifyExistingPreview(env, { token }) { return getReviewPreview(env, token); }

function freshDeliveryVerification(proof, now) {
  const age = new Date(now).getTime() - Date.parse(proof?.checkedAt);
  return Number.isFinite(age) && age >= 0 && age < 5 * 60_000 &&
    proof.quoNoMessagesAfter0600Z === true && proof.outlookNoReviewEmail === true && proof.gmailNoReviewEmail === true;
}

function fail(message, status = 503) {
  const error = new Error(message); error.status = status; throw error;
}

export function assertOwnerReviewTestRecipients({ phone, email } = {}) {
  if (phone !== OWNER_REVIEW_TEST.phone || typeof email !== 'string' || email.toLowerCase() !== OWNER_REVIEW_TEST.email) {
    fail('owner_test_recipient_not_allowlisted', 400);
  }
  return { phone: OWNER_REVIEW_TEST.phone, email: OWNER_REVIEW_TEST.email };
}

function sameDigest(a, b) {
  if (!/^[a-f0-9]{64}$/.test(a || '') || !/^[a-f0-9]{64}$/.test(b || '')) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function runLockedOwnerReviewTest(identity, env, { phone, email, authorization, now = new Date() } = {}, {
  preparePreview = prepareReviewPreview, verifyPreview = verifyExistingPreview, fetchProvider = fetch,
  sendSms: dispatchSms = sendSms, sendEmail: dispatchEmail = sendEmail,
} = {}) {
  const dispatchStartedAt = Date.now();
  const recipients = assertOwnerReviewTestRecipients({ phone, email });
  const bearer = /^Bearer ([a-f0-9]{64})$/.exec(authorization || '')?.[1];
  if (!bearer) fail('owner_test_unauthorized', 401);
  if (env?.REVIEW_REQUESTS_ENABLED !== 'false') fail('owner_test_requires_automation_disabled', 403);
  if (!env.DB || !env.FIELD_PROOFS || !env.QUO_API_KEY || !env.RESEND_API_KEY ||
      env.SMS_PROVIDER !== 'quo' || env.QUO_FROM_NUMBER !== identity.from ||
      env.QUO_API_BASE_URL !== 'https://api.openphone.com' || env.RESEND_API_BASE_URL !== 'https://api.resend.com' ||
      env.EMAIL_PROVIDER !== 'resend' || env.EMAIL_SENDING_ENABLED !== 'true' ||
      String(env.EMAIL_FROM || '').toLowerCase() !== identity.email) fail('owner_test_configuration_mismatch');
  const db = env.DB;
  const approvalRow = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(identity.approvalKey).first();
  let approval;
  try { approval = JSON.parse(approvalRow?.payload || '{}'); } catch { fail('owner_test_unauthorized', 401); }
  if (!sameDigest(approval.tokenHash, await reviewHash(bearer))) fail('owner_test_unauthorized', 401);
  if (identity === OWNER_REVIEW_RETEST && ['preparationContinuation', 'verifiedUnsentCompletion', 'resumeRequestId'].some(key => Object.hasOwn(approval, key))) {
    fail('owner_test_retest_continuation_forbidden', 409);
  }
  const timestamp = new Date(now).toISOString();
  const remaining = Date.parse(approval.expiresAt) - Date.parse(timestamp);
  if (!(remaining > 0 && remaining <= 15 * 60_000) || !approval.workerVersion || approval.workerVersion !== env.CF_VERSION_METADATA?.id) fail('owner_test_approval_expired_or_wrong_version', 403);
  const previous = await db.prepare('SELECT * FROM review_requests WHERE job_id=?').bind(identity.jobId).first();
  const completing = approval.verifiedUnsentCompletion === true;
  const continuing = approval.preparationContinuation === true || completing;
  let priorPayload, priorRows;
  const sourceFailure = completing ? 'manual_owner_test_http_none_provider_acceptance_uncertain_verify_before_retry' : 'manual_owner_test_http_none_source_line_verification_failed';
  if (completing && (approval.preparationContinuation === true || approval.resumeRequestId !== identity.completionRequestId ||
      !freshDeliveryVerification(approval.deliveryVerification, timestamp))) fail('owner_test_verified_unsent_completion_forbidden', 409);
  if (previous && !continuing) fail('owner_test_already_attempted', 409);
  if (continuing) {
    try { priorPayload = JSON.parse(previous?.payload || '{}'); } catch { fail('owner_test_preparation_continuation_forbidden', 409); }
    if (!previous || !validReviewPreviewToken(previous.id) || previous.id !== approval.resumeRequestId || previous.job_type !== 'manual_owner_test' || previous.customer_key !== null ||
        priorPayload.kind !== 'manual_owner_test' || priorPayload.firstName !== 'Craig' || priorPayload.tech !== 'Tony' ||
        (completing ? priorPayload.preparationContinuation !== true || Object.keys(priorPayload).some(key => key.startsWith('verifiedUnsentCompletion')) :
          ['preparationContinuation', 'preparationContinuationAt', 'preparationContinuationClaim'].some(key => Object.hasOwn(priorPayload, key)))) fail('owner_test_preparation_continuation_forbidden', 409);
    priorRows = (await db.prepare('SELECT * FROM review_request_deliveries WHERE request_id=?').bind(previous.id).all()).results || [];
    if (priorRows.length !== 2 || !['sms', 'email'].every(channel => priorRows.some(row => row.channel === channel && row.status === 'failed' &&
        row.reason === sourceFailure && row.provider_message_id === null && row.sent_at === null &&
        row.recipient === recipients[channel === 'sms' ? 'phone' : 'email']))) fail('owner_test_preparation_continuation_forbidden', 409);
  }

  // Consume the capability atomically before any preparation or provider call.
  const consumed = await db.prepare('DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=? RETURNING payload').bind(identity.approvalKey, approvalRow.payload).first();
  if (!consumed) fail('owner_test_approval_already_consumed', 409);
  const requestId = continuing ? previous.id : crypto.randomUUID();
  const unsubscribeToken = crypto.randomUUID() + crypto.randomUUID();
  const emailHash = await reviewHash(recipients.email), unsubscribeHash = await reviewHash(unsubscribeToken);
  const deliveries = continuing ? Object.fromEntries(priorRows.map(row => [row.channel, row.id])) : { sms: crypto.randomUUID(), email: crypto.randomUUID() };
  if (continuing) {
    // Each exception has its own immutable claim. The verified-unsent exception
    // is restricted to the single owner-approved request and fresh independent
    // delivery checks; no later rejection or transport failure can pass again.
    const claimedPayload = JSON.stringify(completing ? { ...priorPayload, verifiedUnsentCompletion: true,
      verifiedUnsentCompletionAt: timestamp, verifiedUnsentCompletionClaim: crypto.randomUUID(),
      verifiedUnsentCompletionVersion: approval.workerVersion, verifiedUnsentCompletionEvidence: approval.deliveryVerification,
      verifiedUnsentCompletionPriorDeliveries: priorRows.map(({ channel, reason, failed_at }) => ({ channel, reason, failed_at })) } :
      { ...priorPayload, preparationContinuation: true, preparationContinuationAt: timestamp,
        preparationContinuationClaim: crypto.randomUUID(), preparationContinuationVersion: approval.workerVersion,
        originalPreparationFailure: sourceFailure, originalPreparationFailedAt: priorRows.map(row => row.failed_at) });
    const claims = await db.batch([
      db.prepare(`UPDATE review_requests SET payload=? WHERE id=? AND job_id=? AND job_type='manual_owner_test' AND customer_key IS NULL AND payload=?
        AND (SELECT COUNT(*) FROM review_request_deliveries WHERE request_id=?)=2
        AND (SELECT COUNT(*) FROM review_request_deliveries WHERE request_id=? AND status='failed' AND reason=? AND provider_message_id IS NULL AND sent_at IS NULL
          AND ((channel='sms' AND recipient=?) OR (channel='email' AND recipient=?)))=2`)
        .bind(claimedPayload, requestId, identity.jobId, previous.payload, requestId, requestId, sourceFailure, recipients.phone, recipients.email),
      db.prepare(`UPDATE review_request_deliveries SET status='sending',reason='manual_owner_test_preparation_continuation_claimed',sending_at=CURRENT_TIMESTAMP,
        failed_at=NULL,updated_at=CURRENT_TIMESTAMP,email_hash=CASE WHEN channel='email' THEN ? ELSE email_hash END,
        unsubscribe_token_hash=CASE WHEN channel='email' THEN ? ELSE unsubscribe_token_hash END
        WHERE request_id=? AND status='failed' AND reason=? AND provider_message_id IS NULL AND sent_at IS NULL
          AND ((channel='sms' AND recipient=?) OR (channel='email' AND recipient=?))
          AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND payload=?)`)
        .bind(emailHash, unsubscribeHash, requestId, sourceFailure, recipients.phone, recipients.email, requestId, claimedPayload),
    ]);
    if (claims[0]?.meta?.changes !== 1 || claims[1]?.meta?.changes !== 2) fail('owner_test_preparation_continuation_forbidden', 409);
  } else {
    const claim = await db.prepare(`INSERT OR IGNORE INTO review_requests(id,customer_key,customer_id,customer_name,job_id,job_date,completed_at,job_type,tech,page_slug,template_version,payload)
      VALUES(?,NULL,'','Craig',?,?,?,'manual_owner_test','Tony','tony',?,?)`)
      .bind(requestId, identity.jobId, reviewEasternDate(now), timestamp, reviewRequestTemplateVersion('initial-cleanup'),
        JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony', authorization: 'owner_approved_2026-11-19', quietHoursBypassed: true, workerVersion: approval.workerVersion })).run();
    if (claim.meta?.changes !== 1) fail('owner_test_already_attempted', 409);

    await db.batch(Object.entries(deliveries).map(([channel, id]) => db.prepare(`INSERT INTO review_request_deliveries(id,request_id,channel,status,reason,recipient,email_hash,unsubscribe_token_hash,sending_at)
      VALUES(?,?,?,'sending','manual_owner_test_preparing',?,?,?,CURRENT_TIMESTAMP)`)
      .bind(id, requestId, channel, recipients[channel === 'sms' ? 'phone' : 'email'], channel === 'email' ? emailHash : null, channel === 'email' ? unsubscribeHash : null)));
  }
  const result = {
    kind: 'manual_owner_test', timestamp, workerVersion: approval.workerVersion, recipients, requestId,
    previewPageUrl: reviewRequestPageUrl(requestId), ogImageUrl: reviewRequestImageUrl(requestId),
  };
  async function finish(channel, outcome) {
    result[channel] = outcome;
    try {
      const saved = await db.prepare(`UPDATE review_request_deliveries SET status=?,reason=?,provider_message_id=?,updated_at=CURRENT_TIMESTAMP,
        sent_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP END,failed_at=CASE WHEN ?=0 THEN CURRENT_TIMESTAMP END WHERE id=? AND status='sending'`)
        .bind(outcome.accepted ? 'sent' : 'failed', `manual_owner_test_http_${outcome.httpStatus ?? 'none'}_${outcome.accepted ? 'provider_accepted_delivery_not_confirmed' : outcome.error}`, outcome.id, Number(outcome.accepted), Number(outcome.accepted), deliveries[channel]).run();
      outcome.ledgerRecorded = saved.meta?.changes === 1;
    } catch {
      // Preserve the known provider receipt and still attempt the other authorized
      // channel once. A stranded manual row is excluded from every cron send.
      outcome.ledgerRecorded = false;
    }
  }
  try {
    const preview = await (completing ? verifyPreview : preparePreview)(env, { token: requestId, firstName: 'Craig', tech: 'Tony' });
    if (preview?.token !== requestId || preview.tech !== 'tony' || preview.pageUrl !== result.previewPageUrl || preview.imageUrl !== result.ogImageUrl) fail('owner_test_preview_unavailable');
  } catch {
    for (const channel of ['sms', 'email']) await finish(channel, { accepted: false, httpStatus: null, id: null, status: 'not_attempted', error: 'preview_preparation_failed' });
    return result;
  }
  const options = { template: 'initial-cleanup', firstName: 'Craig', tech: 'Tony', previewToken: requestId,
    unsubscribeUrl: `${REVIEW_SITE_ORIGIN}/review/unsubscribe/?token=${unsubscribeToken}` };
  // Render both payloads before either outbound attempt. There are no retries.
  const sms = buildReviewRequestSms(options), message = buildReviewRequestEmail(options);
  const oneClick = `${REVIEW_SITE_ORIGIN}/api/review-requests/unsubscribe/?token=${unsubscribeToken}`;
  const attempts = {
    sms: () => dispatchSms(env, { phone: recipients.phone }, { content: sms, operation: 'send_manual_owner_review_test', receipt: true, request: fetchProvider }),
    email: () => dispatchEmail(env, { to: recipients.email, ...message, receipt: true, request: fetchProvider,
      idempotencyKey: `manual-owner-review-test/${identity.jobId}`,
      headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
  };
  for (const channel of ['sms', 'email']) {
    // Recheck the immutable allowlist and disabled flag immediately at dispatch.
    assertOwnerReviewTestRecipients(recipients);
    if (env.REVIEW_REQUESTS_ENABLED !== 'false') {
      await finish(channel, { accepted: false, httpStatus: null, id: null, status: 'not_attempted', error: 'configuration_changed' }); continue;
    }
    // Recheck the independently verified no-delivery evidence at dispatch too.
    if (completing && !freshDeliveryVerification(approval.deliveryVerification, new Date(now).getTime() + (Date.now() - dispatchStartedAt))) {
      await finish(channel, { accepted: false, httpStatus: null, id: null, status: 'not_attempted', error: 'delivery_verification_expired' }); continue;
    }
    let outcome;
    let httpStatus = null;
    try {
      const receipt = await attempts[channel]();
      httpStatus = receipt.httpStatus;
      const providerId = receipt.id;
      const id = typeof providerId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(providerId) ? providerId : null;
      const accepted = httpStatus >= 200 && httpStatus < 300 && Boolean(id);
      // Raw provider errors may contain credentials or message content. Retain only safe categories.
      outcome = { accepted, httpStatus, id, status: accepted ? 'provider_accepted_delivery_not_confirmed' : 'acceptance_uncertain', error: accepted ? null : 'provider_missing_provider_id_verify_before_retry' };
    } catch (error) {
      httpStatus = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : httpStatus;
      const classification = ['network', 'timeout', 'provider_rejected', 'missing_provider_id'].includes(error?.classification) ? error.classification : 'internal';
      outcome = { accepted: false, httpStatus, id: null,
        status: classification === 'provider_rejected' ? 'rejected' : 'acceptance_uncertain',
        error: `provider_${classification}_verify_before_retry` };
    }
    await finish(channel, outcome);
  }
  return result;
}

export function runOwnerReviewTest(env, options, dependencies) {
  return runLockedOwnerReviewTest(OWNER_REVIEW_TEST, env, options, dependencies);
}

export function runOwnerReviewRetest(env, options, dependencies) {
  return runLockedOwnerReviewTest(OWNER_REVIEW_RETEST, env, options, dependencies);
}
