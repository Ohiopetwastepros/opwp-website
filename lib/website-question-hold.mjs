const ORG = 'org-opwp';
const ACTION = 'Craig: answer the submitted website question before further quote follow-up';

// Require the same normalized telephone identity, never merely a funnel or name.
// Unrecognized stored formatting fails closed rather than guessing a match.
export function normalizedQuestionPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{10}$/.test(digits) ? '1' + digits : /^\d{11,15}$/.test(digits) ? digits : '';
}

export function questionPhoneSql(column) {
  const digits = `replace(replace(replace(replace(replace(replace(replace(replace(${column},'+',''),'(',''),')',''),'-',''),' ',''),'.',''),char(9),''),char(160),'')`;
  return `(CASE WHEN length(${digits})=10 THEN '1'||${digits} ELSE ${digits} END)`;
}

export class WebsiteQuestionIdentityConflict extends Error {
  constructor() {
    super('A question is awaiting review for this quote. Please contact us before changing its contact details.');
    this.code = 'website_question_identity_conflict';
    this.status = 409;
  }
}

export function websiteQuestionHoldStatements(db, {questionId, funnelId = '', phone = '', email = '', question, playbook = false}) {
  const normalizedPhone = normalizedQuestionPhone(phone), normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedStoredPhone = questionPhoneSql('s.phone');
  const targets = `SELECT s.id FROM submissions s WHERE s.id=? OR (
    ?<>'' AND ?<>'' AND s.kind='partial_quote' AND s.source='website' AND s.funnel_id=?
    AND ${normalizedStoredPhone}=?
    AND (?='' OR COALESCE(trim(s.email),'')='' OR lower(trim(s.email))=?)
    AND s.status NOT IN ('deleted','trashed','converted','synced') AND COALESCE(s.lifecycle_stage,'')!='converted'
    AND NOT EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=s.id AND (g.organization_id!=? OR g.stage IN ('won','lost','not_qualified')))
    AND NOT EXISTS(SELECT 1 FROM lead_conversations c WHERE c.submission_id=s.id AND (c.organization_id!=? OR c.status='deleted'))
  )`;
  const args = [questionId, funnelId, normalizedPhone, funnelId, normalizedPhone, normalizedEmail, normalizedEmail, ORG, ORG];
  const statements = [
    db.prepare(`UPDATE submissions SET status='needs_attention',payload=json_set(
      CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,
      '$.pending_quote_question',?,'$.pending_quote_question_submission_id',?,
      '$.pending_quote_question_prior_status',COALESCE(json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.pending_quote_question_prior_status'),status)),
      updated_at=CURRENT_TIMESTAMP WHERE kind='partial_quote' AND id IN (${targets})`).bind(question, questionId, ...args),
    db.prepare(`INSERT INTO lead_conversations(id,submission_id,organization_id,channel,status,automation_mode,unread_count${playbook ? ',owner' : ''})
      SELECT lower(hex(randomblob(16))),s.id,?,'website','open','paused',1${playbook ? ",'craig'" : ''}
      FROM submissions s WHERE s.id IN (${targets}) ON CONFLICT(submission_id) DO NOTHING`).bind(ORG, ...args),
    db.prepare(`UPDATE lead_conversations SET automation_mode='paused',unread_count=MAX(unread_count,1),updated_at=CURRENT_TIMESTAMP
      ${playbook ? ",owner='craig',owner_event_at=?,owner_event_id=?,owner_event_priority=3" : ''}
      WHERE organization_id=? AND status!='deleted' AND submission_id IN (${targets})`)
      .bind(...(playbook ? [new Date().toISOString(), 'manual:website-question:' + questionId] : []), ORG, ...args),
    // A website question is not an inbound SMS and does not grant text consent.
    // Keep last_inbound_at untouched and retain the question as a source note.
    db.prepare(`INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,delivery_status,automated,created_by)
      SELECT 'website-question-'||?||'-'||c.id,c.id,?,'internal','website',?,'recorded',0,'website-question'
      FROM lead_conversations c WHERE c.organization_id=? AND c.submission_id IN (${targets})`)
      .bind(questionId, ORG, question, ORG, ...args),
    db.prepare(`UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,
      error_message='website_question_requires_owner_review',updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('queued','failed') AND provider_message_id IS NULL AND attempt_count<5 AND submission_id IN (${targets})`).bind(...args),
    db.prepare(`UPDATE quote_follow_ups SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('queued','failed') AND submission_id IN (${targets})`).bind(...args),
    db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,
      error_message='website_question_requires_owner_review',updated_at=CURRENT_TIMESTAMP
      WHERE organization_id=? AND status IN ('queued','failed') AND provider_message_id IS NULL AND attempt_count<5 AND submission_id IN (${targets})`).bind(ORG, ...args),
    db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason='website_question_requires_owner_review',updated_at=CURRENT_TIMESTAMP
      WHERE organization_id=? AND purpose IN ('confirmation','follow_up') AND status IN ('queued','blocked','failed')
      AND provider_message_id IS NULL AND submission_id IN (${targets})`).bind(ORG, ...args),
    db.prepare(`INSERT INTO growth_leads(submission_id,organization_id,stage,priority,next_action,next_action_at,updated_by)
      SELECT s.id,?,'new','high',?,CURRENT_TIMESTAMP,'website-question' FROM submissions s WHERE s.id IN (${targets})
      ON CONFLICT(submission_id) DO UPDATE SET priority='high',next_action=excluded.next_action,next_action_at=CURRENT_TIMESTAMP,
        version=growth_leads.version+1,updated_by='website-question',updated_at=CURRENT_TIMESTAMP`).bind(ORG, ACTION, ...args),
    db.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email)
      SELECT lower(hex(randomblob(16))),s.id,?,'system','Website question received; generic quote follow-up held',?,'website-question'
      FROM submissions s WHERE s.id IN (${targets})`).bind(ORG, JSON.stringify({questionSubmissionId: questionId}), ...args),
    db.prepare(`UPDATE lead_airtable_sync SET status='queued',revision=revision+1,attempt_count=0,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE organization_id=? AND submission_id IN (${targets})`).bind(ORG, ...args),
  ];
  if (playbook) statements.push(db.prepare(`UPDATE lead_reply_drafts SET status='superseded',rejection_reason='website_question_requires_owner_review',updated_at=CURRENT_TIMESTAMP
    WHERE organization_id=? AND status IN ('pending','approved','edited_approved') AND provider_message_id IS NULL AND submission_id IN (${targets})`).bind(ORG, ...args));
  return statements;
}
