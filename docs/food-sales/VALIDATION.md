# Local validation — November 4, 2026

This is a local implementation review. Live release/account status is reported in the handoff. The new schema was separately approved and applied with existing business-record counts unchanged; no live payment, refund, recurring plan change or message was executed.

## Results

| Check | Result |
|---|---|
| Full `npm test` | 758 passing, 0 failing, 0 skipped. Includes 42 new unified-sale / dry-run / password / release-checksum cases alongside 716 existing tests. |
| `npm run lint` | Passing noninteractive ESLint gate. One warning in unchanged `app/office/NewClientCallGuide.js`: unused existing `react-hooks/exhaustive-deps` disable directive. |
| `npm run test:security` | 6 passing webhook security tests. |
| `npm run test:smoke` | Churn, subscription routing, office roles and staffing policy passed. |
| `npm run test:http-security` | Passed against local production Next server. Use `SMOKE_ORIGIN=http://localhost:3000` because Next normalizes middleware hostnames. First run with the 127.0.0.1 origin was correctly rejected with 403; rerunning with the documented local origin passed. New food APIs, review API, and cross-site session/sale mutations included. |
| `npm run build` | Initial production Next build passed. Final Next compilation also runs inside the Cloudflare build below. |
| `npm run build:cloudflare` | Production Next build, OpenNext Worker bundle and repository Worker patches passed. Existing CSS `align-items:end` warning remains in the unrelated route-day module; new food CSS uses flex-end/flex-start. Next reports that the optional Next ESLint plugin is not configured; the explicit application correctness gate runs separately. |
| `npm run check:worker-startup` | Local Worker startup analysis passed; this is not a deployed Worker test. |
| `npm run audit:production` | Passed the repository high-severity threshold. 0 high/critical; 5 existing moderate OpenNext/glob/minimatch findings remain. |
| Full `npm audit --audit-level=high` | Passed threshold, 8 moderate findings including dev linter dependencies. No forced major dependency downgrade was applied. |
| `npm run check:migrations` | 60 historical reviewed templates passed; documented historical 0022 duplicate remains allowed. |
| `node scripts/require-private-migrations.mjs` | Original production migration archive verified byte for byte. |
| `npm run audit:routes` | Passed: 62 page routes and 289 literal links. |
| `git diff --check` | Passed. |

The previous lint script opened an interactive ESLint setup prompt instead of running a check. `package.json`, the lockfile and `eslint.config.mjs` now provide a reproducible correctness gate using pinned ESLint and hook-rule dependencies. Legacy formatting was preserved. Undefined-name and hook-order checks also apply to the new sales boundary.

PowerShell treated OpenNext's Windows warning on stderr as a native-command error during one redirected invocation. The final build was rerun with stdout/stderr captured directly by a Node child process: actual `npm run build:cloudflare` exit code **0**, and both scheduled-subscription and quote-follow-up Worker patches were verified present. The Windows compatibility warning remains; Cloudflare runtime acceptance still belongs to the separately approved release process.

## Behavioral evidence

The new SQLite/route tests cover:

- Server-granted food access, unauthorized/cross-site/direct action rejection, own-order isolation, credential reset, grant revocation/revision, account deactivation, idle/absolute expiry, password lockout, cookie namespace isolation, and fail-closed rate limiting.
- Existing and new customers; exact catalog mapping; one or multiple formulas; server-priced tax; stale quote rejection; unpaid, partial and full receipts; required receipt confirmation and references; pickup and delivery independent of payment.
- Original submission replay, reordered JSON keys, changed-payload conflict, cross-account command conflict, unique noncash receipt references, concurrent staff/portal last-bag competition and database rejection of stale lot reservations.
- Native saves during Airtable failure; durable projection identities; projection timeout recovery without duplicate sale lines while checkout remains disabled; native customer ownership after an Airtable edit.
- Delayed handoff expiry, lot quarantine guards, once-only physical consumption, settled-item/receipt immutability, correction review, refund credit versus a separately confirmed usable physical return, and shared portal/staff customer history and stock.
- Verified-only SNG evidence, invoices without payments, missing invoice references, mixed invoices, unlinked equal-value orders, possible manual payment overlap, exact-reference links to existing receipts, explicit office evidence links, partial amounts, duplicate payment events, out-of-order payment/invoice arrival, and conflicting later invoice versions.
- Repeatable migration planning, exact projection/payment evidence deduplication, preserved original amounts/dates/source IDs, recurring-plan preservation, mapping/stock exceptions, missing-export rejection, and zero historical stock movement.

