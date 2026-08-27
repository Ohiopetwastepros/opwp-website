# OPWP Security Baseline

Security is a release requirement for every OPWP system, not a later hardening phase.

## Mandatory trust-boundary rules

- Authenticate every private route on the server.
- Authorize every record access on the server using the signed-in user, organization, and role. Never trust a URL ID by itself.
- Keep D1 and R2 private behind Worker bindings. Every object read and write must include an ownership or assignment check.
- Derive prices, discounts, permissions, feature access, and payment state on the server. Browser values are untrusted suggestions.
- Verify webhook signatures or secrets and fail closed when authentication is absent or misconfigured.
- Use provider authentication libraries or Web Crypto. Never create ad-hoc unsigned tokens or keep secrets in frontend code.
- Apply per-user and per-IP rate limits plus hard usage and billing caps to paid or expensive operations.
- Bound request body sizes before parsing or buffering them.
- Store secrets only in Cloudflare secrets or local ignored environment files. Never commit them.
- Use parameterized D1 queries. Do not build SQL from request data.
- Return minimal errors to clients and keep sensitive details in structured server logs.

## Required review before release

1. Enumerate every new or changed route and classify it as public, authenticated, admin, webhook, or service-to-service.
2. Test horizontal and vertical authorization by changing every user-controlled ID.
3. Test unauthenticated, expired-session, wrong-role, cross-organization, and cross-site requests.
4. Confirm prices and payment state come from trusted server or provider data.
5. Confirm uploads validate assignment, type, size, and private storage access.
6. Confirm public and expensive endpoints have abuse controls and provider spend caps.
7. Run dependency audit, secret scan, build, and focused security tests.
8. Record unresolved risks and block production for critical or high findings.

## Current architecture notes

- D1 does not expose a browser database API, so Supabase/Firebase row-level-security configuration does not apply. Record authorization must live in application queries.
- Field proof storage is private and reads are joined to the assigned technician.
- Dog-food prices are loaded from D1 and Stripe Checkout is created server-side.
- Admin sessions are HMAC-signed; field and office sessions use random tokens stored as hashes.
- Stripe events are signature-verified before payment state changes.

## Operational controls outside this repository

- Enable Cloudflare WAF managed rules and rate limiting for login, quote, onboarding, order, webhook, and integration routes.
- Configure Turnstile on public lead, waitlist, onboarding, and dog-food submission forms.
- Set Stripe and third-party API alerts, restricted keys, and practical spend or usage caps.
- Rotate production secrets on a schedule and immediately after suspected exposure.
- Restrict Cloudflare account access with MFA, least-privilege roles, and audit logs.
- Maintain tested D1/R2 backups and an incident-response contact and recovery procedure.
