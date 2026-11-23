import { rejectSensitivePaymentData } from './payments-provider.mjs';
import { fakeHostedTokenizerConfig } from './local-preview-payments.mjs';

export function safeHostedTokenizerConfig(config) {
  try {
    if (config?.provider === 'fake') {
      const local = fakeHostedTokenizerConfig(config.origin, config.methodType);
      return config.environment === 'local' && local?.url === config.url ? local : null;
    }
    if (!config || config.provider !== 'cardpointe' || config.environment !== 'uat' || !['card', 'ach'].includes(config.methodType)) return null;
    const url = new URL(config.url), origin = new URL(config.origin);
    if (url.protocol !== 'https:' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-uat\.cardconnect\.com$/.test(url.hostname) || url.origin !== config.origin || origin.origin !== config.origin || url.username || url.password || url.port || url.hash || url.pathname !== '/itoke/ajax-tokenizer.html' || url.searchParams.get('tokenpropname') !== 'token') return null;
    return { provider: 'cardpointe', environment: 'uat', methodType: config.methodType, origin: url.origin, url: url.toString() };
  } catch { return null; }
}

// Return no processor strings except the ephemeral CardSecure token. In particular,
// never propagate errorMessage, account details, or arbitrary enhanced-response data.
export function parseHostedTokenizerMessage(event, { origin, source } = {}) {
  if (!source || event?.source !== source || event?.origin !== origin) return null;
  if (event.validationError || event.data === '') return { status: 'invalid' };
  let payload;
  try { payload = typeof event.data === 'string' && event.data.length <= 16_384 ? JSON.parse(event.data) : event.data; } catch { return { status: 'invalid' }; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status: 'invalid' };
  try { rejectSensitivePaymentData(payload, { allowToken: true }); } catch { return { status: 'invalid' }; }
  // The documented enhanced success response uses errorCode "0".
  if (payload.validationError || ![undefined, null, '', 0, '0'].includes(payload.errorCode) || typeof payload.token !== 'string' || !/^9\d{15,18}$/.test(payload.token)) return { status: 'invalid' };
  return { status: 'ready', token: payload.token };
}
