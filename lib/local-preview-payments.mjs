// A separate local-only boundary. The production/UAT tokenizer never uses this.
export function loopbackPreviewOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function localPreviewPaymentOrigin(env, requestUrl = null) {
  if (env?.LOCAL_PREVIEW_ENABLED !== 'true' || env.APP_ENV !== 'development' || env.CRM_PAYMENTS_PROVIDER !== 'fake' || env.CRM_PAYMENTS_ENV !== 'uat' || env.ROUTE_OS_BILLING_ENABLED !== 'true') return null;
  const origin = loopbackPreviewOrigin(env.LOCAL_PREVIEW_ORIGIN);
  if (!origin) return null;
  if (requestUrl) { try { if (new URL(requestUrl).origin !== origin) return null; } catch { return null; } }
  return origin;
}

export function fakeHostedTokenizerConfig(origin, methodType) {
  const safeOrigin = loopbackPreviewOrigin(origin);
  if (!safeOrigin || !['card', 'ach'].includes(methodType)) return null;
  return { provider: 'fake', environment: 'local', methodType, origin: safeOrigin, url: `${safeOrigin}/local-preview/payment-tokenizer/?methodType=${methodType}` };
}
