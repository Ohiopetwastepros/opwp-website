# Independent dog-food backend

The target is one website-owned operational ledger. Customers, logins, native orders, payments, lots, routing capacity and consent remain in their existing website tables. Historical sales, stock checkpoints, purchase orders, receipt history and externally managed plans retain their original IDs in website business records. Their original export remains a private, immutable migration input.

The business-record adapter preserves the existing validated operating model and historical field meanings. It is a writable website ledger with revisions and append-only change events, rather than an Airtable refresh cache. All multi-record purchases, stock changes and historical receipts commit atomically with the command result. Repeated submissions retain the same command ID.

The website owns stock and financial updates after cutover. It does not refresh or post dog-food data to Airtable, and saved historical identifiers are provenance only. Other OPWP integrations and processor-owned billing remain separate. Import never sends invitations, creates portal credentials, charges customers or invents lot/expiration evidence.

Rollout sequence:

1. Prepare and separately approve schema 0064. Its default keeps the current source until a verified cutover.
2. Export every source table with pagination and preserve all records, including archived history and review flags.
3. Reconcile products, physical checkpoints, available/reserved stock, receipts, outstanding balances, plans and customer links. Match existing native projections by exact item IDs.
4. Deploy the compatible release, briefly hold new dog-food operating writes, refresh the final export and verify source stability.
5. Import the reviewed source and atomically select the website ledger. Retain native orders, payments, credentials and IDs unchanged.
6. Verify purchases, partial receipts, stock/waste, collections, customer history, portal access and reporting with Airtable unavailable. Keep recovery exports and test restoration.

No historical paid label becomes new payment evidence. Historical ambiguous identities and conflicting balances remain visible for office review. Externally billed plans retain their billing owner; imported plan management never automatically enrolls Stripe or alters Sweep & Go billing.

## Recovery

Before applying schema changes, retain a complete private D1 SQL export, its streaming SHA-256 digest, and a recovery bookmark. Rehearse the additive migration against the actual deployed schemas and captured food rows. Reconcile the final source export twice during the short write hold; compare every source row and the operating stock, reservations, balances and plans before activating the website ledger.

After activation, the existing scheduler creates a daily private R2 operational export. The owner can also request a verified export under Data & audit. The export includes operating records and append-only events. It excludes active credentials, sessions, tokens and message-dispatch queues. Each export is downloaded internally and checked against its digest before its status becomes verified. The owner dashboard shows failures and the last verified time. Product attachments are archived separately, read back and checksum-verified; owner-only image requests use registered asset IDs.

For a restoration rehearsal, create an isolated database from the matching schema, load the operating export without enabling jobs or customer messages, and compare row fingerprints and operating totals. Restore accounts, authentication, delivery evidence and other shared application data from the complete D1 recovery point and private asset bucket. A full production D1 restoration affects other OPWP modules and requires a coordinated maintenance window. Never run an unreviewed restore against production.

Before activation, a failed verification can release the write hold and leave the existing source in control. After activation, retain website ownership. Do not switch back to the old source or re-import its stale rows over new website transactions. Investigate the audit and provider records, rehearse recovery privately, and apply reviewed corrections or an explicitly authorized restoration.
