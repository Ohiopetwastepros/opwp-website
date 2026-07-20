# OPWP Operating System — Project Memory

Last updated: 2026-07-20

This file is the durable handoff for future work. Update it after meaningful data-model, KPI, integration, or deployment changes. Never place passwords, API keys, tokens, or other secrets here.

## Current production system

- Executive dashboard: `https://opwp-website.ohiopetwastepros.workers.dev/admin/`
- D1 event ledger: `https://opwp-website.ohiopetwastepros.workers.dev/admin/events/`
- Cloudflare Worker: `opwp-website`
- Current production version: `38403c62-1138-4504-a122-311351049388` (deployed 2026-07-20)
- Route Partner management: `https://opwp-website.ohiopetwastepros.workers.dev/admin/route-partner/`
- D1 database: `opwp-backend`
- Airtable base: `OPWP Operating System`
- Sweep & Go is the operational source for clients, subscriptions, jobs, shifts, and invoices.
- D1 is the immutable event/archive and recovery layer.
- Airtable is the operating ledger used for job, time, customer, target, and supporting records.
- QuickBooks is the accounting source of truth for reconciled financial statements.

## Data flow

1. Sweep & Go sends webhook events to the Cloudflare backend.
2. Every event is saved to D1 before downstream processing.
3. `job:completed` is upserted to Airtable `Daily Job Log` by SNG Job ID.
4. `payroll:shift_info` is upserted to Airtable `Time & Mileage Log` by shift Record ID.
5. Failed downstream processing is marked `needs_attention`, shown in the dashboard, and retried automatically when later events arrive.
6. The executive dashboard calculates KPIs from the cleaned Airtable ledgers plus live SNG and D1 controls.

Pipedream is not required for this flow. Keep old Pipedream workflows paused until several normal operating days have been reconciled; then remove them after confirming there are no exclusive flows still in use.

## KPI definitions and temporary rules

- Route productivity target: at least **$100 allocated route value per paid route hour** for each route technician.
- Recurring visit value: active customer MRR divided by expected monthly visits.
- Team route KPI: Craig + Tony. Bria is measured separately while she has mixed route/office duties.
- Bria temporary rule: for each day with both a completed SNG shift and at least one completed job, route time runs from shift start through 30 minutes after her final completed job, capped at shift end. Remaining shift time is office time.
- Bria’s route revenue, jobs, and route hours are restricted to the same matched dates. Unmatched days are withheld rather than mixed into her rate.
- Service-time review: flag a customer/technician combination only after at least three comparable visits, at least 66.7% overruns, median variance of at least 3 minutes, and median variance of at least 20%.
- Saturday/Sunday jobs are treated as exceptions or peak-season work, not normal recurring capacity.

## Sweep & Go controls

