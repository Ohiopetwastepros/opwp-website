# Dog Food System

## Current build checkpoint

Last updated: 2026-07-20

- Live tool: `https://opwp-website.ohiopetwastepros.workers.dev/dog-food/`
- Current production version: `3d075ca2-22c3-4784-9172-1d05d50ae78f`
- Protected Route Partner workspace: `https://opwp-website.ohiopetwastepros.workers.dev/admin/route-partner/`
- Protected route dashboard: `https://opwp-website.ohiopetwastepros.workers.dev/admin/routes/`
- Protected dog-food operations workspace: `https://opwp-website.ohiopetwastepros.workers.dev/admin/dog-food/`
- Primary UI files: `app/dog-food/DogFoodOrderTool.js` and `app/dog-food/dog-food.module.css`
- The customer journey currently has four steps: blends and gated price, dog profiles, recommendations, and order/delivery.
- Price is revealed only after first name, last name, email, mobile phone, and SMS consent are complete.
- Each blend opens an accessible inline detail panel with overview, ingredients, and guaranteed analysis.
- Dog names and exact dog weight have been removed. Breed-size range is used with life stage and activity to estimate four-week food usage.
- A household can add up to ten dogs. Later dogs can reuse an earlier dog’s formula without repeating the questionnaire.
- The dog questionnaire uses distinct blue, amber, purple, and green category sections.
- Every individual question group now has its own clearly bordered panel with a persistent legend, required badge, contained option tiles, and section-colored focus/selection states. This was deployed on 2026-07-13.
- On 2026-07-14, the question-card markup was refined so the visual border sits on a wrapper outside the semantic fieldset. This removes the broken border line behind legends and required badges, tightens section padding, and creates more consistent spacing between labels and answer tiles.
- A full questionnaire fit-and-spacing pass was deployed on 2026-07-14: joint-support choices reflow into three columns instead of five compressed columns, binary health answers stack vertically inside equal-width cards, required badges cannot collapse, long labels wrap more naturally, and phone layouts use one full-width answer per row.
- A full responsive code audit was deployed on 2026-07-14. Paired questionnaire groups now stack cleanly at tablet widths, the questionnaire's higher-specificity desktop padding is explicitly reset on mobile, navigation buttons wrap without overflow, dog headers wrap cleanly, narrow-phone hero type is reduced, and expanded blend details switch to a centered single-column layout below 480 px.
- The purple "Current condition and goal" section was refined on 2026-07-14: its two question groups now use separate full-width rows instead of compressed half-width panels, desktop and tablet choices remain evenly distributed across three columns, and phone choices stack one per row.
- The onboarding flow was streamlined on 2026-07-14. Continue and Back now move focus and scroll directly to the top of the active tool before the next interaction, mobile controls use direct touch handling and shorter transitions, steps 1–3 use the full application width without a duplicate sidebar, the order summary appears only at checkout, and the repeated product-lineup and route-marketing sections below the form were removed.
- Checkout terminology was clarified on 2026-07-14. Customer types are now Current scooping customer, New route partner customer, and One-time delivery only; order types are Monthly delivery and One-time order. Selecting a one-time customer sets a one-time order, while selecting a new route partner sets monthly route delivery.
- The four Extreme Dog Fuel bag PNGs have transparent corners and preserve the original packaging artwork.
- Production checkout does not charge a card yet. It now creates both the retained form submission and a normalized unpaid commerce order so the request appears in dog-food operations.
- Dog-food subscriptions are owned exclusively by the standalone system, including subscriptions for existing scooping customers. Sweep & Go must not contain parallel dog-food subscriptions.
- During the payment transition, management charges an existing card manually in Sweep & Go or CardPointe and records the unique transaction/invoice reference in dog-food operations. No card data is copied into D1.
- SNG `client_payment_accepted` webhooks now reconcile automatically when the SNG client ID, exact amount, one recent finalized invoice containing only dog-food lines, and one open dog-food order all match uniquely. Ordinary scooping payments and ambiguous matches remain unlinked instead of guessing. The SNG reference number is the idempotency key.
- Automatic financial mutation additionally requires a verified `SNG_WEBHOOK_SECRET`. Compatibility-mode or incorrectly authenticated payment events are retained as unverified archives and cannot mark an order paid; management can use the audited manual confirmation fallback if SNG does not send the configured credential.
- A website monthly request must receive a confirmed first delivery date before its first payment can be recorded. Confirming that first payment activates one four-week standalone subscription and schedules the next charge 48 hours before the next delivery.
- The protected dog-food workspace centralizes customers, orders, payment state, monthly subscriptions, product availability, and inventory visibility. It deliberately keeps payment confirmation separate from delivery completion.
- The first route-intelligence backend was deployed on 2026-07-14. `GEOAPIFY_API_KEY` is present as a write-only Cloudflare secret, and the integration keeps the key server-side.
- D1 migration `0016_route_intelligence.sql` adds a reusable address geocode cache, analysis-run ledger, and aggregate route-day metrics. Customer addresses are never returned in the route-analysis response or written to Worker logs.
- The protected `/api/admin/route-intelligence` endpoint imports one chosen Sweep & Go dispatch date, normalizes technician/route/sequence/address/service-time fields, geocodes only uncached addresses with a configurable hard cap, and calculates ordered drive miles, drive minutes, service minutes, planned minutes, and remaining time against the initial eight-hour target.
- A route analysis does not reorder technicians or create delivery jobs. It is an observation layer only until the live Sweep & Go field coverage and routing calculations have been reviewed.
- Production verification confirms the new endpoint rejects unauthenticated requests and all three route-intelligence tables exist. The first live dispatch analysis remains pending because production admin credentials are not stored in the workspace and Cloudflare secrets cannot be read back.
- Airtable route-source coverage was audited directly on 2026-07-14 without exposing customer data. It contains 4,720 completed jobs and 213 active customers. Active-customer address and ZIP coverage are both 100%; completed-job technician coverage is 98.6%, estimated-time coverage is 90.1%, and actual-time coverage is 88.6%.
- Airtable can automatically select representative dates and join each Daily Job Log row to the Customer Master for its address. The Daily Job Log currently has 0% address coverage and no Route Sequence field, so Airtable alone cannot reproduce the technician's actual historical stop order. The route engine should use Airtable as the primary planning/history source, calculate an efficient order with Geoapify, and use Sweep & Go for dispatch-order and scooping-completion validation. Food-delivery tasks remain native to the standalone Route Partner application.
- July 9, 2026 is the current first representative test date: 55 completed jobs, 100% technician coverage, and 87.3% actual-service-time coverage. July 6 is a useful higher-volume comparison with 69 jobs and 100% technician coverage.
- The protected route dashboard was deployed on 2026-07-14. It selects a strong Airtable comparison date, displays data quality before analysis, geocodes uncached addresses server-side, uses a Geoapify drive-time matrix to calculate an efficient open route for each technician, and reports stops, service time, drive time, miles, planned time, remaining capacity, and eight-hour utilization without exposing customer addresses to the browser.
- A zero-geocode validation of July 9 joined all 55 jobs successfully: Tony had 32 stops with 180 service minutes and 87.5% actual-time coverage; Bria had 23 stops with 178 service minutes and 87.0% actual-time coverage. The first authenticated production matrix run remains a deliberate admin action because it consumes Geoapify credits.
- The dashboard explicitly preserves twice-weekly service pairs and established weekday areas. Bowling Green-to-Friday and Tony/Bria workload changes are labeled as controlled future scenarios, not automatic schedule changes.
- On 2026-07-15, the operating direction was locked around a CRM-independent standalone Route Partner application. It will import and validate scooping work, combine it with native dog-food tasks in one technician route, own delivery proof and exceptions, and support company-specific rules, billing, inventory, distribution centers, and CRM/CSV adapters.

