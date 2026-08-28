# Sweep & Go quote-form contract

The website creates residential accounts through Sweep & Go's authenticated `PUT /api/v1/residential/onboarding` API. The website remains the customer-facing quote UI; Sweep & Go remains the CRM and operational account system.

The instant price remains hidden until the visitor supplies a valid phone and
email and explicitly agrees to automated messages about the requested quote and
service follow-up. That consent is versioned and timestamped in D1. It permits
the abandoned-quote follow-up workflow but is not forwarded to Sweep & Go as
blanket promotional-marketing consent.

## Audited OPWP selections

The following selections were verified against OPWP's live Sweep & Go registration-form configuration on August 28, 2026:

- Dogs: 1 through 7
- Frequency: twice weekly, weekly, biweekly, monthly, or one time
- Dog safety: `yes` or `no`
- Gate: `left`, `right`, `alley`, `no_gate`, or `other`
- Doggie door: `yes` or `no`
- Garbage can: `left`, `right`, `alley`, or `other`
- Areas: Back Yard, Behind Shed, Kids Play Area, Area with Mulch, Area with Rocks, Pool Area, or Area With Pine Straw
- Cleanup notification: account completion notification by SMS (valid SNG values are `off_schedule`, `on_the_way`, and `completed`; valid channels are `email`, `sms`, and `call`)
- Referral source: the website offers values supported by both OPWP's live form and the documented onboarding API

The UI can use friendlier internal frequency and yard-history names. `lib/sweepandgo.js` converts those values to the exact API enums before sending them. Server validation rejects unknown selections before Sweep & Go is called.

For multiple dogs, the single simple safety answer is repeated for every dog because Sweep & Go expects index-aligned dog arrays. The supplied dog name and notes are assigned to the first dog; remaining entries are intentionally blank.

Selected service add-ons use OPWP's current Sweep & Go cross-sell IDs. Dog-food products remain outside Sweep & Go's residential service cross-sells and retain their existing checkout workflow.

## Drift check

Run `npm run audit:sng-form` before production releases or after changing the hosted Sweep & Go form. It reads the public OPWP registration configuration and fails when required fields or accepted options change. It does not use or print the Sweep & Go API key.

This network-dependent check is intentionally separate from offline CI tests. Unit tests enforce the checked-in contract without production credentials.

## Test-account validation

After deployment, create one uniquely identifiable test customer using an email address and phone number controlled by OPWP. Confirm in Sweep & Go that:

1. customer and subscription/account records are created only once;
2. frequency, dogs, safety, access, cleanup areas, referral source, comments, and cross-sells match the submitted form;
3. a repeated submission returns the existing completion result rather than creating a duplicate;
4. the owner email notification is queued and, once an email provider is configured, marked sent only after provider confirmation;
5. the payment handoff reaches the intended existing-customer payment flow.

Do not use a real customer's identity for this validation. Remove or clearly tag the test account afterward according to Sweep & Go operational policy.