- Live active clients: `/api/v1/clients/active`
- Active clients without subscriptions: `/api/v1/clients/active_no_subscription`
- Dispatch jobs: `/api/v1/dispatch_board/jobs_for_date`
- Active recurring clients are calculated from active clients after excluding one-time clients, clients without subscriptions, missing cleanup frequency, and the test record.
- Current recurring count is fetched live whenever the dashboard refreshes; no Sweep & Go category is required.
- Important webhooks include `job:started`, `job:completed`, `payroll:shift_info`, subscription lifecycle events, and `client:invoice_finalized`.
- `client:subscription_canceled` includes `termination_reason` when SNG has one. Every cancellation is first classified as `scooping`, `dog_food`, or `addon` and stored in the protected D1 `subscription_cancellations` ledger.
- Only the primary scooping subscription counts as an OPWP recurring customer or OPWP churn. Scooping cancellations are upserted into Airtable `Churn Log` with `Is Churn = true`.
- Dog-food subscription cancellations use the shared Airtable `Churn Log` with `Business Line = Dog Food`, but count only in the Extreme Dog Fuel dashboard section and never in OPWP scooping churn.
- Add-on cancellations are operational records only: `is_customer_churn = 0`, excluded from both recurring-customer counts and every churn KPI.
- The canonical cancellation categories are: Too expensive; Moved; Dog died/gone; Don't need service anymore; Dissatisfied; Billing Cycle not suitable; Seasonal; Temporary; Gift Certificate used up; Non-Payment; No reason provided; Modification of subscription type; Reducing expenses; Can not service; Free service ended; Paused no response/Unresponsive; Signed with competitor; Other.
- Airtable preserves SNG's raw `Reason` and `Comment` and stores the normalized selection in `Reason Category`. Only `Don't need service anymore`, `Dissatisfied`, and `Other` require a comment. A missing required comment sets `Review Status = Needs Comment` and appears in the dashboard action queue.
- `Modification of subscription type` never counts immediately as churn. A matching core `client:subscription_created` event closes it as `Plan Replacement`; without a matching event it remains `Needs Validation` for office review.
- Reactivations are displayed separately. They reduce net churn and net lost MRR but never rewrite gross cancellation history.
- `client:subscription_paused` and `client:subscription_unpaused` now maintain a D1 pause episode and update a primary scooping customer to `Paused`/`Active` in Airtable. Add-on pauses do not change customer status or churn.
- Sweep & Go's documented active/inactive feeds and the captured unpause payload do not include a planned return date. Actual duration is calculated when the unpause arrives; intended return dates are stored manually in Airtable `Planned Resume Date` and D1 when known.
- Paused customers are excluded from active route capacity and churn and appear in a separate dashboard return schedule with held MRR.
- One-time jobs are preserved in the Daily Job Log using their SNG service type. Finalized invoice events are preserved in D1 and provide the forward-looking revenue source for one-time work.
- Finalized invoices are also normalized into D1 `sng_invoices`, keyed by Invoice ID. This preserves multiple invoices per customer and separates subscription invoices from one-time revenue.
- `Residential Subscriptions (21).csv` is the 2026-07-13 paid-subscription baseline: 247 active subscription lines across 213 paying cleanup customers; $19,057.50 cleanup MRR plus $984.00 add-on MRR, totaling $20,041.50.
- A Cloudflare cron refresh runs daily at 11:00 UTC. It compares SNG active clients against the D1 baseline, stores client/day state, calculates customer churn and lost MRR, and refuses to replace the prior snapshot if fewer than 80% of baseline customers match.
- Every scheduled subscription refresh writes a success/failure record to D1 `system_sync_runs`. Failed runs or data older than 36 hours appear in the executive owner-attention queue while the last valid snapshot remains active.
- The July 13 paid-subscription export is the active-customer baseline. Only subsequent subscription/status lifecycle events change Active/Inactive state; absence from the SNG active-client API never opens a review, changes status, or changes MRR.
- The SNG active-client API is used only to enrich `Frequency`, `Service Day`, `Service Day 2`, `Assigned Tech`, and `SNG Client ID` in Airtable. Those routing fields refresh during the daily 11:00 UTC cron.
- Confirmed churn requires `business_line = scooping` and `is_customer_churn = 1` in the D1 cancellation ledger. Dashboard churn counts use these confirmed events, not inferred daily absences.
- Seasonal cancellations remain in a separate restart-follow-up pipeline until a reactivation is observed.

## Repairs and validations completed

- Added the first multi-tenant Route Partner operating foundation. The protected
  `/admin/route-partner/` workspace imports dispatched Sweep & Go jobs, preserves
  their order, merges native dog-food tasks by physical address, versions every
  changed route, and records management finalization without writing food records
  back to the CRM. D1 migration `0020_route_partner_foundation.sql` also establishes
  member roles, CRM adapters, combined location/task cards, vehicle load checks,
  completion validation, audit events, and change-request inventory checkpoints.

- Removed 756 duplicate Airtable job rows covering January–July 2026.
- Backfilled 890 SNG completed jobs for the latest 30-day period.
- Removed 616 synthetic `LIVE-` duplicates after numeric SNG jobs were present.
- Added stable employee mapping: Craig `7630`, Tony `9881`, Bria `10080`.
- Corrected Bria’s July 10 shift assignment using the SNG employee ID.
- Narrowed Airtable dashboard queries to prevent Cloudflare Worker subrequest-limit failures.
- Added the protected D1 event viewer, dashboard failure alerts, and automatic failed-event retries.
- Added a live subscription-reconciliation panel that classifies missing Airtable customers, stale Airtable active records, status mismatches, and missing SNG IDs without automatically changing customer status.
- Added daily subscription truth tables and seeded 213 customer records from `Residential Subscriptions (21).csv`. The source CSV remains outside the repository; customer-level values are stored only in protected D1.
- Added the normalized D1 invoice ledger and backfilled the first observed finalized invoice. The first captured invoice is a $116 subscription invoice, so it is correctly excluded from one-time revenue.
- Expanded automatic event recovery to retry both `received` and `needs_attention` records. Recovered stranded completed job `11977016.0` into Airtable after it arrived during a deployment window.
- Confirmed the 2026-07-13 cancellation shown for Tracy contained `termination_reason = Moved`. The haul-away add-on cancellation is non-churn; the `1d-1xW` core-plan cancellation is customer churn.
- Added the protected D1 `subscription_cancellations` ledger and backfilled those two events: subscription `262728` is `scooping` churn and `264295` is an `addon` with `is_customer_churn = 0`. The scooping record was upserted to Airtable; the add-on was not.
- Added a separate 30-day dog-food churn KPI and detail table to the Extreme Dog Fuel dashboard. Dog-food churn never enters OPWP churn, and add-ons never count as recurring customers or churn.
- Closed the 11 false subscription-status reviews created from active-feed absence. The dashboard hides the event-driven review panel when there are no genuine lifecycle exceptions.
- Audited 2,951 completed jobs since April against all Airtable active customers. Backfilled 148 missing primary service weekdays, populated all twice-weekly second weekdays, and found zero conflicts with the 71 assignments that were already present.
- Reconciled Airtable to 213 active recurring customers using the July 13 export plus later lifecycle events. Ryan Fry is active from a subscription-unpaused event; Pat Freeman is inactive from a primary-scooping cancellation. Allen Williams was added from the paid export and July 14 job event.
- All 213 active Airtable customers now have Frequency and Service Day populated; every twice-weekly customer has Service Day 2. Terri Moore is `Twice Weekly`, Monday/Thursday.
- Extended Airtable `Churn Log` with Business Line, Reason Category, Review Status, Subscription ID, Replacement Subscription ID, Reactivated Date, Reviewed Date, Eligibility Status, and Eligibility Evidence.
- Re-audited all 105 lifecycle rows dated in 2026 against Airtable completed-service history and current customer continuity. The validated ledger now contains 29 confirmed churn rows with completed-service evidence, 33 plan-change/continuity corrections, three owner-confirmed never-started rows (two Allie Leatherman rows and one Claude Jones row), 13 historical cancellations awaiting payment validation, and 27 previously excluded lifecycle rows. Amanda Freyer is a plan change and remains active.
- Future cancellation processing now checks all recent replacement-subscription events, completed-service history, and paid D1 invoice evidence. Unproven cancellations are excluded with `Needs Validation`; a later replacement automatically closes the row as `Plan Change`.
- Growth & Retention now supports trailing-week, trailing-month, and custom date-range churn reporting, with a validated event log, reason mix, MRR impact, and a separate eligibility-review queue.
- Eliminated live Airtable pagination from dashboard login. A dedicated hourly cron refreshes a raw Airtable cockpit snapshot into D1; every backend view calculates its metrics from that snapshot. The last valid snapshot remains available if Airtable fails, and stale/failed refreshes appear in the owner-attention queue without taking the dashboard down. Initial production snapshot captured successfully at `2026-07-14T18:12:30.147Z` (487,607 bytes).
- Added gross cancellations, reactivations, net churn, net lost MRR, cancellation-reason mix, and seasonal restart follow-ups to the executive dashboard. One-time jobs and add-ons are excluded from every churn metric.
- Corrected the D1 cancellation ledger for Tracy Keene (`Moved`, $93 lost MRR) and Pat Freeman (`Dog died/gone`, $80 lost MRR). The haul-away add-on remains excluded.
- Owner-validated lifecycle corrections on 2026-07-14: Michelle Bostater is a one-time client with both June 29 and July 3 jobs classified `one_time` and no churn; Lee Warren is paused for financial reasons; Karl & Nikole Landrum are paused with an August 1 planned restart; Cortia French is true scooping churn for `Paused no response/Unresponsive` ($90 MRR); Joe Wichman is true scooping churn for `Don't need service anymore` ($146 MRR).
- Added D1 `subscription_pauses`, Airtable `Planned Resume Date`, automatic pause/unpause processing, and the executive paused-customer return schedule.
- Reorganized the executive cockpit into six decision views selected from the sidebar: Executive Overview, Route Operations, Growth & Retention, Extreme Dog Fuel, Management Scorecard, and Systems & Controls; Financial Performance remains the dedicated QuickBooks page.
- Replaced the all-in-one landing page with an enterprise recurring-run-rate hero, four value-driver views, an owner action queue, and today's operating pulse. Detailed tables no longer compete with the executive overview.
- Added `docs/EXECUTIVE_DASHBOARD_MODEL.md` as the metric and information-architecture contract, including current sources and the next decision-grade measures required for each sidebar view.
- Production includes the separated cancellation pipeline. Confirm whether Sweep & Go can send the configured webhook secret before enforcing secret-required requests; current delivery uses the proven compatibility behavior.
- Excluded invalid zero/missing accounting fields from being presented as valid working-capital results.
- Added the D1-backed active-subscription route book and protected Route Intelligence view. All 213 active addresses are geocoded and cached; the model sequences 224 service-day memberships across 18 technician/day sectors with Geoapify road-time matrices and refreshes after the hourly Airtable snapshot at minute 35.
- Route planning distinguishes 213 active customers from 179.75 weekly-equivalent visits: 116 weekly, 84 biweekly, 10 twice-weekly, and 3 monthly. Current-week cadence is anchored from each customer's latest completed Airtable service date: 86/87 biweekly/monthly accounts are anchored; Melissa Furrie is the sole unanchored cadence account and remains included pending a completed service date.
- Twice-weekly/two-day assignments are locked, established territory areas are preserved, and all flexible-day suggestions require owner approval. No route recommendation writes back to SNG or Airtable automatically.
- Route economics now compare recurring revenue per scheduled visit with modeled service plus road time against the $100/hour target. Multi-technician ownership, depot travel, and alternating cohorts remain explicit limitations rather than hidden assumptions.
- Found one routing-source exception: Casey Lucio is marked `Weekly` but has Tuesday and Thursday service days. Both days remain locked and the Route Intelligence page flags this for source confirmation.
- Replaced the initial Tony-only runway with a road-calculated future-state scenario: Craig retains one dense Monday field route and transitions to office leadership Tuesday-Friday; Tony becomes the five-day field anchor; Bria owns complementary Monday/Tuesday/Thursday books. All service days stay unchanged and nothing writes back.
- The current-week model regroups 49 customers by same-day geography, reduces modeled open-route mileage from 385.5 to 372.3 miles, and yields 51.7 team field hours at $93.50/hour before depot/break time. Monday still needs three technicians: Bria 30 stops/41.2 miles/$95.60 per hour, Craig 10/27.2/$95.10, and Tony 16/59.0/$65.00.
- Tony's modeled five-day book is approximately 31.6 recurring field hours. Tuesday ($84.10/hour) and especially Monday ($65.00/hour) remain below target, proving that same-day technician reassignment alone cannot reach $100/hour without selective service-day density changes or additional nearby revenue.
- Added a read-only selective service-day test that excludes every twice-weekly/two-day account and performs a full road-time recalculation before promoting a move. The first package tested Greg Gladieux Thursday-to-Wednesday plus Dana Mocek and Tim Mitchell Monday-to-Friday; it was rejected because mileage rose from 372.3 to 383.6, planned time rose from 3,102.4 to 3,123.2 minutes, and team rate fell from $93.50 to $92.90/hour. No source records changed.
- Model version 7 now tests Monday candidates independently against the complete affected Monday/destination routes. Dana Mocek Monday-to-Friday is the only currently validated candidate: -1.9 miles, -15.2 planned minutes, and +$0.50/team-hour. Tim Mitchell Monday-to-Friday is rejected: +16.1 miles, +45.4 minutes, and -$1.40/team-hour. Denise Knicely Monday-to-Thursday remains unvalidated because her biweekly cohort is not due in the modeled week. The dashboard displays these verdicts and never writes a day change automatically.
- Rebuilt `OPWP_Route_Assignment_Tool_V12.xlsx` as a live protected onboarding workflow. V12 remains an unchanged reference; its static formula (`ZIP density × 6 + city density × 3 + cohort match × 2 − day load × 1.5 − tech load`) and manual import queues are replaced by the current Airtable/D1 active book, cached street coordinates, Geoapify road-time insertion, route capacity, projected route revenue/hour, current territory density, and the Craig-office/Tony-full-time staffing model.
- Every recurring website onboarding now receives an automatic route recommendation before the SNG onboarding request. The result is retained in D1 `onboarding_route_assignments`, appended to the internal SNG account note, and shown in the Route Intelligence automatic-onboarding queue. One-time jobs are excluded. Existing twice-weekly commitments remain locked; new twice-weekly onboardings are evaluated as allowed day pairs, with Sylvania fixed to Tuesday/Thursday.
- Simplified the protected route checker to one full-address field plus frequency; service minutes and core monthly revenue are optional planning inputs. The address is street-matched and its city/ZIP are resolved automatically. Before every manual check or recurring website onboarding, the system refreshes Airtable when the protected cockpit snapshot is more than 15 minutes old. Newly visible active customers are folded into the closest current route sector even if the scheduled route-plan job has not run yet. A refresh failure is logged to system health and visibly falls back to the last valid snapshot instead of blocking the customer workflow.
- Added a separate least-privilege office workspace at `/office/` with its own `/office/login/`, office-session cookie, and `/api/office/route-assignment/` boundary. Office dispatchers can use the live address-first route checker and see the automatic onboarding queue, but cannot access executive, financial, churn, technician, or systems APIs. Management creates, resets, deactivates, and reactivates individual office email + six-digit PIN accounts from Route Intelligence. Office identities reuse the encrypted/HMAC team credential and opaque D1 session foundation without sharing the management credential.
- The backend also includes a protected manual simulator for street address, frequency, estimated service minutes, and core monthly revenue. It ranks all five days with added road minutes/miles, modeled technician, projected route hours, projected revenue/hour, regional density, and the three nearest active customers. Simulations do not create customers or persist queue rows.
- The Sweep & Go onboarding integration has no proven service-day write field. Recommendations therefore require office confirmation in SNG; the system does not invent or send an unsupported schedule parameter.

