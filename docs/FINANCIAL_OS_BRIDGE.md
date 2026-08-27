# Personal Financial OS bridge

The OPWP backend is the sole holder of QuickBooks Online OAuth credentials. Its Financial OS bridge
publishes a fixed, aggregate-only business summary for personal owner planning:

```text
GET /api/integrations/financial-os/business-summary
Authorization: Bearer <FINANCIAL_OS_SYNC_TOKEN>
```

The endpoint includes income-statement totals and trends, cash, receivables, liabilities, equity, and
cash change. It excludes Intuit tokens, account numbers, customers, vendors, employees, and individual
transactions. It is not a generic QuickBooks query proxy.

For local development, add `FINANCIAL_OS_SYNC_TOKEN` to the ignored `.dev.vars` file. For production,
store it as a Cloudflare secret. Use the same independently generated value as
`FINOS_BUSINESS_BRIDGE_TOKEN` in Personal Financial OS. Rotate both sides together if the token is ever
exposed.
