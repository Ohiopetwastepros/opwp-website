# Win-back preparation, default OFF

This branch is preparation for owner review. It must not merge before PR #4. It includes the Facebook FAQ preparation branch and must be reviewed with that dependency. No source commit authorizes production deployment, database changes, provider mutations, campaign activation, or sends.

## Prepared implementation

The campaign engine stores recipients, initial and reply delivery receipts, a single organization/day batch lease, persistent stratified A/B assignments, reply outcomes, owner notices, and an Airtable outbox. The CSV importer admits approved rows, holds the review group, and takes review identities and exact byte-pinned copy from private files. Source records and rendered campaign copy are not public build inputs.

`schema-proposals/0072_win_back_campaign.sql` is a new schema proposal, separate from the immutable private production migration archive. It has only been applied to isolated local test databases and ignored local campaign storage. It is not installed by deployment. A separately authorized migration must first be added through the private migration review and hash-manifest process.

The local CLI has only `import-local`, `dry-run`, and `report` commands. Its databases stay under ignored `tmp/winback`, and operational output must be git-ignored. It has no remote or send command. Example commands use the owner's actual private file paths in place of the placeholders:

```powershell
node scripts/winback.mjs import-local --csv <original-csv> --copy <approved-private-copy-json> --rules <private-review-rules-json> --campaign <campaign-id> --database tmp/winback/approved.sqlite
node scripts/winback.mjs dry-run --csv <original-csv> --copy <approved-private-copy-json> --rules <private-review-rules-json> --campaign <campaign-id> --database tmp/winback/approved.sqlite --batch 1 --out docs/golive/winback-batch1-dry-run-2026-11-23.md
node scripts/winback.mjs report --campaign <campaign-id> --database tmp/winback/approved.sqlite
```

Use the same imported database for the dry run to retain the exact A/B assignment. A fresh import starts disabled, killed, without send approval, and with the review group disabled. Copy approval never grants send approval. The dry-run CLI does not assert verified provider clearance. The actual private report attaches a separate dated read-only audit and distinguishes known exclusions from unknown checks.

## Activation gates

| Source default | Value |
| --- | --- |
| WINBACK_ENABLED | `false` |
| WINBACK_SEND_ENABLED | `false` |
| WINBACK_AUTOREPLY_ENABLED | `false` |
| WINBACK_KILL_SWITCH | `true` |
| WINBACK_STORAGE_READY | `false` |
| WINBACK_CAMPAIGN_ID | empty |
| WINBACK_SNG_PAUSED_PATH | empty |

Storage readiness remains false until the separately approved schema is installed and verified. Disabled storage performs no campaign queries. Environment gates and stored global/campaign kill switches are checked before every send. Stored approval evidence and a separately approved backend conversation are required for reply delivery. The existing ten-minute schedule invokes the gated engine; no new cron is created. The authenticated, MFA-protected admin endpoint permits aggregate reports, emergency kills/cancellations, and at most one engine attempt per requested run. It cannot import, enable, grant approval, or inject a sender.

The engine checks both authoritative Airtable tables, local global suppression, complete SNG customer/paused directories, seasonal pauses, authoritative Quo opt-out state, thirty-day OPWP outbound history, other active campaigns, and open Meta conversations. It repeats checks after the durable claim, and the transport rechecks opt-out state and kill switches immediately before POST. Missing or incomplete authority holds delivery. Provider acceptance or ambiguous delivery is never blindly retried. Interrupted claims become unknown after fifteen minutes for reconciliation; accepted receipts remain intact.

The policy permits one batch per organization/day, at most one hundred recipients, weekdays from 11 AM until 6 PM America/New_York, excluding Thanksgiving, with at least fifteen seconds between attempts. Even an entirely excluded batch occupies its assigned day. Scheduling limits describe internal execution policy, not customer promises.

## Unresolved provider and schema prerequisites

- The public Quo v1 API does not expose a verified authoritative recipient opt-out read contract. Absence of STOP in history or an absent contact field is insufficient. A verified read adapter must be implemented and reviewed before activation.
- The SNG paused roster endpoint has not been verified. Existing bounded SNG directory loading can be reused after vendor verification, but a guessed endpoint or an active roster relabeled as paused cannot establish clearance.
- Current default provider construction deliberately supplies neither adapter. Runtime flags and credentials alone cannot bypass these holds. Completing and testing the shared provider resolver used by initial sends, replies, and admin attempts requires a subsequent source change; this is a go-live blocker, not merely a missing environment value.
- Meta Leads lacks the required `Text Status Notes` field. Provisioning that field and confirming metadata/read/write permissions require separate approval. Opt-out flags and status are retained even if note mirroring is incomplete; the durable outbox continues retrying. No general Notes substitution is made.

STOP enters the existing global suppression path before campaign routing, cancels same-phone pending work, and preserves sent/unknown/provider-accepted evidence. Opt-outs and failures use existing-record-only Airtable writeback, preserving human notes and appending dated idempotent markers. Campaign replies invoke the same `nextPlaybookResponse` FAQ function as Meta leads with campaign/version context. Suggestions remain durable drafts until all reply gates and conversation approval pass. Price pushback, Spanish/unclear questions, moved recipients, and former-client restart interest enter the existing private owner notification workflow. Uncontacted imported rows do not take ownership of organic conversations; newer open Meta conversations retain ownership.

## Cards and reporting

The [official Quo API](https://www.quo.com/api) and [send-message reference](https://www.quo.com/docs/mdx/api-reference/messages/send-a-text-message) expose text content, sender, and recipients, with no outbound media input. The existing transport remains text-only. A/B assignment and per-variant outcomes are retained, but no card winner can be inferred without delivered card treatments, and switching always needs Craig's approval.

Options for Craig are text-only, a separately approved hosted-card link with revised message copy, or a separately verified MMS-capable path. No cards were uploaded or published. Phone-bearing filenames, card images, original CSV, review identities, and operational reports stay private. Do not put them in public browser assets.

## Required approval sequence

Resolve the source/provider/schema prerequisites and get the exact release through CI and security checks. Craig separately approves PR #4, feature merges, the guarded deployment, the private migration and import, campaign/send/reply enablement, batch one, any review-group inclusion, and any card treatment or later split change. Do not turn activation into a single implicit approval. Facebook testing and live-mode approval have their own runbooks. No production operations or actual messages were executed during preparation.
