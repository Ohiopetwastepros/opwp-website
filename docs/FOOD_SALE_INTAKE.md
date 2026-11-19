# Manual dog-food sale intake

The website captures the published Airtable Dog Food Sales form fields:

| Airtable field | Website behavior |
| --- | --- |
| Sold To Name | Select the shared customer by name, phone or email; create or complete their profile when needed. |
| Sale Date | Required date, saved with the sale independently of stock/handoff timestamps. No future sale dates. |
| Product | Exact website formula and bag size, using the approved catalog price. |
| Bag Quantity | Quantity for each selected formula. |
| Payment Status | Paid, partial or unpaid; the server checks this against money actually collected. |
| Amount Collected | Actual receipt amount, with explicit confirmation that it was received. |
| Payment Method | Cash, check, Venmo, Zelle, PayPal or a card payment already collected elsewhere. Noncash receipts require a transaction reference. |
| Customer Type | Individual, Dealer or Route Partner, saved as a sale snapshot. This does not change catalog pricing or account permissions. |
| Notes | Sale-specific notes retained with the sale and its Airtable projection. |

Card entry records existing payment evidence. It does not initiate a charge or collect card numbers. A Stripe transaction cannot also be recorded as a manual card receipt. Existing electronic capture and immutable receipt guards remain in force.

Manual staff sales for an active, saved customer require a nonblank first and last name. Phone, email, delivery profile completeness and account activation do not block a manual sale. The existing Sweep & Go billing path retains its contact and delivery requirements. Price review, verified stock, actual receipt/handoff confirmations and all other sale validations still apply.

An **established account** means the customer is linked to an existing `dog_food_accounts` portal login with a nonblank `verified_at`, has a nonblank `dog_food_customers.sng_client_id` or `stripe_customer_id`, or has an explicit `dog_food_source_customer_links` row with provider `sweep_and_go` or `stripe` and a nonblank external customer ID. The source-link table contains office-reviewed provider identity evidence. A directory contact, completed profile, customer type, Airtable record, invitation or prior sale alone does not establish an account. Route-partner category or route-task membership alone is not a billing-account link; its explicit Sweep & Go customer linkage qualifies under the same rule.

Customers without that evidence are labeled **Needs account created** on the staff Review step. Their manual sale still saves. The server records the account requirement at save time in the existing durable command result and audit record, so the confirmation and a replay retain the same result. No account, credential, invitation or provider customer is created by saving the sale. This release needs no schema migration.

The office can open `/admin/dog-food/customers/` and choose **Account → Needs account created**. Directory and profile badges use current account links, so the queue clears when an actual account is linked through an existing authorized workflow. This current queue is distinct from the sale's retained save-time account flag.

Sale date records when the order was agreed. Handoff evidence records when stock actually leaves. Previously completed sales included in a physical count still require reviewed historical reconciliation, rather than a new stock allocation.

Staff can create or complete contact, address, dog count, service frequency and delivery preferences before portal takeover. A verified account email remains protected. When a customer has a completed portal profile, staff intake edits stop; the customer and authorized office retain their existing editing paths. Concurrent portal takeover is checked again inside the staff write transaction.

The portal prefills staff-entered contact details and food preferences using the same customer ID. Customer edits update the same profile and increment its revision while preserving historical order addresses, office notes and SMS consent. Editing a profile does not send another welcome invitation or enroll recurring billing.

Production requires separately authorized migration 0063 before the website release. It adds five nullable/defaulted sale metadata fields, expands the receipt-method check by copying the existing evidence rows, and updates payment indexes while retaining existing orders, payments and stock quantities.
