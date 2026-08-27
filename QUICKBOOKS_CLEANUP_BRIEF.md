# QuickBooks Cleanup — Technical Brief for Codex

**Purpose:** Ohio Pet Waste Pros (OPWP) has an ongoing QuickBooks Online cleanup with several issues left that QuickBooks quoted **$900** to help fix. We already have a working custom QuickBooks Online integration in this codebase with a live OAuth connection — the goal is to use that existing plumbing to build read-only diagnostic scripts (and, carefully, some fix scripts) that solve these issues ourselves instead of paying for it.

This doc has: the business context, what's already fixed, the specific open issues with real data/examples, and a suggested technical approach for each — grounded in what the QuickBooks Online API actually supports.

---

## 1. What already exists in this codebase

Repo: `opwp-website-next` (Next.js on Cloudflare, D1 database).

- **`lib/quickbooks.js`** — full OAuth2 flow already built and working: `createQuickBooksAuthorization`, `completeQuickBooksAuthorization`, encrypted token storage in D1 (`quickbooks_connections` table), automatic token refresh (`refreshAccessToken`), and a generic authenticated fetch helper (`qboFetch` / `qboFetchWithAuthRecovery`) that hits `https://quickbooks.api.intuit.com/v3/company/{realmId}/...` (or the sandbox host — `QB_ENVIRONMENT=sandbox` is already supported).
- **`app/api/quickbooks/callback/route.js`**, **`app/admin/quickbooks/connect`**, **`app/admin/quickbooks/disconnect`** — OAuth connect/disconnect UI already wired up.
- Currently `lib/quickbooks.js` only calls **report** endpoints (`ProfitAndLoss`, `BalanceSheet`, `CashFlow`, `AgedReceivableSummary`, `AgedPayableSummary`) and a few **query** endpoints (`Class`, `Department`, `Account`, `Item`) — see `getQuickBooksFinancialSnapshot()` and `getQuickBooksFinancialDashboard()`.
- Migrations: `migrations/0003_quickbooks.sql` (oauth_states + connections tables), `0004_quickbooks_lifecycle.sql`, `0005_quickbooks_metadata_cache.sql`.

**The ask for Codex:** extend this same pattern — new functions in `lib/quickbooks.js` (or a standalone script/CLI using the same `qboFetch` approach) that call additional report and query endpoints to diagnose and, where safe, fix the issues below. No new OAuth work needed — the connection and token refresh already work.

---

## 2. Background — what already got fixed (context, not the ask)

QuickBooks 2026 income was overstated by ~$131k because two QuickBooks **bank rules** ("Online Transfer Bankcd" and "Online Transfer Sweep") were auto-categorizing every bank deposit as income, on top of the invoices our Sweep&Go (pet-waste-service app) connector already created for the same payments. Both rules are now **disabled**. All six historical monthly duplicate-deposit batches (Jan–Jun 2026, ~$90k total) have been manually matched and cleared. That part is done — mentioned here only so Codex understands why the account looks the way it does.

---

## 3. Open issues — data, examples, and a suggested technical approach for each

### Issue 1 — Bank reconciliation gap: $32,015.74

QuickBooks' own "books health" widget flagged a ledger-balance difference of **$32,015.74** (as of 7/21/26) between the books and the real bank statement (General Operations account at Directions CU). No reconciliation has been run yet, and there's no UI-friendly way to see the register-level detail behind that number.

**What the API can and can't do here:** QuickBooks Online does not expose a way to *perform* a reconciliation via the public API (that's a UI-only workflow), but the **`reports/TransactionList`** report supports a `cleared` filter with values `Reconciled` / `Cleared` / `Uncleared` — so we can pull every **uncleared** transaction on the General Operations bank account for the full year, which is exactly the working list a human would build by hand during a reconciliation.

**Suggested approach:**
1. Call `reports/TransactionList` filtered to the General Operations account, `cleared=Uncleared`, full-year date range.
2. Cross-reference that list against the real bank statement we already have exported (`Credit Card Processing/` and the Directions CU CSV referenced in MEMORY.md) to find what's sitting open on the QuickBooks side that shouldn't be, or vice versa.
3. Output a CSV diff Craig can review line by line — this is the actual "reconcile the bank" work, just machine-assisted instead of done by hand in the QBO UI.

