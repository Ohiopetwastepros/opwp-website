# Executive Dashboard Model

Last updated: 2026-07-14

The dashboard is organized around the factors that change enterprise value, cash generation, and owner decisions. The executive overview contains only summary measures and exceptions; operational detail belongs behind the sidebar.

## 01 — Executive overview

Decision: What requires owner attention today, and which value driver is improving or deteriorating?

- Enterprise recurring run rate: active subscription ARR and MRR.
- Financial strength: cash, month-to-date revenue, net income, and net margin from QuickBooks.
- Route economics: allocated recurring value per paid route hour versus the $100/hour minimum.
- Recurring customer base: paying cleanup customers, cleanup MRR, gross churn, and lost MRR.
- Growth platforms: open quoted MRR, one-time revenue, and dog-food sales.
- Owner action queue: no more than three material exceptions affecting revenue, cost, cash, customer trust, or data integrity.
- Today's pulse: scheduled/completed visits, completion rate, paused accounts, held MRR, and open quoted MRR.

The overview should never contain full customer, technician, inventory, event, or reconciliation tables.

## 02 — Financial performance

Decision: Can the company fund growth, equipment, payroll, and owner distributions without weakening liquidity?

Current data:

- Cash, revenue, expenses, net income, receivables, liabilities, working capital, and monthly trend from QuickBooks.
- Current cash runway estimate based on trailing expenses.

Next decision-grade measures:

- Minimum protected cash reserve.
- Owner-normalized operating profit.
- Debt-service coverage and truck affordability.
- Business-line P&L for scooping versus Extreme Dog Fuel.
- Budget versus actual and rolling 13-week cash forecast.

## 03 — Route operations

Decision: Where are labor and drive time destroying route contribution, and which route changes create the fastest capacity gain?

Current data:

- Route value per paid hour by technician versus $100/hour.
- Completed visits, allocated route value, active service hours, paid route hours, and data coverage.
- Bria's temporary route/office split.
- Repeated service-time estimate overruns.

Next decision-grade measures:

- Drive minutes and miles per stop by technician/day.
- Revenue and contribution margin per route hour.
- Stops per paid hour and route utilization.
- ZIP/weekday density, isolated-stop cost, and suggested stop moves.
- Available weekly capacity before another technician or vehicle is needed.

The existing D1 route-intelligence foundation should supply the drive-time, distance, and density layer once address geocoding and daily analysis are operational.

## 04 — Growth & retention

Decision: Is the recurring customer asset growing faster than it is leaking, and which acquisition or save actions deserve investment?

Current data:

- Cleanup MRR, active paying customers, open quoted MRR, lead conversion, and one-time revenue.
- Gross churn, reactivations, net lost MRR, cancellation reasons, paused customers, held MRR, and seasonal restarts.
- Churn reason/comment review and subscription reconciliation.

Next decision-grade measures:

- New MRR, expansion MRR, contraction MRR, reactivation MRR, and net-new MRR.
- Leads and wins by source with close rate and days-to-close.
- Customer acquisition cost and CAC payback by channel.
- Cohort retention, revenue retention, and estimated lifetime value.
- One-time-to-recurring conversion rate.

## 05 — Extreme Dog Fuel

Decision: Is dog food producing profitable recurring demand without creating inventory or fulfillment drag?

Current data:

- Paid sales, bags sold, average order, active subscriptions, monthly bag demand, delivery rate, churn, and inventory position.

Next decision-grade measures:

- Gross profit and contribution per bag/order.
- Delivery cost per order and route overlap with scooping.
- Inventory turns, days of supply, stockout risk, and reorder lead time.
- Subscription cohort retention and failed-payment recovery.
- Cross-sell penetration among scooping customers.

## 06 — Management scorecard

Decision: Are managers and technicians delivering the operating standards that support the financial plan?

- Only decision-owned metrics with a named owner, target, review cadence, and corrective action belong here.
- Route value per paid hour, completion, churn, data quality, and service-time exceptions should use the verified calculations—not duplicate Airtable formulas.
- Targets without a controllable action should remain informational and stay off the scorecard.

## 07 — Systems & controls

Decision: Can management trust today's numbers, and what failed before it affected a customer or financial decision?

- Airtable, Sweep & Go, daily subscription refresh, QuickBooks, D1 events, submissions, and route-feed health.
- Reconciliation exceptions, failed events, stale feeds, missing identifiers, suspicious mileage, and incomplete source coverage.
- D1 event ledger remains the detailed audit trail, linked from this view.

## Metric governance

### Route Intelligence implementation checkpoint — 2026-07-15

- Authoritative active-book source: protected hourly Airtable cockpit snapshot in D1.
- Current coverage: 213/213 street addresses geocoded, 224 service-day memberships, 179.75 weekly-equivalent visits, 11 locked two-day records, and 18 technician/day route sectors.
- Road-time sequences use Geoapify matrices; large technician/day books are geographically sectorized at 30 stops to remain within matrix limits.
- Route revenue/hour uses recurring revenue per scheduled visit divided by modeled service plus drive time, with $100/hour as the operating target.
- Current-week output uses the latest completed Airtable service date to anchor A/B and monthly cadence. Coverage is 86/87 cadence accounts; Melissa Furrie is included but disclosed as unanchored until a completed job supplies the cohort.
- Flexible-day candidates are advisory, exclude locked two-day accounts, stay within established service regions, and never write changes back automatically.
- The Tony full-time scenario is presentation-only. It models current Tony routes plus Bria's current Wednesday and Friday route books, excludes ambiguous shared-owner records, and exposes remaining capacity rather than treating 40 hours of recurring scooping as a target.

Every promoted KPI must have:

1. One business definition.
2. One authoritative source.
3. A documented time period and denominator.
4. A data-confidence check.
5. An owner and a decision that changes when the metric moves.

Unavailable or incomplete measures are labeled as such. The dashboard must not substitute an operational proxy for an accounting result or present a partial feed as a full-period comparison.