### Next product decisions

1. Finalize 20 lb bag cost, retail price, and opening inventory by formula.
2. Select the payment processor and recurring card-on-file architecture.
3. Define and build the first standalone technician-route MVP: imported scooping tasks, native food tasks, one location card, management route finalization, CRM completion validation, delivery proof, and structured exceptions.
4. Open the protected route dashboard and run the first authenticated Airtable/Geoapify analysis for July 9, then review drive time and daily capacity before building technician-assignment and Bowling Green Friday comparisons.
5. Connect Quo for partial-quote, change-request, delivery-status, and payment-failure SMS automation after the customer flow is approved.
6. Reconcile physical dog-food inventory before enabling stock-based customer promises.
7. Supply the route-cost inputs: exact depot/start location, loaded technician cost per hour, vehicle cost per mile, break policy, and expected dog-food stop time.

Update this checkpoint after every meaningful dog-food UI, workflow, data-model, integration, or production deployment change. Never store API keys, tokens, payment credentials, or customer data in this file.

## Operating model

Cloudflare D1 is the transactional source of truth. It owns customers, dogs,
recommendations, orders, subscriptions, payments, inventory movements,
purchasing, route assignments, and delivery proof.

Airtable is the management and reporting layer. It should receive summarized or
mirrored operational data from D1, but checkout and inventory deductions must not
depend on a manual Airtable edit succeeding.