## Known exceptions

- SNG recurring clients and Airtable active customers do not yet reconcile exactly; SNG remains the current recurring-customer source of truth.
- Historic D1 job events are incomplete because the event ledger began recently. Bria’s temporary split becomes more representative with each matched workday.
- Historic non-recurring jobs exist in Airtable, but many have zero job-level revenue. Finalized SNG invoice events are the preferred revenue truth going forward.
- The invoice webhook feed is connected, but the observed event history begins recently; a “30-day” total is only fully comparable after 30 days of continuous capture.
- Tony’s `SHIFT-692278` on 2026-06-18 contains 8,588 miles and must be corrected or excluded.
- Dog-food inventory contains negative quantities and needs source reconciliation.
- QuickBooks working-capital inputs are incomplete when current-assets/current-liabilities fields are absent.
- Planned pause return dates remain an office-entered field unless Sweep & Go begins including one in a future webhook payload. Landrum is currently scheduled for 2026-08-01; Lee has no planned return date recorded.

## Deployment notes

### 2026-07-15 premium management-access checkpoint

- Replaced the browser-native Basic Authentication prompt with a branded OPWP management sign-in at `/admin/login/`.
- Admin credentials now create a signed, HttpOnly, SameSite=Lax session that expires after 12 hours; the existing `ADMIN_USERNAME` and `ADMIN_PASSWORD` Worker secrets remain the credential source.
- Added D1 migration `0021_admin_login_security.sql` and a hashed-IP login-attempt ledger. Five failed attempts within 15 minutes temporarily block further attempts without storing raw IP addresses.
- Protected page requests redirect to sign-in, protected API requests return structured `SESSION_REQUIRED` JSON, expired client sessions return to sign-in automatically, and management has an explicit sign-out control.
- Rebuilt Route Partner as a focused import -> review -> release workspace with larger typography/touch targets, clear zero-data state, responsive desktop/mobile layouts, status messaging, and a confirmation dialog before final release.
- Admin pages now suppress both the public site header and public footer so the management workspace feels like a standalone application.
- Production Worker `44cef2b5-f9dd-4671-8e29-012e4e401deb` is deployed at 100%. Verified: login `200` without `WWW-Authenticate`, session status `200`, unauthenticated Route Partner redirect `307`, protected API `401`, and public dog-food page `200`.

