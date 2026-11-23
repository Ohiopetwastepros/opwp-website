# Facebook v2 verification after separate owner approval

No Meta test lead was submitted during preparation. Production was not in the required test mode, and the deployed confirmation/FAQ version had not been updated to this preparation branch.

1. Craig must separately approve PR #4, the reviewed preparation deployment, any required schema/permission work, and the production test-mode variable change. Use the guarded `npm run deploy -- --summary "..."` release runner after CI and security gates pass. Do not run a database migration as part of deployment.
2. Read back deployed version and verify A1-A3 in that executable worker. Confirm `META_AUTOMATION_ENABLED=false`, `META_TEST_MODE=true`, `META_TEST_RECIPIENTS=+14192620424`, v2 in `META_TEST_FORM_IDS`, and `LEAD_AUTOMATION_CONTROLLED_TEST_ONLY=true`. The test approval record must be valid. Day 1/3/7 cadence stays false.
3. Confirm the page token/form consent field and leadgen callback using read-only Graph checks. Check pending queues again. Local simulation is not proof of live Graph configuration.
4. After Craig explicitly approves this one test submission, open Meta's Lead Ads Testing Tool. Select page `617929208074485`, form `1725121795904553` (OPWP Quote Auto Text Nov 2026 v2). Remove an old test lead only if separately authorized. Do not change app, form or subscription settings.
5. Submit exactly one lead using Craig's `4192620424`, two dogs, once a week, text preference, and affirmative text consent. Never use a customer phone or email.
6. Read back its D1 intake, Meta SMS job, and correct Airtable Meta Leads record. Record the message body and provider receipt privately; compare it with the approved confirmation. Verify the first-contact footer once only.
7. Do not submit again or enable live mode automatically. Escalate any mismatch, opt-out, provider error, or missing mirror field. Every later production action needs its own explicit approval.

The local test is `tests/meta-golive-local-flow.test.mjs`; its providers are entirely mocked. The iPhone Facebook question regression is `tests/browser/quote-question-facebook.mjs` and does not call production APIs.
