# Facebook live switch, prepared and not applied

PR #4 must be merged before a production release. Neither this document nor a feature-branch commit is approval to deploy, change runtime variables, write production D1, or submit a test lead.

## Production facts and blockers

Read-only checks found the existing production Meta automation flags already set to live (`META_AUTOMATION_ENABLED=true`, `META_TEST_MODE=false`). That is existing state, not a change made in this run. The required A6 test-mode conditions were not met. The preparation branch retains its inherited runtime configuration; this document provides separately reviewable test/live changes.

The user-designated Meta Leads table lacks `Text Status Notes`. The code never silently substitutes general Notes: it preserves opt-out flags/status and reports/retries the missing dated-note mirror. Craig must approve the Airtable field provision before claiming the complete opt-out workflow ready. Verify the deployed PAT's read, metadata and write scopes without printing its value. Do not create or mutate fields in this preparation run.

Approved win-back copy/list and an authoritative Quo opt-out adapter are independent campaign prerequisites. Day 1/3/7 Meta nurture remains OFF.

## Exact live variable changes

The isolated `codex/fb-live-switch-2026-11-23` commit contains only reviewable local `wrangler.jsonc` changes. It is not merged or deployed:

| Variable | Prepared live value |
| --- | --- |
| META_AUTOMATION_ENABLED | `"true"` |
| META_TEST_MODE | `"false"` |
| META_TEST_RECIPIENTS | `""` |
| LEAD_AUTOMATION_CONTROLLED_TEST_ONLY | `"false"` |
| META_AUTOMATION_APPROVAL_ID | `"meta-live-2026-11-23-golive"` |
| META_CADENCE_ENABLED | `"false"`, unchanged |

Keep the existing approved v2 form entry in `META_APPROVED_SMS_FORMS`, including page `617929208074485`, form `1725121795904553`, consent field `text_message_consent` and its reviewed disclosure. Retain `META_TEST_FORM_IDS` for controlled verification. Do not alter secrets or any form/app setting. Existing-customer admission, consent, route and suppression gates remain mandatory after removing the Craig-only restriction.

## Exact proposed LIVE approval row

Production columns were checked read-only: id, organization_id, policy_version, approved_by, evidence, approved_at, revoked_at. The new ID must match `META_AUTOMATION_APPROVAL_ID`. This proposal inserts nothing while the evidence placeholder remains. Save actual evidence only in private approved execution material; do not commit it.

```sql
WITH approval(evidence) AS (
  VALUES ('<CRAIG_EXPLICIT_APPROVAL_TEXT_REQUIRED>')
)
INSERT INTO meta_automation_releases
  (id,organization_id,policy_version,approved_by,evidence,approved_at,revoked_at)
SELECT 'meta-live-2026-11-23-golive','org-opwp','meta-confirmation-v2',
       'Craig Bridgman',evidence,CURRENT_TIMESTAMP,NULL
FROM approval
WHERE trim(evidence)!='' AND evidence NOT LIKE '<%'
  AND NOT EXISTS (
    SELECT 1 FROM meta_automation_releases
    WHERE id='meta-live-2026-11-23-golive'
  );
```

The checked `lead_automation_settings` row already had `assistant_enabled=1` and `human_review_required=0`; no update was needed. Recheck it at execution. Any setting change requires another explicit approval; never insert an incomplete row (the real schema also requires updated_by).

## Release and first ten minutes

1. Resolve all input/schema/provider blockers. Craig separately approves merging PR #4, later feature merges, the precise production data/variable operations, and deployment. Require current CI/security gates and byte-verified private inputs. Keep seasonal and campaign migrations separately authorized.
2. Re-audit queues immediately before release. The saved private cancellation SQL was a no-op because both checked queues were empty; do not manufacture cancellations or blindly replay an old list.
3. Use only `npm run deploy -- --summary "Approved Facebook FAQ and live-mode release"`. Do not bypass locks, the release controller, security checks, or private migration verification. Do not use `deployment:pending` during read-only preparation because it can write production receipts.
4. During the first ten minutes, read back the release version and vars, verify the four required */10 calls and no exceptions, watch intake-to-Meta-Leads readback and SMS receipts, verify consent/ownership/customer holds, and confirm no Day 1/3/7 jobs are released. Inspect identities only in private operational tooling.
5. STOP must suppress all same-phone pending work immediately, retain delivery evidence, update both Airtable tables, and append dated Text Status Notes. A partial/missing-field mirror remains a blocker, not success. Any duplicate, unknown delivery, unsafe copy, unauthorized phone, or failed mirror triggers the approved rollback process.

## One-command guarded rollback

Prepare a clean rollback commit from the release being rolled back, changing only the vars below. Preserve all other current source, including campaign code. Get that exact commit through the Production quality gate before it is needed. The script deliberately refuses an uncommitted or unvalidated configuration; it does not manufacture CI approval or replace current source with an old branch.

```json
{
  "META_AUTOMATION_ENABLED": "false",
  "META_TEST_MODE": "true",
  "META_TEST_RECIPIENTS": "+14192620424",
  "META_TEST_FORM_IDS": "1725121795904553",
  "LEAD_AUTOMATION_CONTROLLED_TEST_ONLY": "true",
  "LEAD_PLAYBOOK_AUTO_SEND_ENABLED": "false",
  "META_CADENCE_ENABLED": "false"
}
```

After Craig explicitly approves both the scoped D1 revocation and the guarded test-mode deployment, put his actual approval in ignored `private/fb-rollback-approval.json`: approvedBy `Craig Bridgman`, action `fb-live-rollback`, releaseId `meta-live-2026-11-23-golive`, the exact expectedCommit, approveProductionD1Write and approveProductionDeploy both true, approvedAt (UTC, within 24 hours), and approvalText containing his actual approval. No placeholders are accepted.

From the clean, approved test-mode commit, the one execution command is:

```powershell
node scripts/fb-live-rollback.mjs --apply --approval-file private/fb-rollback-approval.json
```

It verifies PR #4 is merged and the exact commit's successful Production quality gate, revokes only the proposed LIVE ID by setting revoked_at, then invokes the existing guarded `npm run deploy` runner to publish the reviewed test-mode vars. A deployment failure leaves the LIVE row revoked and requires owner review; no automatic retry bypasses a gate. Preview the nonmutating plan with `node scripts/fb-live-rollback.mjs`. No rollback apply command was run during preparation.