### 2026-07-15 technician field-app checkpoint

- Built the complete initial mobile technician workflow at `/field/` and individual field access at `/field/login/`; account and assignment control lives at `/admin/route-partner/team/`.
- Route release now creates a shift, required truck load, food-payment gate, and inventory requirements. The field workflow records mileage, breaks, arrivals, task state, food proof/placement, inventory disposition, and route closeout.
- Scoop tasks require a second validation against Sweep & Go completion. Management route control now exposes CRM validation and field exception approval/denial.
- The repeatable local two-stop field simulation passes all authenticated operations, including private photo upload/readback and inventory closeout.
- Cloudflare R2 is not enabled on the account, so the initial release uses compressed D1 proof storage capped at 1.25 MB. Connect R2 before broad rollout.
- Customer texts are recorded in the notification outbox but are not sent until a messaging provider is connected.
- Full workflow and test handoff: `docs/TECHNICIAN_FIELD_APP.md`.

- The project currently lives inside OneDrive, which has locked and duplicated generated build artifacts.
- Recommended permanent location: `C:\Projects\opwp-website-next` (outside OneDrive).
- Preserve the current OneDrive folder as a backup until the moved copy builds and deploys successfully.
- For deployment from the current location, copy the full project to a local temporary folder, including real `node_modules`, while excluding `.next`, `.open-next`, and `.git`; then build and deploy from the temporary copy.
- Do not use a `node_modules` junction for the deployment copy; a previous junction produced a runtime 500 because required symlinked packages were missing.

