# Dog-food staff accounts

The owner sidebar links Dog food → Staff accounts to `/admin/dog-food/staff-access/`. The master directory shows account status, email invitation acceptance, setup expiry and last sign-in. Owner MFA is required to read or change staff access.

The owner enters a name and individual email, reviews the identity and sale-only permissions, and explicitly approves the invitation email. An existing password reset needs separate confirmation in that review. The email contains a one-use setup link valid for 24 hours. Setup requires matching passwords of at least 12 characters, including a capital letter and symbol. No login is available until setup completes. Existing field permissions are preserved and must be acknowledged if an identity is reused; new invitations never create field credentials.

Food-sales staff can look up an existing client, review catalog prices, record a new sale including actual payment/handoff evidence at creation, and read their own recent entries/save confirmations. They cannot create or edit customer profiles, change an existing sale, add later receipts or handoffs, manage inventory, view owner reporting, or administer accounts. The HTTP boundary enforces these restrictions; hiding UI controls is not the access control. Owner sale and customer workflows retain their existing permissions. Inventory and rollout gates still apply.

Revocation disables the food-sales grant, invalidates all sessions and unused setup links, and retains historical sales and attribution. Reapproval issues a fresh invitation rather than restoring old sessions or links. Unrelated staff permissions remain unchanged.

The invitation command is the durable single-send claim. The raw token, password and email body are never stored in command/audit records. The existing configured transactional email provider sends only after explicit owner approval; its acceptance status is recorded separately from inbox delivery. An interrupted or uncertain send requires provider review. Retrying the same command never sends again. An explicitly approved replacement creates a fresh one-use link and invalidates old links. No bulk invitations or test messages are sent during deployment.

This uses existing staff grants, credentials, invitation, session, command and audit tables. No database migration is required.
