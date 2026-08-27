# Production hardening configuration

## Security boundaries

- Sweep & Go webhooks require SNG_WEBHOOK_SECRET in x-sng-webhook-secret,
  x-webhook-secret, or the secret query parameter. Missing or invalid caller
  credentials return 401. Missing production configuration fails closed.
- The localhost smoke bypass requires a localhost URL, non-production runtime,
  ADMIN_DEV_BYPASS=true, and x-opwp-local-smoke: true.
- Lead, waitlist, onboarding, and dog-food mutations use bounded JSON requests,
  D1-backed rate limits, strict input validation, and Turnstile where the visitor
  intentionally submits or saves a meaningful record.
- ADMIN_SESSION_SECRET and FIELD_AUTH_SECRET are independent production secrets.
  Production never uses ADMIN_PASSWORD as a signing key.
- Field photos prefer the private FIELD_PROOFS R2 binding. Authenticated retrieval
  and technician/task ownership checks remain server-side. D1 is fallback-only.

## Migration numbering

D1 records the applied migration filename in d1_migrations. The historical
0022_onboarding_route_assignments.sql and 0022_technician_field_app.sql files
therefore remain unchanged. Renaming either could make Wrangler treat it as a new
migration. npm run check:migrations allows only that documented collision and
requires all later migrations to be uniquely and monotonically numbered.

Migration 0030_production_hardening.sql adds staff integration mappings and
explicit notification delivery states/timestamps.

## Notifications

Queued means queued only. Delivery state supports queued, sending, sent, failed,
and cancelled. The provider adapter stays unconfigured unless a real provider
contract and credentials are supplied. It cannot report sent without a provider
message ID. Quo variable names are reserved, but Quo sending is deliberately
disabled until its API contract is available.

## CSP decision

The existing security headers remain enabled. A strict CSP was not activated in
this pass because Next.js hydration, Turnstile, Google Maps, remote images/fonts,
Stripe navigation, and legacy content sources first need a report collector and
an observation period. Enable a report-only policy in staging, review violations,
then tighten it before enforcement.

## Release commands

Run npm ci, npm run audit:production, npm test, npm run test:smoke,
npm run audit:routes, npm run check:migrations, npm run build,
npm run build:cloudflare, and git diff --check.
