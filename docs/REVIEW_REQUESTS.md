# Google review requests

Production ships with `REVIEW_REQUESTS_ENABLED="false"`. Public tech pages and the protected `/admin/review-requests/` ledger work while sending is disabled. This flag independently gates both SMS and email; it does not change any existing automation or email flags.

## Enable later

After Craig approves a live test and launch, change only `REVIEW_REQUESTS_ENABLED` to `"true"` in `wrangler.jsonc`, run the repository checks/CI, and release with `npm run deploy -- --summary "Enable approved Google review requests"`. Do not change other vars or secrets. The first enabled webhook or ten-minute cron invocation records its UTC timestamp in D1 `review_request_settings.enabled_at`. Only jobs completed strictly after that persisted timestamp qualify. First-enable observation is intentionally conservative: completions between the config change and that observation are excluded. Keep that timestamp permanently; do not backdate it or replay dry-run rows. Disabling the flag immediately stops queueing and sending. Pending rows remain for a later enabled run, with eligibility rechecked.

## Behavior and safeguards

Verified SNG `job:completed` processing enriches the job through the read-only Dispatch Board `jobs_for_date` endpoint. Only `initial` and `one_time` qualify. Dispatch supplies the phone, current contacts, marketing permission and technician; naive source completion times use America/New_York. An unavailable lookup keeps the source event retryable. No recurring/custom/reclean requests are sent.

The durable customer reservation uses the stable SNG client ID, plus SHA-256 phone aliases to preserve once-ever behavior when an ID was initially missing. Email-only customers need a stable SNG ID. Different jobs for the same customer produce an `already_requested` audit entry. A successful reservation consumes the once-ever request even if a later send fails or is skipped; there is no automatic retry of an uncertain provider attempt. SMS and email each have their own atomic delivery claim. Stale `sending` entries become terminal failures after 15 minutes and require provider verification before any manual intervention.

Sending is limited to 9 AM through 7:59:59 PM Eastern. Outside that window rows stay queued. Immediately before each channel, Dispatch contacts/type/marketing permission, the existing customer Reviewed flag in the D1 cockpit snapshot, STOP/lead/field suppressions, email unsubscribe, manual do-not-contact, customer identity, and the go-live cutoff are checked again. No dissatisfaction, complaint, churn or rating heuristics are used. An unavailable review snapshot or Dispatch lookup defers delivery. Sent means provider acceptance, not independently confirmed delivery.

`/admin/review-requests/` allows authenticated admins to set or clear manual do-not-contact by the exact ledger customer key. Before a customer appears, an admin can enter `sng:<numeric Dispatch client_id>` or `phone:<SHA-256 of normalized E.164 phone>`. Airtable's public `rcl_` ID is a different identifier and must not be substituted for the numeric Dispatch ID. Changes are audited. Clearing a block does not resend terminal ledger rows. The browser receives names and phone last-four only, never provider payloads or full contact values.

Review email unsubscribe uses a random capability whose hash is stored privately. GET shows a confirmation; POST saves the hashed email suppression. Resend receives `List-Unsubscribe` and RFC 8058 one-click headers. The repository had no preexisting email-unsubscribe store; this feature's durable store is checked for every review request. Existing phone STOP controls also suppress the entire review request. Emails use the existing Resend sender and still require its existing email flag in addition to this feature flag.

## Schema and previews

The only feature migration is additive `0067_review_requests.sql`. Its public reviewed source is `schema-proposals/0067_review_requests.sql`; the ignored production copy must match the SHA-256 in `data/production-schema-changes.json`. The historical private archive remains unchanged. Migration deployment requires the owner's separate database authorization; website deployment never applies it implicitly.

Pages: `/review/tony/`, `/review/chad/`, `/review/craig/`, `/review/team/`. Preview images are committed 1200x630 crops at `/assets/photos/review-{slug}.jpg`. Chad intentionally uses a labeled team photo pending a real portrait. Unknown technicians use the team page. Review requests always invite honest feedback without incentives or review gating.

Dry-runs use source reads and the same eligibility/content helpers, never queue inserts or provider send calls. Operational reports belong outside public source. Do not put customer records, phone numbers, email addresses, addresses, or credentials in committed reports.