Sweep & Go is a read-mostly route adapter for OPWP. Its customer, technician,
dispatch, and completion information can be imported to place deliveries into
existing service routes and validate scooping work. Dog-food customers, jobs,
subscriptions, payments, product lines, inventory, technician delivery proof,
and management approvals remain independent of the CRM. A future CRM write-back
is optional rather than required for the core workflow.

## Standalone Route Partner application

- The Route Partner application is the source of truth for the approved combined
  route, but a connected-CRM technician may use it in companion mode to minimize
  app switching. During the MVP, the combined plan preserves the approved CRM
  scooping order and inserts native food stops between or at those locations. The
  technician remains in the CRM for ordinary scooping work and is interrupted by
  a Route Partner notification only when the next location has food work. CSV-only
  or no-CRM companies use the standalone route as the foreground daily app.
- Imported scooping jobs remain externally owned. The application must validate
  their completion from CRM status/webhook data and deep-link to the CRM when the
  technician needs to perform a scooping action there.
- Dog-food customers do not require a CRM customer record. Dog-food delivery jobs,
  status, photos, placement instructions, exceptions, and completion live in the
  Route Partner application.
- No dog-food subscription is created in Sweep & Go or another scooping CRM. All
  food recurrence, payment, inventory, route placement, customer messaging, proof,
  and delivery history are facilitated through the Route Partner application.
- One physical address is one location card. If scooping and food occur together,
  the card contains two separately validated tasks without duplicating the stop.
- Management controls route changes. Technicians may report exceptions but do not
  silently reorder or reassign the approved plan.
- GPS is captured at dog-food completion rather than continuously. Imported CRMs
  may separately provide last-known location and job start/completion events.
- The current route starts at whichever approved task is first, whether scooping
  or food. A future office-start clock policy remains configurable.
- Delivery proof has a customer-visible photo and a separate private technician
  note. The app must support unavailable customer, unsafe access, wrong address,
  inventory missing, and other structured failure reasons with distinct follow-up
  workflows.
- Customer portal edits create management change requests. Approval or denial is
  sent by text; a denial requires a management reason. Customers do not directly
  rewrite a locked route, subscription, or inventory commitment.
- The initial catalog is Extreme Dog Fuel, while company-level product catalogs
  remain extensible for future brands.
- Every route partner company owns its own billing, customers, inventory, route
  rules, technicians, payment processing, and operating decisions. OPWP helps set
  up the platform but does not operate another company's business.
- Each company sources inventory through an assigned distribution center. OPWP
  may become the Ohio/Michigan distribution center without becoming the retailer
  or merchant of record for another route partner.
