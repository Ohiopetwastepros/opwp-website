import { buildReviewRequestSms, buildReviewRequestEmail, REVIEW_SITE_ORIGIN, reviewRequestPageUrl, reviewRequestImageUrl } from './review-request-content.mjs';
import { reviewRequestTemplateVersion } from './review-request-templates.mjs';
import { prepareReviewPreview } from './review-previews.mjs';
import { reviewHash, reviewEasternDate } from './review-request-policy.mjs';
import { readBoundedProviderJson } from './bounded-body.mjs';

// This is one explicitly authorized owner test, never a customer queue job.
// Changing its destination or allowing another run requires a source change.
export const OWNER_REVIEW_TEST = Object.freeze({
  phone: '+14192620424', email: 'craig@ohiopetwastepros.com',
  from: '+14192622371', phoneId: 'PNMNGRvTTx',
  jobId: 'manual-owner-review-test-2026-11-19',
  approvalKey: 'manual_owner_review_test:2026-11-19',
});

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

export async function runOwnerReviewTest(env, { phone, email, authorization, now = new Date() } = {}, { preparePreview = prepareReviewPreview, fetchProvider = fetch } = {}) {
  const recipients = assertOwnerReviewTestRecipients({ phone, email });
  const bearer = /^Bearer ([a-f0-9]{64})$/.exec(authorization || '')?.[1];
  if (!bearer) fail('owner_test_unauthorized', 401);
  if (env?.REVIEW_REQUESTS_ENABLED !== 'false') fail('owner_test_requires_automation_disabled', 403);
  if (!env.DB || !env.FIELD_PROOFS || !env.QUO_API_KEY || !env.RESEND_API_KEY ||
      env.SMS_PROVIDER !== 'quo' || env.QUO_FROM_NUMBER !== OWNER_REVIEW_TEST.from ||
      env.QUO_API_BASE_URL !== 'https://api.openphone.com' || env.RESEND_API_BASE_URL !== 'https://api.resend.com' ||
      env.EMAIL_PROVIDER !== 'resend' || env.EMAIL_SENDING_ENABLED !== 'true' ||
      String(env.EMAIL_FROM || '').toLowerCase() !== OWNER_REVIEW_TEST.email) fail('owner_test_configuration_mismatch');
  const db = env.DB;
  const approvalRow = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(OWNER_REVIEW_TEST.approvalKey).first();
  let approval;
  try { approval = JSON.parse(approvalRow?.payload || '{}'); } catch { fail('owner_test_unauthorized', 401); }
  if (!sameDigest(approval.tokenHash, await reviewHash(bearer))) fail('owner_test_unauthorized', 401);
  const timestamp = new Date(now).toISOString();
  const remaining = Date.parse(approval.expiresAt) - Date.parse(timestamp);
  if (!(remaining > 0 && remaining <= 15 * 60_000) || !approval.workerVersion || approval.workerVersion !== env.CF_VERSION_METADATA?.id) fail('owner_test_approval_expired_or_wrong_version', 403);
  if (await db.prepare('SELECT id FROM review_requests WHERE job_id=?').bind(OWNER_REVIEW_TEST.jobId).first()) fail('owner_test_already_attempted', 409);

  // Consume the capability atomically before any preparation or provider call.
  const consumed = await db.prepare('DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=? RETURNING payload').bind(OWNER_REVIEW_TEST.approvalKey, approvalRow.payload).first();
  if (!consumed) fail('owner_test_approval_already_consumed', 409);
  const requestId = crypto.randomUUID();
  const claim = await db.prepare(`INSERT OR IGNORE INTO review_requests(id,customer_key,customer_id,customer_name,job_id,job_date,completed_at,job_type,tech,page_slug,template_version,payload)
    VALUES(?,NULL,'','Craig',?,?,?,'manual_owner_test','Tony','tony',?,?)`)
    .bind(requestId, OWNER_REVIEW_TEST.jobId, reviewEasternDate(now), timestamp, reviewRequestTemplateVersion('initial-cleanup'),
      JSON.stringify({ kind: 'manual_owner_test', firstName: 'Craig', tech: 'Tony', authorization: 'owner_approved_2026-11-19', quietHoursBypassed: true, workerVersion: approval.workerVersion })).run();
  if (claim.meta?.changes !== 1) fail('owner_test_already_attempted', 409);

  const unsubscribeToken = crypto.randomUUID() + crypto.randomUUID();
  const deliveries = { sms: crypto.randomUUID(), email: crypto.randomUUID() };
  const emailHash = await reviewHash(recipients.email), unsubscribeHash = await reviewHash(unsubscribeToken);
  await db.batch(Object.entries(deliveries).map(([channel, id]) => db.prepare(`INSERT INTO review_request_deliveries(id,request_id,channel,status,reason,recipient,email_hash,unsubscribe_token_hash,sending_at)
    VALUES(?,?,?,'sending','manual_owner_test_preparing',?,?,?,CURRENT_TIMESTAMP)`)
    .bind(id, requestId, channel, recipients[channel === 'sms' ? 'phone' : 'email'], channel === 'email' ? emailHash : null, channel === 'email' ? unsubscribeHash : null)));
  const result = {
    kind: 'manual_owner_test', timestamp, workerVersion: approval.workerVersion, recipients, requestId,
    previewPageUrl: reviewRequestPageUrl(requestId), ogImageUrl: reviewRequestImageUrl(requestId),
  };
  async function finish(channel, outcome) {
    result[channel] = outcome;
    try {
      await db.prepare(`UPDATE review_request_deliveries SET status=?,reason=?,provider_message_id=?,updated_at=CURRENT_TIMESTAMP,
        sent_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP END,failed_at=CASE WHEN ?=0 THEN CURRENT_TIMESTAMP END WHERE id=? AND status='sending'`)
        .bind(outcome.accepted ? 'sent' : 'failed', `manual_owner_test_http_${outcome.httpStatus ?? 'none'}_${outcome.accepted ? 'provider_accepted_delivery_not_confirmed' : outcome.error}`, outcome.id, Number(outcome.accepted), Number(outcome.accepted), deliveries[channel]).run();
      outcome.ledgerRecorded = true;
    } catch {
      // Preserve the known provider receipt and still attempt the other authorized
      // channel once. A stranded manual row is excluded from every cron send.
      outcome.ledgerRecorded = false;
    }
  }
  try {
    const source = await fetchProvider('https://api.openphone.com/v1/phone-numbers', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12_000), headers: { Authorization: env.QUO_API_KEY, Accept: 'application/json' } });
    const numbers = await readBoundedProviderJson(source, 128 * 1024);
    if (!source.ok || !numbers?.data?.some(number => number.id === OWNER_REVIEW_TEST.phoneId && number.number === OWNER_REVIEW_TEST.from)) fail('owner_test_source_line_mismatch');
  } catch {
    for (const channel of ['sms', 'email']) await finish(channel, { accepted: false, httpStatus: null, id: null, status: 'not_attempted', error: 'source_line_verification_failed' });
    return result;
  }
  try {
    const preview = await preparePreview(env, { token: requestId, firstName: 'Craig', tech: 'Tony' });
    if (preview?.token !== requestId || preview.pageUrl !== result.previewPageUrl || preview.imageUrl !== result.ogImageUrl) fail('owner_test_preview_unavailable');
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
    sms: { url: 'https://api.openphone.com/v1/messages', headers: { Authorization: env.QUO_API_KEY },
      body: { content: sms, from: OWNER_REVIEW_TEST.from, to: [recipients.phone] } },
    email: { url: 'https://api.resend.com/emails', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Idempotency-Key': `manual-owner-review-test/${OWNER_REVIEW_TEST.jobId}` },
      body: { to: [recipients.email], from: `${String(env.EMAIL_FROM_NAME || 'Ohio Pet Waste Pros').replace(/[\r\n]/g, ' ').slice(0, 100)} <${env.EMAIL_FROM}>`, reply_to: env.EMAIL_FROM, ...message,
        headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } },
  };
  for (const channel of ['sms', 'email']) {
    // Recheck the immutable allowlist and disabled flag immediately at dispatch.
    assertOwnerReviewTestRecipients(recipients);
    if (env.REVIEW_REQUESTS_ENABLED !== 'false') {
      await finish(channel, { accepted: false, httpStatus: null, id: null, status: 'not_attempted', error: 'configuration_changed' }); continue;
    }
    let outcome;
    let httpStatus = null;
    try {
      const attempt = attempts[channel];
      const response = await fetchProvider(attempt.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { ...attempt.headers, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(attempt.body) });
      httpStatus = response.status;
      const data = await readBoundedProviderJson(response, 64 * 1024).catch(() => ({}));
      const providerId = channel === 'sms' ? data?.data?.id || data?.id : data?.id;
      const id = typeof providerId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(providerId) ? providerId : null;
      const accepted = response.ok && Boolean(id);
      // Raw provider errors may contain credentials or message content. Retain only safe categories.
      outcome = { accepted, httpStatus, id, status: accepted ? 'provider_accepted_delivery_not_confirmed' : 'rejected', error: accepted ? null : 'provider_rejected_or_missing_id' };
    } catch { outcome = { accepted: false, httpStatus, id: null, status: 'acceptance_uncertain', error: 'provider_acceptance_uncertain_verify_before_retry' }; }
    await finish(channel, outcome);
  }
  return result;
}
