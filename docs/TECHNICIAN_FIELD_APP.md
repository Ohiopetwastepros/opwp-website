# OPWP technician field app

Checkpoint: July 20, 2026

## What is built

- Technician login at `/field/login/` with an individual email and six-digit PIN.
- A mobile-first workday at `/field/` containing only the active field workflow.
- Management creates/deactivates technician accounts and assigns upcoming routes at `/admin/route-partner/team/`.
- Finalizing a Route Partner plan creates the technician shift, food load requirements, and payment validation checkpoint.
- Before departure, the technician confirms every required bag and starting mileage. A failed food payment blocks departure.
- The route shows one location card with both scoop and dog-food tasks when work shares an address.
- Each stop supports navigation, arrival, task start, and task completion. Food tasks also support an on-the-way lead choice of 10, 15, 25, 30, 45, or 60 minutes.
- Food completion requires a compressed proof photo and placement confirmation. Shift inventory is decremented when the delivery is completed.
- Scoop completion remains `validation_pending` until management validates the matching Sweep & Go job.
- Delivery failures create a management change request and capture whether the bag stays on the truck, returns to the warehouse, is damaged, or is missing.
- Technicians can record breaks and finish the day with ending mileage and returned/damaged inventory.
- Management route control shows field/load/payment status, CRM validation, exception approval/denial, and protected delivery-proof review.
- Server-side guardrails prevent load confirmation, route start, arrival, task work, duplicate on-the-way notices, mileage closeout, and inventory closeout from occurring out of sequence.

## Current integration boundaries

- Route Partner is the standalone operating system and owns dog-food subscriptions, inventory, delivery tasks, technician workflow, and proof records.
- Sweep & Go remains the scooping system of record. Its dispatched work is imported and its completed-job state is used to validate scoop completion.
- The app does not create dog-food subscriptions in Sweep & Go.
- On-the-way notifications are safely queued in `route_partner_notification_outbox`. A texting provider still needs to be connected before queued messages are actually sent.
- Cloudflare R2 is not enabled on the current account. Proof images therefore use the bounded D1 fallback (maximum upload 1.25 MB after browser compression). Add an optional `FIELD_PROOFS` R2 binding before broad multi-business rollout.

## First live test

1. In Field team, create a technician with the exact Sweep & Go employee ID used on imported routes and choose a private six-digit PIN.
2. In Route Partner, import a known dispatched service date and release one test route.
3. Confirm the route is assigned in Field team.
4. On the technician phone, sign in at `/field/login/`, complete the load check, and work the test route.
5. After scooping is completed in Sweep & Go, select **Validate CRM** in Route Partner.
6. Review the proof photo, inventory result, mileage, and any exceptions before expanding testing.

## Automated verification

`scripts/field-smoke-fixture.sql` creates only local QA data. `scripts/field-smoke.mjs` exercises the authenticated field APIs through a complete two-stop day. Never apply the fixture to production.