- A CSV-import company must confirm the final daily route after making same-day
  changes. Direct integrations should re-sync and reconcile automatically.
- Dedicated food routes or food-only technicians are allowed only when route
  economics support them; dense placement on existing scooping routes remains the
  preferred low-cost fulfillment model.
- Routes are normally prepared the prior day. Because summer technicians may
  start at 6:30 AM, the system needs a technician-specific release checkpoint
  before that technician starts; 7:00 AM can be the general management deadline
  but cannot be the release time for an already-started route.
- Each vehicle may carry a controlled buffer by SKU. A same-day insertion requires
  successful payment, management approval, confirmed on-vehicle quantity, route
  capacity, and a new approved route version. The system may never assume that
  warehouse inventory is physically available on a technician's vehicle.
- The inventory ledger treats each vehicle as a location. Technician load-out,
  delivery, retained buffer, return to distribution center, damage, and missing
  inventory are separate movements or checkpoints.
- Geoapify optimizes an imported copy and does not rewrite Sweep & Go. The approved
  standalone route is the technician's authoritative sequence; the technician
  opens the matching Sweep & Go job only to perform and complete the CRM-owned
  scooping task. CRM order differences are expected and are reconciled by external
  job ID rather than list position.
- Management receives a proposed placement when a new scooping job appears after
  CRM dispatch. No finalized route is revised silently.
- A CRM-owned scooping completion that is not validated within 30 minutes enters
  an exception state, followed by an end-of-day reconciliation. Webhook delay does
  not prevent the technician from continuing the approved route.
- Technicians have individual accounts. The finalized route is available offline;
  food completions, GPS, notes, and photos queue locally and sync when connectivity
  returns.
- Failed-delivery reasons initially route to management. Management determines
  redelivery, customer action, vehicle retention, or return, and explicitly records
  whether the bag returns to available inventory. Reason-specific automation may
  replace this manual checkpoint only after the workflows are proven.
- On early-start days, management performs a route reconciliation and release by
  approximately 6:15 AM for technicians who may begin at 6:30 AM. The general
  7:00 AM deadline applies only to routes that have not already started.
- Before leaving, each technician completes an individual pre-departure check for
  the released route version and vehicle. They confirm reserved delivery bags and
  buffer quantity by SKU, identify shortages or substitutions, cache the route for
  offline use, and acknowledge that the physical truck load matches the manifest.
  A shortage blocks the affected delivery until management resolves it.
- Food-delivery on-the-way notifications offer 10, 15, 25, 30, 45, and 60 minute
  choices, matching the familiar Sweep & Go workflow. The app recommends one of
  those intervals from remaining service time at the current task, live route
  progress, and calculated drive time to the delivery. The technician confirms
  before sending during the pilot; automatic sending may be enabled after actual
  timing accuracy is proven.
- Every food on-the-way message is sent by the Route Partner application, including
  a combined scooping-and-food location. The app owns the food-specific wording and
  delivery status; it must prevent a duplicate food notification from being sent
  through the CRM.
- The ETA recommendation is recalculated as work progresses, rounds to a truthful
  supported interval, sends no more than one normal on-the-way message per delivery,
  and does not queue a stale notification while offline.
- In Sweep & Go companion mode, completion of the CRM job immediately preceding a
  food stop triggers a technician alert such as "Dog food delivery next." A
  combined location is flagged before arrival and again before the technician
  leaves if its food task remains open. After food completion, the app identifies
  the next CRM stop and returns the technician to the normal scooping workflow.

## Route intelligence decisions

- Geoapify is the recommended pilot mapping provider because one REST platform
  supplies address validation, geocoding, routing, and route matrices; its free
  tier is sufficient for initial OPWP testing; and geocoded results can be cached
  in D1. The integration must sit behind a provider adapter so another route
  partner can use a different mapping vendor later.
