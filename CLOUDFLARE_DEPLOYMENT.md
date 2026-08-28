# Cloudflare deployment and backend setup

This project now deploys as a Next.js application on Cloudflare Workers through
OpenNext. The private `/admin/` and `/api/admin/` routes currently use the
application's Basic authentication middleware. Website submissions are stored
in D1, and Sweep & Go data is read or written directly from server routes.

## 1. D1 database

The production D1 database has been created and `wrangler.jsonc` is wired to it:

- Name: `opwp-backend`
- ID: `507e3ffd-5249-4ff1-a72f-463e37dc068e`
- Region hint: `ENAM`

The initial schema has also been applied remotely. Future migrations can be
applied with `npm run db:migrate:remote` after Wrangler is authenticated with
either `wrangler login` or a `CLOUDFLARE_API_TOKEN`.

## 2. Add production secrets

Generate one token in Sweep & Go under Settings > Open API with every needed
permission/event enabled, then run:

```powershell
npx wrangler secret put SNG_API_KEY
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

- `CF_ACCESS_TEAM_DOMAIN` is `https://YOUR-TEAM.cloudflareaccess.com`.
- `CF_ACCESS_AUD` is the Application Audience tag from the Access application.
- Do not enable `ADMIN_DEV_BYPASS` in production.

`SNG_API_KEY` has been set in Cloudflare and verified against the live quote
endpoint.
`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` have also been set in Cloudflare for
an optional Zero Trust layer. The current Worker route uses Basic authentication.
`SNG_WEBHOOK_SECRET` has been set in Cloudflare for the Sweep & Go webhook
receiver.

`NEXT_PUBLIC_DOG_FOOD_TOOL_URL` is read while the Next.js site is built. Set it
as a Cloudflare Workers Builds variable if the tool moves to a new URL.

`NEXT_PUBLIC_AIRTABLE_OPS_URL` controls the Airtable jump link shown inside
`/admin/`. Airtable API integration can be added later with `AIRTABLE_API_KEY`,
`AIRTABLE_BASE_ID`, and `AIRTABLE_OPERATIONS_TABLE_ID`.

## 3. Optional Cloudflare Access edge protection

In Cloudflare Zero Trust:

1. Open **Access controls > Applications** and create a **Self-hosted** app.
2. Protect `ohiopetwastepros.com/admin*` so both `/admin` and every child path are covered.
3. Add an Allow policy containing `craig@ohiopetwastepros.com`.
   `ohiopetwastepros@outlook.com` is temporarily allowed for testing the
   Cloudflare login method and should be removed after one-time PIN is confirmed.
4. Enable one-time PIN or the preferred identity provider and require MFA.
5. Copy the app's Audience tag into `CF_ACCESS_AUD`.

When this Access application is enabled, Cloudflare will show its login before
the request reaches the site's existing Basic authentication middleware.

## 4. Deploy

```powershell
npm run deploy
```

Wrangler is authenticated for `ohiopetwastepros@outlook.com`, and the
`opwp-website` Worker has been created in Cloudflare:

- Worker ID: `b8bfed82ca9a43cdae6bf8501c33a862`
- Current deployed version: `df2ac38a-ed7c-49c2-92b0-c624b7fee73d`
- Worker URL: `https://opwp-website.ohiopetwastepros.workers.dev`

The workers.dev route is active for testing. The `ohiopetwastepros.com` zone can
be attached later when it is active in Cloudflare and the dog-food tool URL has
moved.

Connect the Worker to `ohiopetwastepros.com` in Workers & Pages > the
`opwp-website` Worker > Settings > Domains & Routes. Keep the current site live
until the custom domain, admin login, D1 writes, quote pricing, and onboarding
have all been tested on the Workers preview URL.

## Direct integrations now in place

- `/api/quote`: pulls current price and cross-sells from Sweep & Go.
- `/api/onboard`: idempotently stores the conversion, then creates the customer
  directly through Sweep & Go's residential onboarding endpoint. A retry for the
  same browser funnel cannot create a second customer.