## Where to resume

1. Sign in at `/admin/login/`, continue to `/admin/route-partner/`, select a known dispatched date, and run the first management-controlled read-only import. Confirm technician ownership, SNG stop order, combined-address cards, and the empty/native food behavior before finalizing any route. Do not enable customer messages, payments, or technician release yet.
2. Confirm Melissa Furrie's cadence cohort from her next completed SNG job and confirm Casey Lucio's Weekly versus Tuesday/Thursday source conflict. Then add depot/start-end travel, paid shift hours, and isolated-stop cost before treating route revenue/hour as the final paid-hour KPI. The first selective service-day package was road-tested and rejected, so focus next on Monday territory compression/additional nearby revenue rather than implementing those three day moves.
3. Confirm the next real pause webhook creates an Airtable pause row and the next unpause closes its D1 duration. Add a dashboard overdue-return alert once at least one real pause cycle has been observed.
4. Resolve the 13 `Needs Validation` historical cancellations by confirming whether a paid invoice existed before cancellation; keep them excluded unless payment evidence establishes a real customer relationship. Then complete any remaining required churn comments.
5. Observe at least five normal Bria workdays, confirm the 30-minute cutoff matches actual office transitions, and then decide whether to include her in a combined team rate.
6. Capture one real one-time job and its `client:invoice_finalized` event end to end; verify job ID, client, service date, invoice ID, amount, and payment status can be tied together without double counting.
7. Correct the invalid mileage row and negative dog-food inventory before using those totals for decisions.