### Issue 2 — Two negative Payroll Clearing (Venmo) sub-balances

- Payroll Clearing 2026 Venmo: **−$1,381.08**
- Payroll Clearing Venmo 2025: **−$737.20**
- Combined: −$2,118.28, but QuickBooks' health-check widget flags a "negative liability balance" of **$2,398.96** — a **$280.68** gap between those two numbers that's also unexplained.

**Suggested approach:**
1. Find the two account IDs (`query`: `SELECT Id, Name FROM Account WHERE Name LIKE '%Payroll Clearing%'` — this pattern already exists in `getQuickBooksFinancialDashboard()`'s Account query).
2. Pull **`reports/GeneralLedger`** (or `reports/TransactionList`) filtered to each account ID for its full date range — this is the standard substitute for a register-by-account pull via API.
3. Sum every transaction touching each account and diff against the current balance to find what's driving the negative, and see if the $280.68 gap is a third, separate account or a mis-tagged transaction.

### Issue 3 — Unapplied payments sitting all over the account (the big one)

Manually checked QuickBooks' Overdue Invoices list (14 invoices, $1,510.91) one at a time. **10 of the 14 already had a matching unapplied payment sitting on the same customer's account** — the money already came in, it just never got linked to the invoice. Examples:

| Customer | Invoice open | Matching unapplied payment |
| :---- | --: | :---- |
| Jim Hansen | $108.86 | $127.14 (7/20) |
| Kirsten Sprague | $100.00 | $100.00 (7/20), exact match |
| Patricia Monto (×2 invoices) | $68.00 each | $68.00 each, manually-entered check, ref "1" |
| Lisa Reynolds Sautter | — | three straight months ($191 × 3) landing unapplied, recurring pattern |
| Nicole Iman | — | three straight months ($115 × 3) landing unapplied, recurring pattern |

This was found by checking 14 invoices out of the whole customer base by hand — the real number company-wide is unknown, and manually checking every customer isn't realistic.

**This is the single highest-value script to build.** The API can do this exhaustively instead of by sample:

1. Query `SELECT * FROM Invoice WHERE Balance > '0.00' MAXRESULTS 1000` — every open invoice, company-wide. (`Invoice.Balance` is a standard queryable field.)
2. Query `Payment` transactions for the same customers/date range and, for each, read the `Line[]` array — each line has an `Amount` and (when applied) a `LinkedTxn[]` pointing at the invoice(s) it's applied to. A payment whose `Line[].Amount` sum doesn't cover its `TotalAmt` has an unapplied remainder. *(Have Codex verify the exact field names against Intuit's current `Payment` entity reference — this is the well-documented "linked transactions" pattern, but field names are worth double-checking against the live schema before writing code.)*
3. Also check `CreditMemo WHERE Balance > '0.00'` the same way — several of the flagged accounts (Reynolds Sautter, Jade Czekaj) have unapplied credit memos, not just unapplied payments.
4. Join open invoices to unapplied payments/credit memos by customer + rough amount/date proximity, and output a full company-wide match list (the same shape as the table above, but exhaustive, not a 14-invoice sample).
5. **Do not auto-apply anything on the first pass.** Output the proposed matches to a review file first — this mirrors how the manual cleanup was done (every batch was verified against a before/after balance sheet pull before saving). Once Craig reviews and approves, a second script can actually call the `Payment` update endpoint to attach the `LinkedTxn`.

### Issue 4 — Same payment shows "applied" on two different invoices

On Maya Deramus's account: a $55 payment dated 1/1/26 (ref `001259033552`) and a separate $55 payment dated 2/1/26 (ref `532407355997`) both appear to show up identically on two different months' invoice-detail screens in the QBO UI. Both invoices currently read as fully paid ($0 balance), so this may just be a QuickBooks **display quirk** — the invoice-activity panel can show a payment's full original line on every invoice it's linked to, not just the specific dollar amount actually applied there — but it hasn't been confirmed.

**Suggested approach:** Fetch those two `Payment` objects directly by reference/ID (`SELECT * FROM Payment WHERE ...` or a direct read if the ID is known) and read the `Line[].LinkedTxn` breakdown on each. That shows the *true* applied-to-invoice split, which settles definitively whether this is a display artifact or a real double-application — no manual UI hunting needed.

### Issue 5 — No way to pull general-ledger / register-level detail

This blocked the cleanup three separate times: the bank reconciliation gap (Issue 1), the Payroll Clearing accounts (Issue 2), and a **$4,131.21** "Other income" spike that landed in November 2025 (need to explain it to the CPA — full year total was $5,136.63, and $4,131.21 of it landed in that single month). Every time, the only option was opening entries one at a time in the QBO UI.

**Suggested approach:** `reports/GeneralLedger` is the closest API substitute for a "Transaction List by Account" register pull — it returns transaction-level detail organized by account and supports date-range filtering. For the November 2025 "Other income" question specifically: get the Other Income account ID, then pull `reports/GeneralLedger` filtered to that account for `2025-11-01` to `2025-11-30` — that returns every transaction that makes up the $4,131.21 directly, instead of opening the register by hand.

### Bonus — automated regression monitor for the original bug

The two bank rules that caused the original $131k double-count are disabled, but nothing currently *proves* they stay that way. Cheap to build, high value: a scheduled script that queries `Deposit` transactions (`SELECT * FROM Deposit WHERE TxnDate >= 'X'`) and checks each deposit's line items for any `DepositLineDetail.AccountRef` pointed at the Sweep&Go income account (the original bug pattern — a deposit adding funds directly to income instead of just clearing Undeposited Funds). If one ever shows up again, alert immediately instead of finding out three months later. This turns "keep an eye on it" into something that doesn't rely on Craig remembering to check.

### Bonus — recurring-invoice gap detector (Reynolds Sautter / Nicole Iman pattern)

Same root shape as Issue 3, generalized forward: for customers on a recurring monthly charge, a payment lands via the Sweep&Go connector some months with no matching invoice created for it to apply against. Once the Issue 3 script exists (open invoices + unapplied payments by customer), running it monthly on a schedule catches this automatically going forward instead of it silently piling up for 2–3 months before anyone notices, which is what happened here.

---

## 4. Guardrails for whoever (Codex) builds this

- **Read-only first.** Every script above is a `query` or `reports/*` GET call — nothing here needs to write to QuickBooks. Get the diagnostics working and reviewed before writing anything that applies a payment or edits a transaction.
- **Sandbox before production.** `lib/quickbooks.js` already supports `QB_ENVIRONMENT=sandbox` — any script that *does* eventually write data (e.g., auto-applying a payment to an invoice) should be run against the sandbox company first, with Craig reviewing actual before/after output, the same way every manual edit in this cleanup was verified against a before/after balance-sheet pull.
- **Rate limits.** QuickBooks Online's API has request-rate limits per minute/company — batch and throttle report/query calls rather than firing them all at once, especially for a full-company sweep like Issue 3.
- **`minorversion`** — the existing `qboFetch` helper already pins `minorversion=75` on every call; keep new calls consistent with that.
- **Company:** Ohio Pet Waste Pros. Connection is already live (`quickbooks_connections` table, `id = 'primary'`) — no new auth needed, just new calls using the existing `qboFetch`/`qboFetchWithAuthRecovery` helpers.

## 5. Suggested build order

1. Issue 3 script (open invoices + unapplied payments/credit memos, company-wide match list) — highest value, fully read-only, replaces the most manual work.
2. Issue 5 (`GeneralLedger` pulls) for the November 2025 Other Income question and the two Payroll Clearing accounts — same technique, three different targets.
3. Issue 1 (`TransactionList` with `cleared=Uncleared` on the bank account) — feeds the actual reconciliation.
4. Issue 4 — one-off, quick payment lookup to settle the Maya Deramus question.
5. Bonus regression monitor — once the above works, this is mostly wiring the Issue 3 query pattern into a scheduled check.

---

**Sources consulted for API capabilities referenced above:**
- [QuickBooks Online API — Manage linked transactions](https://developer.intuit.com/app/developer/qbo/docs/workflows/manage-linked-transactions)
- [How to Identify Reconciled Transactions in the QuickBooks Online API](https://satvasolutions.com/blog/reconciled-transactions-quickbooks-online-api)
- [Which QuickBooks Online report substitutes for Transaction List by Account via API](https://coefficient.io/use-cases/quickbooks-standard-reports-substitute-transaction)
- [Top 5 QuickBooks API Rate Limits](https://satvasolutions.com/blog/top-5-quickbooks-api-limitations-to-know-before-developing-qbo-app)
