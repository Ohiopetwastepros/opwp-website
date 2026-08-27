# OPWP Repository Instructions

Security is a release requirement for every change in this repository.

- Read `docs/SECURITY_BASELINE.md` before changing authentication, APIs, databases, uploads, payments, webhooks, integrations, or infrastructure.
- Treat browser input, URL identifiers, headers, cookies, webhook payloads, and third-party responses as untrusted.
- Enforce authentication, record ownership, organization scope, role permissions, prices, feature access, and payment state on the server.
- Add abuse controls and bounded inputs to every public, login, upload, or expensive endpoint.
- Keep secrets out of source and frontend bundles. Use Cloudflare secrets and ignored local environment files.
- Fail closed when security configuration is absent or invalid.
- Before handoff, run the production build, dependency audit, relevant security tests, and `git diff --check`.
- Do not deploy with unresolved critical or high-severity security findings.