## Start-of-session checklist

- Read this file and `git status` before editing.
- For dog-food work, also read `docs/DOG_FOOD_SYSTEM.md` and update its checkpoint after every meaningful UI, workflow, integration, data-model, or deployment change.
- Preserve all existing user changes; the worktree intentionally contains ongoing work.
- Check the production dashboard and D1 ledger health.
- Compare today’s SNG jobs, completed webhook events, Airtable job upserts, and shifts.
- Verify failures are either automatically recovered or explicitly shown in the owner-attention queue.
- Build, test, deploy, and verify both `/admin/` and `/admin/events/` after production changes.
# July 20, 2026 — full product audit checkpoint

- Completed the cross-product production audit covering the public website, dog-food funnel, office access, Route Partner management, and technician field app.
- Optimized referenced photos and branding to WebP (88% reduction across 18 referenced photographs).
- Fixed the weight-free dog-food questionnaire/order mismatch and hardened same-day, consent, placement, contact, plan, and customer-type validation.
- Hardened the field workflow state machine and completion/inventory/mileage rules.
- Added protected management review of technician delivery-proof photos.
- Added global focus, reduced-motion, touch, dialog, and security-header improvements.
- Added `scripts/dog-food-smoke.mjs` and expanded `scripts/field-smoke.mjs` guardrail coverage.
- Full findings and remaining external integration boundaries are in `docs/PRODUCT_AUDIT_2026-07-20.md`.