- The Sweep & Go `jobs_for_date` feed is OPWP's initial route source. Route
  snapshots are imported into D1. The Route Partner application owns the final
  food-delivery task; creating a corresponding CRM job is optional write-back.
- Sweep & Go normally creates the following day's jobs at midnight and can be
  configured to dispatch up to seven days early. The adapter must track whether a
  route is projected, dispatched, reviewed, or management-finalized. If a new CRM
  customer appears after dispatch, Sweep & Go may require a custom scooping job;
  this does not prevent an external food task from being inserted into the
  standalone combined route.
- A new address is geocoded once and cached. Candidate placement is scored by
  actual incremental drive time and mileage, not ZIP code alone.
- For an insertion between stops A and B, incremental drive is calculated as
  A-to-delivery plus delivery-to-B minus A-to-B. Delivery service minutes are
  then added to calculate the true workload impact.
- Planned route workload includes service minutes, drive minutes, dog-food stop
  minutes, breaks, depot travel, and an operating buffer. The initial ceiling is
  an eight-hour day, with the final schedulable ceiling set after OPWP supplies
  its break and buffer policy.
- Route profitability is contribution margin minus incremental labor, vehicle,
  and mileage cost. The current ten-minute or three-mile insertion reference is
  a starting guardrail only; actual acceptance must be based on OPWP cost inputs
  and margin per bag.
- Existing scooping customers are offered their next scooping service date only.
  No alternate date is shown unless that service date is unavailable.
- Route partner customers are shown the best two qualifying route dates in the
  next seven days. Search expands to fourteen days only when the first window
  does not produce enough valid choices.
- One-time customers see free qualifying route dates when available, plus paid
  next-day or same-day service when capacity permits. If no free route match
  exists, the paid choices or manual confirmation are shown.
- Monthly recurrence advances the selected date by one calendar month, then uses
  the closest profitable route date. An earlier date wins a tie so the customer
  is less likely to run out of food. Holiday and route-change adjustments choose
  the date with the smallest route detour.
- Route density and candidate days are recalculated for each upcoming cycle.
  The displayed next date is provisional until the pre-delivery notification,
  and no confirmed date changes silently.
- Customers may request a delivery change until 48 hours before the scheduled
  date. Management approves or denies the request, denials require a reason, and
  the customer is notified by text. At 48 hours, payment is attempted, inventory
  is reserved, and the approved delivery task is locked in the standalone route.
  An admin may override the cutoff when route capacity and loaded inventory allow
  it. CRM job creation is optional and never controls the subscription lifecycle.

### Route balancing constraints

- Existing twice-weekly customer service-day pairs are hard constraints and cannot
  be moved by the optimizer under the current operating model.
- Existing service areas assigned to each weekday are considered established.
  Route optimization may improve stop order and technician ownership, but it does
  not move an area to another weekday unless that area is an explicit scenario.
- Bowling Green is the first explicit weekday-change scenario. The model must
  compare its current placement against Friday using drive time, daily workload,
  customer commitments, and route economics before recommending a move.
- Tony wants full-time hours. Workforce scenarios should measure his productive
  route hours, paid hours, drive hours, and weekly total rather than merely counting
  assigned days.
- Bria may move to two scooping days per week. No two weekdays are selected yet;
  the engine should compare every viable two-day combination, assign the remaining
  established routes to Tony, and rank the options by balanced daily workload,
  drive efficiency, Tony's full-time target, and Bria's intended schedule.
- These are scenario-planning rules only. No customer day or technician assignment
  changes automatically from an analysis result.

### Current workforce and vehicle assumptions

- Today, technician route time begins at the first job. The intended future model
  begins paid route time when the technician arrives at the OPWP office, so the
  route engine must support both clock policies rather than hard-code either one.
- Eight hours is a planning target, not a hard stop. Lunch is currently paid,
  technicians treat normal drive time as their practical break, and explicit app
  break records are not currently reliable. The model should therefore report
  observed time separately from required/planned break allowances.