- `/api/waitlist`: stores the request and sends it to Sweep & Go's out-of-area
  lead endpoint.
- `/api/lead`: stores or updates abandoned quotes and questions directly in D1.
  Sweep & Go does not document an endpoint for creating an in-area partial lead,
  so D1 is the private pre-conversion funnel and Sweep & Go remains the CRM and
  customer system of record after conversion. Partial quote entry never implies
  marketing consent.
- `/api/sng-webhooks`: receives Sweep & Go webhook events directly into D1.
- `/admin/`: shows the D1 website inbox plus current Sweep & Go clients, leads,
  dispatch-board jobs, the Sweep & Go event stream, forward-looking business
  health metrics, a selectable KPI dashboard, and a direct link into the
  Airtable operations view.

## Airtable KPI sync

The admin backend can read Airtable schema directly from the protected admin
page, which makes it easier to map KPI tables and fields without exposing
private records. Airtable should become the historical KPI source.
Create or regenerate an Airtable personal access token from Airtable's Developer
Hub with these minimum scopes:

- `data.records:read`
- `data.records:write`
- `schema.bases:read`

Limit the token to the OPWP operations base when possible. Store it as the
Cloudflare secret `AIRTABLE_API_KEY`, then map the KPI table IDs/field names into
the backend. The current admin KPI dashboard already shows live 30-day Sweep &
Go metrics and can be expanded to merge Airtable historical revenue, churn, and
operations data.

The hourly `15 * * * *` pipeline also syncs Google Business Profile reviews
before refreshing the Airtable cockpit snapshot. Configure the four
`GOOGLE_BUSINESS_*` Worker secrets and follow `docs/GOOGLE_REVIEW_SYNC.md`.
The one-time alias-field setup requires Airtable schema-write permission; the
runtime token does not need schema-write permission afterward.

## Sweep & Go webhook cutover

To remove Pipedream/Zapier-style middleware, update the Sweep & Go Open API token
webhook URL to the Cloudflare backend:

```text
https://opwp-website.ohiopetwastepros.workers.dev/api/sng-webhooks?secret=<SNG_WEBHOOK_SECRET>
```

Keep all needed events enabled on the same Sweep & Go token. This one all-events
token replaces:

- Token #2: `OPWP - Job Completed -> Daily Job Log`, formerly
  `https://eo3e8zs2oygqxvu.m.pipedream.net`
- Token #3: `OPWP - Shift Info -> Time & Mileage Log`, formerly
  `https://eoulyyfmkrw4ye8.m.pipedream.net`

The backend stores incoming events in D1 and shows them under the admin
dashboard's Sweep & Go event stream. The admin dashboard also summarizes the
last 30 days of received events into completed jobs, skipped jobs, churn
signals, payroll shifts, payroll hours, and logged miles. The receiver fails
closed unless the request supplies `SNG_WEBHOOK_SECRET` in the
`x-sng-webhook-secret` or `x-webhook-secret` header, or in the `secret`
query parameter. Sweep & Go's token configuration uses the query-parameter form
because it does not expose custom webhook headers. Use a high-entropy value and
URL-encode it when configuring the provider.

## Quote-funnel owner email

Quote leads, questions, waitlist requests, successful SNG onboarding, and failed
SNG onboarding create transactional owner-email records in D1. Status is always
one of `queued`, `sending`, `sent`, `failed`, or `cancelled`; the application only
uses `sent` after the provider returns a message ID. The hourly recovery job
retries eligible failures with bounded backoff.

The adapter targets Cloudflare Email Service. Set the non-secret Worker variables
`OWNER_NOTIFICATION_EMAIL`, `EMAIL_FROM`, and `EMAIL_FROM_NAME`, onboard
`ohiopetwastepros.com` as a sending domain, and add this binding after Cloudflare
Email Sending is active for the account:

```jsonc
"send_email": [
  {
    "name": "EMAIL",
    "allowed_destination_addresses": ["Craig@ohiopetwastepros.com"],
    "allowed_sender_addresses": ["website@ohiopetwastepros.com"]
  }
]
```

Until the binding is active, notifications remain truthfully queued and the
protected `/admin/system-health/` page reports `delivery binding pending`.

## Dog-food URL warning

The requested tool currently lives at the same URL the new site will own:
`https://ohiopetwastepros.com/dog-food/`. The new dog-food page links there now,
but after the domain is moved to Cloudflare that URL would point back to itself.
When the website moves, move the existing tool to a subdomain such as
`order.ohiopetwastepros.com`, provide its actual standalone URL, or migrate the
tool into this repository. Then set `NEXT_PUBLIC_DOG_FOOD_TOOL_URL` to that URL
before rebuilding and deploying.

## Warren integration information still needed

Warren is pending on the tool provider. To add it to the dashboard without
guessing, provide its API documentation, base URL, authentication method, and the
records/actions that should appear in the admin area. `WARREN_API_URL` and
`WARREN_API_TOKEN` names are reserved in the example environment file for that
next adapter.

## Current handoff — July 11, 2026

### Executive backend

- `/admin/` is an executive cockpit for OPWP and Extreme Dog Fuel.
- `/admin/financials/` is the dedicated QuickBooks financial command center.
- Public website chrome is suppressed on admin routes.
- Admin routes currently use the application username/password through Basic
  authentication. Cloudflare Access can be enabled later as an additional edge layer.

### Airtable

- OPWP base: `appcAWPBQB8GmOrcT`.
- Extreme Dog Fuel base: `appc40e3mlfOt2HoA`.
- Live aggregation covers revenue, MRR, customers, churn, job efficiency,
  pipeline, dog-food sales, subscriptions, demand, fulfillment, and inventory.
- KPI targets remain editable in Airtable.

### QuickBooks Online

- The real QBO company is connected in `production` mode.
- OAuth connect, refresh, controlled `401` recovery, reconnect, revoke, and
  disconnect were tested with a full sandbox connect/disconnect/reconnect cycle.
- OAuth tokens are AES-GCM encrypted before D1 storage. Never print or inspect
  secrets or token values.
- Worker secrets: `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI`,
  `QB_ENVIRONMENT`, and `QB_TOKEN_ENCRYPTION_KEY`.
- Redirect URI:
  `https://opwp-website.ohiopetwastepros.workers.dev/api/quickbooks/callback`.
- Migrations `0003`, `0004`, and `0005` add the QuickBooks connection,
  lifecycle environment, and sanitized metadata cache.
- Financials show cash, MTD revenue/net income, monthly trends, margin bridge,
  working capital, balance-sheet position, accounts, and decision framing.
- Receivables/payables aging are unavailable and degrade gracefully.
- QBO currently returns no classified COGS, so gross margin is labeled “Not
  tracked” rather than showing a misleading 100%.
- `intuit_tid` is captured in structured error logs.

### Immediate next steps

Current production Worker version: `df2ac38a-ed7c-49c2-92b0-c624b7fee73d` (2026-07-15 separate least-privilege office route workspace and account controls, complete technician field workflow, address-first live Airtable route checker, on-demand 15-minute freshness guard, immediate inclusion of newly visible active customers, automatic address city/ZIP resolution, premium management sessions, and cadence-aware route intelligence). D1 migrations through `0023_field_proof_fallback.sql` are applied remotely; office access reuses the existing role, credential, and opaque-session schema and required no new migration. Production schedules run subscription truth at `0 11 * * *`, the Airtable cockpit snapshot at `15 * * * *`, and the active route book at `35 * * * *`.

1. Refresh `/admin/financials/` once on version
   `597aec82-26c0-4b65-aee0-fb62a3a3d54f` to populate the sanitized metadata
   cache.
2. Query `quickbooks_metadata_cache` for account/class/location/product names
   and types only—never tokens or customer transactions.
3. Map direct costs, overhead, vehicles, advertising, payroll, owner activity,
   OPWP, and Extreme Dog Fuel.
