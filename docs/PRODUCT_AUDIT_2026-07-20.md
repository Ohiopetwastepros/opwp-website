# OPWP product audit — July 20, 2026

## Release outcome

This pass reviewed the public website, dog-food funnel, management Route Partner workspace, office access, and technician field workflow. The release removes blocking order defects, hardens the field state machine, materially reduces page weight, improves responsive readability and accessibility, and completes the protected delivery-proof review loop.

## Corrected in this release

- Removed the obsolete hidden dog-weight requirement that prevented valid website orders after weight was removed from the questionnaire.
- Enforced customer type, plan, delivery method, phone, consent, custom placement, and the noon Eastern same-day cutoff on the server.
- Added explicit form constraints and disabled unavailable same-day choices in the customer experience.
- Restricted field sessions to technician accounts and enforced valid load, route, arrival, task, break, mileage, inventory, notice, and completion transitions on the server.
- Required a proof photo and placement confirmation before a food task can be completed.
- Added protected management access to delivery proof photos from Route Partner task cards.
- Added keyboard focus indicators, reduced-motion behavior, dialog semantics, step semantics, and mobile touch handling.
- Replaced referenced JPG/PNG photography with optimized WebP assets. The 18 referenced photos dropped from 41,217,630 bytes to 4,919,036 bytes, an 88% reduction. The main logo dropped from 1,420,449 bytes to 21,784 bytes.
- Added application-wide HSTS, frame, MIME-sniffing, referrer, and permissions security headers. CSP remains deferred until a browser trace confirms every required source.
- Increased the legibility and touch-target size of route intelligence and office-access controls across desktop and mobile.

## Automated release gates

- Next.js production compilation and type validation.
- OpenNext Cloudflare production build.
- Technician two-stop end-to-end smoke test, including invalid transition, duplicate notification, mileage, inventory, proof, completion, and CRM-validation guardrails.
- Dog-food order smoke test, including the weight-free questionnaire and custom placement rejection.
- Unauthenticated access checks for protected admin, office, field, and proof endpoints.
- Live HTTP checks for routes, optimized assets, content types, and security headers after deployment.

## Production work still required

These are integration boundaries, not visual polish issues:

1. Connect CardPointe or another tokenized payment provider. No order should be released based on a fabricated payment state.
2. Connect the SMS outbox to a provider so queued on-the-way, payment-failure, exception, and abandonment messages are sent.
3. Run a controlled live Sweep & Go route import and technician pilot with management present.
4. Add the optional `FIELD_PROOFS` R2 bucket before a broad rollout; D1 currently provides the bounded proof-photo fallback.
5. Enter verified 20 lb prices, costs, and physical opening inventory counts.
6. Add measured field telemetry and offline/PWA support after the first technician pilot establishes real usage conditions.
7. Run browser-based Core Web Vitals and device testing when a browser automation target is available. This audit could validate source, build, HTTP behavior, responsive rules, and end-to-end APIs, but could not claim measured LCP/INP/CLS without that instrumentation.

## Recommended live pilot

Use one known Monday route with one dog-food stop. Confirm payment, placement, load inventory, route release, technician login, on-the-way notice queueing, proof capture, inventory decrement, route closeout, and management proof review before expanding to the next technician.