# July 20, 2026 — standalone dog-food commerce checkpoint

- Established D1 and the OPWP application as the source of truth for every dog-food subscription. Do not create food subscriptions in Sweep & Go, including for existing scooping customers.
- Added the protected `/admin/dog-food/` operations workspace for customers, orders, payment status, recurring subscriptions, delivery dates, and inventory visibility.
- Added guarded internal order entry and auditable manual payment confirmation. The temporary flow requires management to charge the card in Sweep & Go/CardPointe first and then record the unique external transaction reference; the OPWP action never claims to charge the card.
- Website checkout now creates a normalized unpaid commerce order in addition to its retained submission record. New monthly requests cannot be marked paid or activated until management confirms the first route delivery date.
- The first successful payment activates one native four-week subscription per customer/address and merges multiple formula lines into it. Duplicate payment references and duplicate captured payments are rejected.
- Jim Hansen order `EDF-JH-20260720-01` remains delivered and payment due for one Red 30-20 and one Blue 26-14 bag. The confirmed $59-per-bag rate corrects it to $118.00 subtotal, $9.14 tax, and $127.14 total. Do not mark it paid until the real SNG/CardPointe charge is completed.
- Unpaid dog-food orders are editable from the operations dashboard. Management can revise bag quantities, order type, delivery timing/date, and placement; pricing and tax recalculate from the active catalog. Product/price edits lock after a captured payment.