The full existing suite also covers owner MFA, customer account isolation, Stripe payment validation, existing SNG and webhook handling, fulfillment proof and inventory protections. This is local regression evidence; it does not verify live owner sign-in or execute SNG billing.

[Synthetic HTTP demonstration](synthetic-http-demonstration.json) records an end-to-end loopback check using real handlers, real staff password verification and an isolated SQLite ledger. It logs in as a fabricated viewer with an explicit food grant, finds the shared fabricated customer, quotes two formulas at $127.14, records $10 received and completed delivery, loses the HTTP response **after commit**, checks the persistent submission, retries without a second sale, rejects a changed payload and forbidden deletion, adds/replays the final receipt, checks one paid/completed order with zero balance, logs out, and verifies access revocation. Provider calls and rate-limit transport are isolated in the harness; rate-limit behavior is tested separately.

Reproduce with two terminals:

```powershell
node scripts/prepare-build-inputs.mjs
node scripts/preview-food-sales.mjs
```

```powershell
node scripts/test-food-sales-http.mjs
```

The preview binds only `127.0.0.1:4330`, contains a prominent synthetic-data banner, and stores all test changes in disposable memory. Its test account is not a production account. The local response-drop header exists only in that standalone harness, not in production APIs.

[Synthetic migration dry run](synthetic-dry-run.json) is fully inspectable and repeatable. It proposes 1 → 2 historical native orders, $63.57 → $183.57 original sales, $30 → $90 received, $33.57 → $93.57 remaining; 2 duplicate evidence links; 3 unresolved exceptions; no stock delta and no billing actions. It is not a reconciliation of live records and is explicitly not production-ready.

## Limits that still block pilot acceptance

- Cloudflare access was subsequently authorized. Private deployed schema/configuration, a complete D1 backup/recovery bookmark and a private source-snapshot dry run were captured. Inventory has no verified native lots, so new sale recording remains disabled.
- Complete Airtable, SNG, native ledger, stock/lot and recurring-plan exports are still required for the real dry run and migration design. No historical apply tool was created from guessed production mappings.
- Live SNG accepted-payment invoice/line/job identifiers and event completeness have not been verified. Missing/ambiguous links remain in office review, and the adapter is disabled by default.
- The browser connector host was unavailable. Chrome accessibility inspection verified the synthetic login and form, but the native screenshot API returned an unrelated application after a binding retry. No trustworthy mobile screenshot is delivered. Safari/Chrome on actual phones, touch keyboard, orientation, background/resume and unstable-network UI acceptance remain required.
- The proposed SQL must be reviewed against the actual private archive, data and triggers, and separately authorized. It was executed only in isolated test databases. Existing original production SQL and public historical templates were preserved.
- The owner confirmed the individual identity, food-sales scope, catalog-plus-tax policy, separate schema migration and login-only rollout. Real credentials and operational data remain outside public source. Inventory and broader historical/SNG reconciliation still require separate verification.

See [implementation and rollout](IMPLEMENTATION.md) for architecture, ownership, permission details, release gates and rollback. See [files changed](CHANGED_FILES.txt) for the complete local change list.

The password change adds owner-only account preparation/invitation/revocation, one-time setup and reset, real scrypt verification, invalid/expired/replayed link rejection, concurrent redemption protection, no PIN fallback, manager/inactive/ambiguous identity rejection, and setup-token/password non-disclosure tests. A release-checksum test binds the new production DDL to its reviewed source without rewriting the original sixty historical templates.
