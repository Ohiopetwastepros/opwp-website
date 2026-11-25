import {controlledLeadTestRecipient, isCraigMetaTest} from './lead-rollout-policy.mjs';

const ORG = 'org-opwp';
const FORM = '1725121795904553';
const PAGE = '617929208074485';
const RESET_PREFIX = 'meta_test_reset:';
export const craigTestResetKey = id => RESET_PREFIX + id;

export function craigTestResetEligible(env, lead, graphFormId) {
  return isCraigMetaTest(env, lead.phone) &&
    env.META_AUTOMATION_ENABLED !== 'true' &&
    env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY === 'true' &&
    controlledLeadTestRecipient(env) === lead.phone &&
    env.META_ALLOWED_PAGE_IDS?.trim() === PAGE && lead.meta_page_id === PAGE &&
    env.META_TEST_FORM_IDS?.trim() === FORM && lead.meta_form_id === FORM && graphFormId === FORM;
}

// Batched with intake. A retry cannot clear a STOP from the new conversation.
export function craigTestResetStatements(db, {id, phoneHash, capturedAt, approvalId, policy}) {
  const resetKey = craigTestResetKey(id);
  const beforeIntake = 'NOT EXISTS (SELECT 1 FROM meta_lead_intakes WHERE submission_id=?)';
  const resetGranted = beforeIntake + ' AND EXISTS (SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=?)';
  const previous = `SELECT i.submission_id FROM meta_lead_intakes i
    JOIN submissions s ON s.id=i.submission_id
    WHERE i.organization_id=? AND i.phone_hash=? AND i.form_id=? AND i.page_id=?
      AND s.source='facebook' AND (
        lower(trim(s.name))='test lead craig' OR EXISTS (
          SELECT 1 FROM airtable_cockpit_snapshots r WHERE r.snapshot_key='${RESET_PREFIX}'||i.submission_id
        )
      )`;
  const oldState = (sql, ...params) => db.prepare(sql + ' AND submission_id IN (' + previous + ') AND ' + resetGranted)
    .bind(...params, ORG, phoneHash, FORM, PAGE, id, resetKey);

  return [
    db.prepare(`INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload)
      SELECT ?,json_object('event','test reset','submissionId',?,'consentCapturedAt',?,
        'clearedSuppression',json((SELECT json_object('reason',reason,'source',source,'createdAt',created_at)
          FROM lead_suppressions WHERE organization_id=? AND phone_hash=?)))
      WHERE ${beforeIntake}
        AND EXISTS (SELECT 1 FROM meta_automation_releases WHERE id=? AND organization_id=? AND policy_version=?
          AND revoked_at IS NULL AND length(approved_by)>0 AND length(evidence)>0 AND approved_at<=CURRENT_TIMESTAMP)
        AND julianday(?) BETWEEN julianday('now','-1 day') AND julianday('now','+1 minute')
        AND NOT EXISTS (SELECT 1 FROM lead_suppressions WHERE organization_id=? AND phone_hash=?
          AND julianday(created_at)>=julianday(?))
        AND NOT EXISTS (SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key GLOB 'meta_test_reset:*'
          AND json_valid(payload) AND julianday(json_extract(payload,'$.consentCapturedAt'))>=julianday(?))`)
      .bind(resetKey,id,capturedAt,ORG,phoneHash,id,approvalId,ORG,policy,capturedAt,ORG,phoneHash,capturedAt,capturedAt),
    db.prepare(`DELETE FROM lead_suppressions WHERE organization_id=? AND phone_hash=? AND ${resetGranted}`)
      .bind(ORG,phoneHash,id,resetKey),
    oldState("UPDATE meta_sms_jobs SET status='cancelled',block_reason='test_reset',updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND status IN ('queued','blocked','failed','sending') AND provider_message_id IS NULL",ORG),
    oldState("UPDATE lead_reply_drafts SET status='superseded',rejection_reason='test_reset',updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND status IN ('pending','approved','edited_approved','failed','sending') AND provider_message_id IS NULL",ORG),
    oldState("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='test_reset',updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND status IN ('queued','sending') AND provider_message_id IS NULL",ORG),
    oldState("UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND status IN ('queued','failed','sending')",ORG),
    oldState("UPDATE lead_conversations SET status='deleted',automation_mode='paused',unread_count=0,deletion_reason='test reset',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND status!='deleted'",ORG),
    db.prepare(`UPDATE submissions SET status='deleted',updated_at=CURRENT_TIMESTAMP WHERE id IN (${previous}) AND ${resetGranted}`)
      .bind(ORG,phoneHash,FORM,PAGE,id,resetKey),
    db.prepare(`DELETE FROM lead_airtable_sync WHERE organization_id=? AND submission_id IN (${previous}) AND ${resetGranted}`)
      .bind(ORG,ORG,phoneHash,FORM,PAGE,id,resetKey),
  ];
}
