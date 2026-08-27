# Google review sync

The production Worker runs the Google review pipeline at `15 * * * *` before it refreshes the Airtable cockpit snapshot in D1.

The pipeline:

1. Refreshes the Google Review Tracking roster from Airtable Customers, Daily Job Log, and One-Time Clients without changing existing review decisions or aliases.
2. Exchanges the stored Google OAuth refresh token for a short-lived access token.
3. Reads every review for the configured verified Business Profile location.
4. Matches the reviewer's display name against Client Name, Google Review Aliases, and an already-confirmed Review Name.
5. Marks only unambiguous matches as Reviewed in Airtable and stores the reviewer name, review date, and rating.
6. Refreshes the D1 cockpit snapshot so the protected backend reflects Airtable immediately.

The sync never changes a Reviewed record back to Not reviewed. Duplicate aliases are treated as ambiguous and skipped. Manual Mark reviewed and alias editing remain available in the protected admin dashboard.

## Google Cloud setup

Use project `opwp-review-sync-503019`.

1. Request and confirm Google Business Profile API access for the project. Google documents that the Google My Business API is visible only after project approval.
2. Enable Google My Business API and My Business Account Management API. The broader Business Profile setup page lists the other related APIs Google may require for approved projects.
3. Create an OAuth web client and configure the consent screen.
4. Authorize the account that owns or manages the OPWP Business Profile with scope `https://www.googleapis.com/auth/business.manage` and obtain an offline refresh token.
5. Use the Account Management API to obtain `accounts/{accountId}` and Business Information API to obtain `locations/{locationId}`.

Do not leave an External OAuth app in Testing for the production connection. Google states that these refresh tokens expire after seven days when non-profile scopes such as `business.manage` are used. Publish the consent configuration appropriately or, for a managed Workspace organization, use the applicable internal/trusted configuration.

Official references:

- https://developers.google.com/my-business/content/basic-setup
- https://developers.google.com/my-business/content/implement-oauth
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
- https://developers.google.com/identity/protocols/oauth2#expiration

## Cloudflare secrets

Store real credentials only as Worker secrets. Never put them in source or `wrangler.jsonc`.

```powershell
npx.cmd wrangler secret put GOOGLE_BUSINESS_CLIENT_ID
npx.cmd wrangler secret put GOOGLE_BUSINESS_CLIENT_SECRET
npx.cmd wrangler secret put GOOGLE_BUSINESS_REFRESH_TOKEN
npx.cmd wrangler secret put GOOGLE_BUSINESS_LOCATION
```

`GOOGLE_BUSINESS_LOCATION` must have this exact shape:

```text
accounts/ACCOUNT_ID/locations/LOCATION_ID
```

The existing `AIRTABLE_API_KEY` secret also needs record read/write access to the OPWP base. Alias-field creation is a one-time setup task and requires Airtable schema-write permission:

```powershell
node scripts/setup-google-review-tracking.mjs
node scripts/setup-google-review-tracking.mjs --apply
```

The OPWP base has already been initialized with Google Review Aliases, including `Mitch Medici` on Allen Williams.

## Health and failure behavior

Each configured run writes `google_reviews` to D1 `system_sync_runs` with `success` or `failed`. Missing OAuth configuration records `skipped`. Errors contain only bounded provider status context; OAuth tokens and Airtable credentials are never logged.

If Google fails, Airtable is not modified by the review phase. The Worker still attempts the regular Airtable-to-D1 cockpit refresh, then reports the Google sync failure so monitoring can surface it.
