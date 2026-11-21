import {normalizePhone} from './lead-assistant.mjs';
const ORG = 'org-opwp';
// Cross-submission and existing-customer history determines a genuinely new contact.
const phoneDigits = (column) => `substr(replace(replace(replace(replace(replace(${column},'+',''),'(',''),')',''),'-',''),' ',''),-10)`;
export async function isFirstLeadMessage(db, row) {
  const phone = normalizePhone(row.phone);
  if (!phone) return false;
  const digits = phone.slice(-10);
  const priorContact = await db.prepare(`SELECT 1 found FROM submissions s
    LEFT JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=?
    WHERE ${phoneDigits('s.phone')}=? AND (s.id!=? OR c.last_inbound_at IS NOT NULL OR c.last_outbound_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM lead_messages m WHERE m.conversation_id=c.id AND m.organization_id=c.organization_id)) LIMIT 1`)
    .bind(ORG, digits, row.submission_id).first();
  if (priorContact) return false;
  const customer = await db.prepare(`SELECT 1 found FROM dog_food_customers WHERE ${phoneDigits('phone')}=?
    UNION ALL SELECT 1 FROM sng_events e WHERE e.event_type IN
      ('job:started','job:completed','notification:completed_job_notification','notification:on_the_way_notification',
       'client:invoice_finalized','client:subscription_created','client:client_assigned','client:client_onboarding_recurring','client:client_payment_accepted')
      AND (${phoneDigits('e.phone')}=? OR EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(e.payload) THEN e.payload ELSE '{}' END) p
        WHERE p.key IN ('phone','phone_number','phoneNumber','mobile','mobile_phone','cell_phone','cell_phone_number','home_phone','home_phone_number')
          AND ${phoneDigits('p.value')}=?)) LIMIT 1`)
    .bind(digits, digits, digits).first();
  return !customer;
}
