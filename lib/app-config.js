import { getRuntimeEnv } from "./cloudflare";

export const DEFAULT_SITE_ORIGIN = "https://ohiopetwastepros.com";
export const DEFAULT_WORKER_ORIGIN = "https://opwp-website.ohiopetwastepros.workers.dev";

export function isProductionEnvironment(env = getRuntimeEnv()) {
  const explicit = String(env.APP_ENV || env.ENVIRONMENT || "").toLowerCase();
  return explicit === "production" || (!explicit && process.env.NODE_ENV === "production");
}

export function applicationConfig(env = getRuntimeEnv()) {
  const siteOrigin = String(env.SITE_ORIGIN || DEFAULT_SITE_ORIGIN).replace(/\/$/, "");
  const workerOrigin = String(env.WORKER_ORIGIN || DEFAULT_WORKER_ORIGIN).replace(/\/$/, "");
  return {
    environment: isProductionEnvironment(env) ? "production" : String(env.APP_ENV || "development"),
    siteOrigin,
    workerOrigin,
    quickBooksCallbackOrigin: String(env.QB_CALLBACK_ORIGIN || workerOrigin).replace(/\/$/, ""),
    integrations: {
      sweepAndGo: { configured: Boolean(env.SNG_API_KEY), webhookConfigured: Boolean(env.SNG_WEBHOOK_SECRET) },
      airtable: { configured: Boolean(env.AIRTABLE_API_KEY), baseId: env.AIRTABLE_BASE_ID || "" },
      stripe: { configured: Boolean(env.STRIPE_SECRET_KEY), webhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET) },
      quickBooks: { configured: Boolean(env.QB_CLIENT_ID && env.QB_CLIENT_SECRET && env.QB_TOKEN_ENCRYPTION_KEY), environment: env.QB_ENVIRONMENT || "production" },
      geoapify: { configured: Boolean(env.GEOAPIFY_API_KEY) },
      turnstile: { configured: Boolean(env.TURNSTILE_SECRET_KEY) },
      sms: { provider: env.SMS_PROVIDER || "unconfigured", configured: false },
      fieldProofs: { provider: env.FIELD_PROOFS ? "r2" : "d1_fallback" },
    },
  };
}

export function dedicatedSigningSecret(name, env = getRuntimeEnv()) {
  const value = String(env[name] || "");
  if (value) return value;
  if (!isProductionEnvironment(env) && env.ADMIN_DEV_BYPASS === "true") return String(env.ADMIN_PASSWORD || `local-${name.toLowerCase()}`);
  return "";
}
