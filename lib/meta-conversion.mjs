import { normalizePhone } from "./lead-assistant.mjs";

export async function recordVerifiedMetaPayment(db, { eventId, body, verified = false }) {
  if (!db || verified !== true) return false;
  const data = body?.data || {};
  const client = String(data.client || "").trim(), reference = String(data.reference_number || "").trim();
  const amount = Math.round(Number(data.amount) * 100);
  if (!eventId || !client || client.length > 100 || !reference || reference.length > 200 || !Number.isSafeInteger(amount) || amount <= 0) return false;
  await db.prepare(`INSERT OR IGNORE INTO meta_verified_payments (event_id,client_ref,reference,amount_cents) VALUES (?,?,?,?)`).bind(eventId, client, reference, amount).run();
  return true;
}

export async function reconcileMetaConversions(db) {
  const leads = await db.prepare(`SELECT i.*,s.email,s.phone FROM meta_lead_intakes i JOIN submissions s ON s.id=i.submission_id
    WHERE i.organization_id='org-opwp' AND i.duplicate_of IS NULL AND i.paid_at IS NULL AND s.status!='deleted'
    ORDER BY i.conversion_checked_at ASC,i.created_at,i.submission_id LIMIT 100`).all();
  let signups = 0, wins = 0;
  for (const lead of leads.results || []) {
    await db.prepare(`UPDATE meta_lead_intakes SET conversion_checked_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp'`).bind(lead.submission_id).run();
    let clientRef = lead.sng_client_ref;
    if (!lead.signed_up_at && lead.email && normalizePhone(lead.phone)) {
      const onboardings = await db.prepare(`SELECT id,phone,sng_entity_id FROM submissions WHERE kind='onboarding' AND sng_sync_state='succeeded'
        AND sng_entity_id IS NOT NULL AND sng_entity_id!='' AND lower(trim(email))=? AND created_at>=? LIMIT 10`).bind(lead.email.trim().toLowerCase(), lead.created_at).all();
      const matching = (onboardings.results || []).filter((row) => normalizePhone(row.phone) === normalizePhone(lead.phone));
      if (matching.length === 1) {
        clientRef = matching[0].sng_entity_id;
        await db.batch([
          db.prepare(`UPDATE meta_lead_intakes SET signed_up_at=CURRENT_TIMESTAMP,onboarding_submission_id=?,sng_client_ref=? WHERE submission_id=? AND organization_id='org-opwp'`).bind(matching[0].id, clientRef, lead.submission_id),
          db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason='signup_completed' WHERE submission_id=? AND status IN ('queued','blocked','sending')`).bind(lead.submission_id),
          db.prepare(`UPDATE lead_conversations SET status='resolved',automation_mode='paused' WHERE submission_id=? AND organization_id='org-opwp'`).bind(lead.submission_id),
          db.prepare(`UPDATE growth_leads SET next_action='Signup verified; review first service payment.',next_action_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp' AND stage!='won'`).bind(lead.submission_id),
          db.prepare(`INSERT OR IGNORE INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email) VALUES (?,?,'org-opwp','system','Signup verified from successful onboarding; outreach stopped',?,'meta-conversion')`).bind(`meta-signup-verified-${lead.submission_id}`, lead.submission_id, JSON.stringify({ onboardingId: matching[0].id, clientRef })),
        ]);
        signups++;
      }
    }
    if (!clientRef) continue;
    // A Meta label or an account alone never proves payment. Require a verified payment
    // and a unique, same-client/amount scooping invoice; ambiguous invoices stay with Craig.
    const evidence = await db.prepare(`SELECT p.event_id,p.received_at FROM meta_verified_payments p
      WHERE p.client_ref=? AND p.received_at>=? AND 1=(SELECT COUNT(*) FROM sng_events e
        WHERE e.event_type='client:invoice_finalized' AND e.status='processed'
          AND CAST(json_extract(e.payload,'$.data.client') AS TEXT)=p.client_ref
          AND ROUND(CAST(json_extract(e.payload,'$.data.total') AS REAL)*100)=p.amount_cents
          AND datetime(e.received_at) BETWEEN datetime(p.received_at,'-2 days') AND datetime(p.received_at,'+1 day')
          AND EXISTS(SELECT 1 FROM json_each(e.payload,'$.data.items') WHERE lower(json_extract(value,'$.description')) LIKE '%scoop%' OR lower(json_extract(value,'$.description')) LIKE '%pet waste%' OR lower(json_extract(value,'$.description')) LIKE '%cleanup%')
        ) ORDER BY p.received_at LIMIT 1`).bind(clientRef, lead.created_at).first();
    if (!evidence) continue;
    await db.batch([
      db.prepare(`UPDATE meta_lead_intakes SET paid_at=? WHERE submission_id=? AND organization_id='org-opwp'`).bind(evidence.received_at, lead.submission_id),
      db.prepare(`UPDATE growth_leads SET stage='won',converted_at=CURRENT_TIMESTAMP,outcome_reason=NULL,outcome_note=NULL,next_action=NULL,next_action_at=NULL,updated_by='verified-meta-payment',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp'`).bind(lead.submission_id),
      db.prepare(`UPDATE submissions SET lifecycle_stage='converted',status='converted',sng_entity_id=? WHERE id=? AND source='facebook'`).bind(clientRef, lead.submission_id),
      db.prepare(`INSERT OR IGNORE INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email) VALUES (?,?,'org-opwp','system','Won: verified service payment matched to signup',?,'meta-conversion')`).bind(`meta-win-${lead.submission_id}`, lead.submission_id, JSON.stringify({ paymentEventId: evidence.event_id, clientRef })),
      db.prepare(`UPDATE lead_airtable_sync SET status='queued',revision=revision+1,attempt_count=0,next_attempt_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp'`).bind(lead.submission_id),
    ]);
    wins++;
  }
  return { signups, wins };
}
