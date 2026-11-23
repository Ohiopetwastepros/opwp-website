import { crmBillingEnabled } from './crm-billing-security.mjs';
import { billingPaymentsProvider } from './crm-billing-providers.mjs';
import { processCrmBilling } from './crm-billing-store.mjs';

export async function runScheduledCrmBilling(env, { now = Date.now() } = {}) {
  if (!crmBillingEnabled(env) || !env.DB) return { status: 'disabled' };
  let provider = null;
  try { provider = billingPaymentsProvider(env); } catch { /* Draft review works before UAT processor setup. */ }
  return processCrmBilling(env, { now, provider });
}