4. Add editable assumptions for cash reserve, truck affordability, advertising
   capacity, acquisition payback, and hiring capacity.
5. Return to the owner’s 2026 KPI targets after the login decision.

### Working and deployment notes

- Use `npm.cmd` / `npx.cmd` on Windows and `apply_patch` for source edits.
- OpenNext on Windows/OneDrive may emit `EINVAL readlink` warnings from generated
  `.next` files. Remove only the verified generated `.next` directory and retry.
- The worktree contains extensive user-owned uncommitted backend changes.
  Preserve unrelated edits and do not reset the worktree.

## Production hardening requirements

Before production, set independent `ADMIN_SESSION_SECRET` and
`FIELD_AUTH_SECRET` values. Generate at least 32 random bytes for each.
`ADMIN_PASSWORD` is only the login credential and is not a production
signing-key fallback.

Create separate Cloudflare Turnstile widgets for development/staging and
production. Restrict the production widget to `ohiopetwastepros.com` and the
approved Worker preview hostname. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the
Cloudflare build environment and `TURNSTILE_SECRET_KEY` as a Worker secret.
Server-side Siteverify validation is mandatory.

Create the private proof-photo bucket and bind it before production:

1. Run `npx wrangler r2 bucket create opwp-field-proofs`.
2. Confirm `wrangler.jsonc` binds that bucket as `FIELD_PROOFS`.
3. Deploy and verify an assigned technician can upload/read a proof.
4. Verify a different or unauthenticated technician receives 401/404.

The D1 fallback remains available for local testing and emergencies, but the
System Health page will show yellow until R2 is active.

Production status (2026-08-28): the `opwp-field-proofs` Standard R2 bucket is
active and bound privately as `FIELD_PROOFS`. The `OPWP Production Forms`
Turnstile widget is active for the public domain and Worker hostname; its public
site key is supplied by `.env.production`, while its secret is stored only as
the `TURNSTILE_SECRET_KEY` Worker secret.

Apply migrations only after reviewing the remote pending list. The historical
duplicate `0022` filenames must not be renamed because D1 tracks applied
migration filenames. Run `npm run check:migrations` before every deployment,
then apply `0030_production_hardening.sql`.

## Notification provider

No production SMS provider is claimed by this repository. Queued records remain
queued until a provider confirms acceptance. `SMS_PROVIDER` defaults to
`unconfigured`. `QUO_API_BASE_URL`, `QUO_API_TOKEN`, and `QUO_SENDER_ID`
are reserved for a future Quo adapter after the API contract and credentials are
available.

## Deployment roles and cutover

- SOURCE OF TRUTH: GitHub
- STAGING/PREVIEW: Cloudflare workers.dev
- PRODUCTION APP: Cloudflare Worker
- PUBLIC DOMAIN: ohiopetwastepros.com after controlled cutover
- LEGACY SITE: WordPress remains until cutover validation is complete

There is no committed Vercel configuration in this repository. If Vercel remains
connected in GitHub, treat it as preview/status-only until the owner removes the
external integration. A Vercel success status does not mean Cloudflare production
was deployed.

Cutover checklist:

1. Confirm CI, dependency audit, migration check, Next build, and OpenNext build.
2. Set all production secrets and the Turnstile build variable.
3. Create/bind `FIELD_PROOFS` and apply the reviewed D1 migrations.
4. Configure Sweep & Go with the exact HTTPS webhook URL and URL-encoded secret.
5. Verify missing/bad webhook credentials return 401 and a correct fixture is accepted.
6. Verify Stripe webhook signing, QuickBooks callback URI, and connected health.
7. Verify admin, office, field, proof-photo, quote, waitlist, onboarding, and dog-food flows.
8. Review `/admin/system-health/` with no red production blockers.
9. Attach the custom domain to the Worker while retaining a tested rollback path.
10. Run DNS/HTTPS/redirect/SEO smoke tests, then retire WordPress only after sign-off.
