import { createCardPointeProvider } from './cardpointe-provider.mjs';
import { createFakePaymentsProvider } from './fake-payments-provider.mjs';
import { PaymentsProviderError } from './payments-provider.mjs';
import { crmBillingEnabled } from './crm-billing-security.mjs';
import { localPreviewPaymentOrigin } from './local-preview-payments.mjs';

let fixtureProvider, fixtureOrigin;
export function billingPaymentsProvider(env) {
  if (!crmBillingEnabled(env)) throw new PaymentsProviderError('billing_disabled', 'UAT billing is not enabled.', 503);
  if (env.CRM_PAYMENTS_PROVIDER === 'fake') {
    const origin = localPreviewPaymentOrigin(env);
    if (!fixtureProvider || fixtureOrigin !== origin) { fixtureProvider = createFakePaymentsProvider({ tokenizerOrigin: origin }); fixtureOrigin = origin; }
    return fixtureProvider;
  }
  // Deliberately no production variable names, legacy gateway fallback or live mode.
  return createCardPointeProvider({
    appEnv: env.APP_ENV, environment: 'uat', baseUrl: env.CARDPOINTE_UAT_BASE_URL,
    username: env.CARDPOINTE_UAT_USERNAME, password: env.CARDPOINTE_UAT_PASSWORD,
    merchantId: env.CARDPOINTE_UAT_MERCHANT_ID,
    achEntryCode: env.CARDPOINTE_UAT_ACH_ENTRY_CODE || 'E',
    achAccountType: env.CARDPOINTE_UAT_ACH_ACCOUNT_TYPE || 'ECHK',
    enabled: env.CARDPOINTE_UAT_API_ENABLED === 'true',
  });
}
