# Customer and ordering rollout

The existing customer ID owns staff sales, portal history and processor references. Staff can save a normal customer using a name, phone, address and handoff preference. Email, dog count, frequency and SMS consent are optional. Creating or editing the profile does not create credentials or processor customers, send messages, or take payment.

Portal access is a separate office action. Invitations bind to the exact customer ID and verified email. An incomplete verified signup that collides with an established customer must be reviewed by the office; it cannot claim the customer using a matching phone or name. The supported link retains the established customer and their history, retains the verified account password, ends existing sessions and archives only the empty signup placeholder. Accounts with history or conflicting identities remain held for separate review.

Legacy SMS timestamps are preserved as historical evidence. They do not prove that the currently stored phone was the number originally authorized. Current SMS permission requires an explicit phone-bound consent event. Editing a phone clears current permission unless new consent is explicitly recorded.

## Source reconciliation

The owner source workspace reads the supported Sweep & Go webhook archive. It identifies food lines on mixed invoices using exact invoice and line IDs and displays the archive timestamps and coverage limits. It is not a complete provider export. Missing invoice/payment references, ambiguous products and duplicate outcomes stay under review. An owner can retain an explicitly verified payment-to-invoice link, customer mapping, actual food tax allocation and duplicate decision. This changes no Sweep & Go or QuickBooks records and takes no payment.

Only reviewed paid food lines enter the combined financial view. Exact existing native or imported sale references avoid another sale. Payment does not prove handoff. Unknown fulfillment stays unknown; explicit pending arrangements reserve remaining bags. Actual partial handoffs create immutable movements with persistent submission IDs. Handoffs on an intraday count date require the actual handoff time and the count cutoff; unknown times cannot silently deduct or skip stock.

Signed unmatched Stripe events and read-only PaymentIntent lookups retain minimal safe evidence for office review. A link requires the exact internal customer and unpaid order, successful unrefunded USD amount, processor mode, ownership and concurrency guards. Partial/refunded/asynchronous/conflicting payments remain unclassified. It creates no new charge, recurring plan or card setup. Captured processor evidence takes precedence over a previously selected manual payment method in the sales view.

## Deployment and database recovery

Prepare and approve migrations 0064, 0065 and 0066 separately from deployment. Keep original SQL byte-verified. Rehearse against the deployed schema and captured rows, preserve every original-column fingerprint, and retain a complete database export with its streaming digest and a recovery bookmark. Schema 0064 retains the current ledger owner; schema 0066 initializes public ordering off.

Before accepting new optional records, a guarded rollback may restore the original profile constraints and remove the new 0065/0066 structures only after comparing all baseline fingerprints and proving no new source, invitation, consent, account-link or customer activity. The private rollout package contains the rehearsed pre-write rollback. After accepting new optional profiles or linked invitations, retain the expanded schema and roll forward; forcing new null values into old required constraints would lose legitimate data. A full shared-database restoration requires a separately authorized maintenance window.

Run the full test suite, lint, dependency audit, migration review, production/Cloudflare builds, Worker startup check and security checks. Publish the exact reviewed GitHub tree through the required deployment runner and verify its production release receipt. Do not treat a local preview or successful build as deployment. Follow `FOOD_BACKEND_CUTOVER.md` for the stable final export, source fingerprints, private assets and website ledger activation. After activation, do not re-import stale external records over website transactions.

## Public ordering activation

Keep ordering disabled until every condition is verified:

1. The approved customer, source-review and launch schema is deployed, and the website ledger cutover reconciles without changing native balances or physical quantities.
2. A current physical count establishes usable on-hand, reservations and available bags for each formula. Lot numbers, real expiration dates and actual handoffs are retained; unknown evidence stays flagged. Old checkpoints remain provisional. Use the verified full-lot count workflow for an exact count cutoff.
3. Review source completeness, duplicate lines, customer links, paid/unfulfilled orders and current outstanding balances. Preserve source timestamps and limitations.
4. Configure a separate Stripe test environment and exercise hosted checkout, signed success/failure/async/refund/retry events and saved-card setup without a charge. Use fabricated identities and test payment methods. Never use real customer messages or cards as tests.
5. Verify the transactional email sender/domain and a controlled synthetic delivery; record real provider results. A secret name alone is not delivery evidence.
6. Verify live processor mode and signing secret separately, confirm actual dated delivery/pickup capacity, and tie security review to the exact release source fingerprint.
7. Obtain separate owner approval for live ordering. Record the evidence timestamps, release fingerprint and named approval in launch readiness before enabling it. Recheck the owner readiness endpoint and customer ordering endpoint against production. Never use the localhost test override in production.

The readiness workspace reports missing evidence and has no shortcut that enables payment. Staff profile maintenance and supported manual operations remain independent of customer portal activation; stock-dependent sales require verified usable quantities.
