import {normalizePhone} from './lead-assistant.mjs';
import {checkQuoCustomerDirectory} from './quo-lead-intake.mjs';
import {controlledLeadTestRecipient} from './lead-rollout-policy.mjs';

const ORG = 'org-opwp';
const scopeKeys = ['approvalId','approvedBy','approvedAt','expiresAt','organizationId','submissionId','conversationId','phone','formId','metaLeadId'];
const enabled = value => value === true || value === 'true';
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;

// Server configuration grants a single, expiring verification scope. Intake
// fields, a new form, ordinary replies and ownership handback never grant it.
export function controlledExistingCustomerTestScope(env = {}, now = new Date()) {
  if (!enabled(env.LEAD_PLAYBOOK_ENABLED) || !enabled(env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY)) return null;
  const scope = parse(env.LEAD_PLAYBOOK_CUSTOMER_TEST_EXCEPTION);
  if (!scope || Array.isArray(scope) || Object.keys(scope).length !== scopeKeys.length || scopeKeys.some(key => !Object.hasOwn(scope, key))) return null;
  if (scope.organizationId !== ORG || !['approvalId','submissionId','conversationId','formId','metaLeadId'].every(key => id(scope[key]))) return null;
  if (typeof scope.approvedBy !== 'string' || !scope.approvedBy.trim() || scope.approvedBy.length > 120 || /[\r\n]/.test(scope.approvedBy)) return null;
  const approved = timestamp(scope.approvedAt), expires = timestamp(scope.expiresAt), current = new Date(now).getTime();
  if (![approved, expires, current].every(Number.isFinite) || approved > current || expires <= current || expires <= approved || expires - approved > 24 * 3600000) return null;
  const phone = controlledLeadTestRecipient(env), forms = String(env.META_TEST_FORM_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!phone || normalizePhone(scope.phone) !== phone || normalizePhone(env.LEAD_PLAYBOOK_CRAIG_CELL) !== phone || forms.length !== 1 || forms[0] !== scope.formId) return null;
  return {...scope, phone};
}

async function matchesControlledTest(db, env, lead, conversation, now) {
  const scope = controlledExistingCustomerTestScope(env, now);
  const submissionId = lead.submission_id || lead.id, conversationId = conversation.id || lead.conversation_id;
  if (!scope || scope.submissionId !== submissionId || scope.conversationId !== conversationId || normalizePhone(lead.phone) !== scope.phone) return false;
  if (conversation.organization_id && conversation.organization_id !== ORG || lead.organization_id && lead.organization_id !== ORG || conversation.submission_id && conversation.submission_id !== submissionId) return false;
  const row = await db.prepare(`SELECT i.meta_lead_id,i.form_id,i.page_id,i.duplicate_of,s.phone,s.payload FROM meta_lead_intakes i
    JOIN submissions s ON s.id=i.submission_id JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=i.organization_id
    WHERE i.submission_id=? AND i.organization_id=? AND c.id=? AND c.owner='backend' AND c.status!='deleted'
      AND s.status NOT IN ('deleted','trashed','converted','synced') AND COALESCE(s.lifecycle_stage,'')!='converted'`)
    .bind(scope.submissionId, ORG, scope.conversationId).first();
  if (!row || row.duplicate_of || row.meta_lead_id !== scope.metaLeadId || row.form_id !== scope.formId || normalizePhone(row.phone) !== scope.phone) return false;
  const form = parse(row.payload), consent = form.sms_consent_evidence;
  return consent?.valid === true && consent.formId === row.form_id && consent.pageId === row.page_id;
}

export async function loadPlaybookCustomerDirectory(path) {
  const {sngPaginatedRequest} = await import('./sweepandgo.js');
  return sngPaginatedRequest(path, {maxPages: 50, perPage: 100});
}

// Existing customers, including new inquiries, stay with manual review in this
// release. Only the exact server-approved controlled test can bypass matching.
export async function evaluatePlaybookCustomerAdmission(db, env, {lead = {}, conversation = {}}, {loadCustomerDirectory = loadPlaybookCustomerDirectory, now = new Date()} = {}) {
  try { if (await matchesControlledTest(db, env, lead, conversation, now)) return {allowed: true, kind: 'controlled_test'}; }
  catch { return {allowed: false, reason: 'customer_directory_unverified'}; }
  const form = parse(lead.payload);
  if (lead.existing_customer || lead.is_existing_customer || form.existing_customer || form.is_existing_customer) return {allowed: false, reason: 'existing_customer'};
  try {
    return await checkQuoCustomerDirectory(lead.phone, loadCustomerDirectory)
      ? {allowed: false, reason: 'existing_customer'} : {allowed: true, kind: 'new_contact'};
  } catch { return {allowed: false, reason: 'customer_directory_unverified'}; }
}
