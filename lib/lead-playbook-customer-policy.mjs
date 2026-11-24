import {checkQuoCustomerDirectory} from './quo-lead-intake.mjs';
import {isCraigMetaTest} from './lead-rollout-policy.mjs';

const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };

export async function loadPlaybookCustomerDirectory(path) {
  const {sngPaginatedRequest} = await import('./sweepandgo.js');
  return sngPaginatedRequest(path, {maxPages: 50, perPage: 100});
}

// This skips customer admission only. Consent, recipient, ownership, approval,
// suppression and fresh Airtable permission checks remain at their usual gates.
export async function evaluatePlaybookCustomerAdmission(_db, env, {lead = {}}, {loadCustomerDirectory = loadPlaybookCustomerDirectory} = {}) {
  if (isCraigMetaTest(env, lead.phone)) return {allowed: true, kind: 'controlled_test'};
  const form = parse(lead.payload);
  if (lead.existing_customer || lead.is_existing_customer || form.existing_customer || form.is_existing_customer) return {allowed: false, reason: 'existing_customer'};
  try {
    return await checkQuoCustomerDirectory(lead.phone, loadCustomerDirectory)
      ? {allowed: false, reason: 'existing_customer'} : {allowed: true, kind: 'new_contact'};
  } catch { return {allowed: false, reason: 'customer_directory_unverified'}; }
}
