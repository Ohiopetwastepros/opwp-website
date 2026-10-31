# Private build inputs and migration history

The public repository contains implementation code, fabricated fixtures, and test-schema templates. Operational exports, financial defaults, staff identities, routing history, credentials, original production SQL, and internal reference documents belong in ignored private storage.

## Local tests and CI

CI explicitly runs `node scripts/prepare-build-inputs.mjs --synthetic` with `CI=true`. This installs fabricated inputs and renders the public templates into ignored `tmp/test-migrations/` files. Tests execute those generated schemas in isolated test databases. Templates are not production migrations.

Existing private workspaces can run `npm test`; preparation uses their private identity bindings only in local test scaffolding. The historical production SQL files themselves are never used as test inputs.

## Production requirements

Restore the private input manifest and its listed files from the owner's private backup. Restore the original `migrations/` directory and `private/production-migrations.json`. The manifest verifies all original SQL files byte for byte. `node scripts/require-private-migrations.mjs` checks this archive without executing SQL.

Production deployment refuses synthetic inputs and checks the archive before release. Use `npm run deployment:pending -- --summary "..."` while preparing work, then the required `npm run deploy -- --summary "..."` release runner after CI and security gates pass. Deployment does not apply database migrations.

Database migration commands require the original private archive and separate authorization for that database operation. Never copy generated test schemas into `migrations/`, and never use them against production.

Current-tree separation preserves original local records and does not rewrite earlier Git history. Internal reference documents remain in private storage; public documentation must not contain operational records.

The migration data review covers every complete SQL statement, including triggers and encoded JSON. `tests/fixtures/migration-review.json` records the reviewed template hashes; any template change requires another review. Concrete provider associations and historical lead cleanup details are supplied through private bindings. Maintenance-script customer review and lifecycle records live in `lib/operational-private.json`. CI supplies fabricated inputs, and maintenance scripts refuse apply mode with synthetic inputs.

Historical Meta report builders contain original findings and stay private with the export snapshot. The private manifest restores their unchanged source; public CI and the deployed website do not execute these reporting tools. Reporting account validation receives its account from the protected private snapshot rather than a public default.

Bank account matching is configured by the ignored `lib/bank-private.json`. The owner scope and selection rules are preserved; public CI uses `tests/fixtures/bank-example.json` with fictional names and masks. No account access or database changes are performed by preparation.