- Technicians currently use personal vehicles. A future company-vehicle model
  will replace or supplement the personal-vehicle cost model.
- A dog-food delivery stop should initially reserve five minutes. Actual stop
  duration will be measured so the estimate can be replaced with observed data;
  the expected range is three to five minutes.
- OPWP does not yet have a fully loaded employee cost. Build an employee cost
  model that separates wage, employer payroll taxes, workers compensation,
  benefits, paid nonproductive time, equipment, training, phone, vehicle cost,
  and allocated overhead. Route profitability must use productive field-hour
  cost, not hourly wage alone.

## Inventory rule

Inventory is a ledger. Every physical change creates an immutable movement:
opening count, purchase receipt, sale, transfer, return, damage, or adjustment.
Current on-hand inventory is calculated from the movement ledger. A sale is not
allowed to silently overwrite a product-level count.

The initial physical count must be entered as an `opening_count` movement for
each SKU. Reorder points remain unset until supplier lead time, pickup economics,
subscription demand, and safety stock are known.

## Product availability

- The four 40 lb Elite products are customer-visible at $59 before tax. Lucas County tax is calculated per taxable line, matching the current SNG invoice behavior ($63.57 for one bag; $127.14 for two bags).
- The four 20 lb Elite products exist as inactive placeholders until their price,
  cost, and opening counts are supplied.
- Camo and Sand can remain in Airtable for historical/distribution reporting but
  are not customer-orderable.

## Ordering rules

- One customer can have up to ten dogs.
- Each dog can have a separate recommendation and subscription item.
- One subscription can contain multiple products and quantities.
- The customer-facing recurring option is monthly. The exact recurrence anchor
  (calendar date versus route-week pattern) must be finalized before automation.
- Subscription charges are attempted 48 hours before delivery.
- Route-day delivery is free. Next-day delivery is $5. Same-day delivery is $10
  before noon when operational capacity and route economics permit it.
- Lucas County sales tax defaults to 7.75% and is stored on each order so later
  tax-rate changes do not alter historical totals.
- Substitution order is the same formula and total weight first, then an explicitly
  preauthorized alternate formula. The customer is notified whenever substitution
  occurs.

## Reporting outputs

The management layer should report revenue, gross margin, bags sold by SKU,
subscription demand, churn, failed payments, inventory on hand, inventory value,
weeks of supply, suggested reorder quantity, purchase-order status, route delivery
volume, delivery cost, and on-time delivery rate.

## Route Partner foundation checkpoint — 2026-07-15

The first standalone operating slice now exists in the repository:

- D1 uses `route_partner_organizations` as the tenant boundary. OPWP is the first
  organization; CRM connections, members, route versions, tasks, vehicles, load
  checks, events, and change requests are all organization-scoped.
- `/admin/route-partner/` imports a selected Sweep & Go dispatch day without
  creating dog-food customers, jobs, or subscriptions in Sweep & Go.
- Each import creates an immutable draft version only when the underlying scoop
  jobs or native dog-food work changed. Identical imports do not create duplicates.
- Scoop jobs retain their dispatched order. Scheduled native food deliveries are
  merged onto the same physical location card when the address matches; food-only
  stops remain native Route Partner locations.
- Management can review and finalize each technician route. Finalization is
  recorded in an append-only route event ledger and does not write back to the CRM.
- The schema includes the next operating controls: individual members/roles,
  vehicle inventory links, predeparture load/payment checks, CRM completion
  validation, task GPS/photo evidence, and management change requests with an
  explicit inventory-disposition checkpoint.

This checkpoint intentionally does not message customers, charge cards, change a
CRM route, or expose the technician field app. Those actions remain disabled until
their confirmation loops and provider integrations are implemented and tested.

Production release `a211fa0a-ae93-451d-aaab-35e427f117e7` applied migration
`0020_route_partner_foundation.sql` and deployed the protected management
workspace on 2026-07-15. The production tables were verified empty after release;
no Sweep & Go route import or customer-facing action was triggered during deployment.
