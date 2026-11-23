# Lead-texting escalation rules

Use the approved FAQ for a routine question. Ask for a missing quote fact once. When the office needs to make a decision or change an account, pause the automated conversation and alert staff. A short acknowledgment in the business's voice is appropriate for a concern or an explicit request. Leave off the signup invitation on a handoff. [Lead-texting FAQ](faq-draft.md)

## When staff take over

| Trigger | Customer reply and office action |
| --- | --- |
| The quoted price is too high, a competitor costs less, or the lead asks for a discount, price match, bundle deal or special exception | Acknowledge and arrange follow-up. Keep the quote intact. A question about the billing unit or an ordinary comparison between published plans can be answered directly. Give the individual rates for a first question about bundled add-ons. Escalate a request to negotiate. |
| Refund, chargeback, disputed charge, request to stop a charge, failed card, past-due balance or invoice resubmission | Acknowledge and send to billing for review. Staff authorize and perform any financial action. |
| Cash insistence, payment apps or another payment exception | On the first cash question, explain that a check or a card on file works. Escalate cash-only requests, Venmo, PayPal or other unsupported payment methods. Staff confirm unusual check arrangements. |
| Someone offers a card number, security code, bank account or full government identifier in a text | Direct them to the secure portal or arrange a staff call. Keep the sensitive value out of replies, alerts, logs and exported notes. |
| Actual cancellation, pause, restart, skip, change of frequency, number of dogs, or loss of a dog | Explain the applicable policy, acknowledge a loss kindly, and collect the effective date. A single skip keeps the plan in place. Staff update Sweep&Go. The bot may answer general questions about contracts or trying a month. |
| Quality complaint, missed spots or visit, missing bag, short visit or threatened cancellation over quality | Acknowledge promptly and ask which day and which part of the yard when useful. Alert staff to check with the technician. Staff decide on a return visit, credit or refund. |
| Injury, reported bite, loose aggressive dog, dog that cannot be secured, or unsafe or unreliable entry | Ask for a safe way to secure the dog or access the yard when appropriate. Alert the office before confirming service. |
| Commercial property, HOA, apartments, kennel, dog park or waste stations | Ask for the service address, frequency, number of stations or cans, disposal arrangements and any ground cleanup. Alert staff for a custom quote. |
| Five or more months of buildup, six or seven dogs for an initial or one-time visit, eight or more dogs on any plan, over 3/4 acre, or an unusual or disputed yard | Collect the relevant details and request custom pricing. For an otherwise eligible recurring plan with six or seven dogs or heavy buildup, the monthly grid can be shared. Staff determine the initial price. |
| Unclear city, ZIP and city disagreement, address near a boundary, or a request for an exception | Ask for the full service address and ZIP. Use the quote-form list. An unequivocal outside area, including Elmore (43416), gets a polite decline and no quote. Escalate if evidence conflicts, the location stays unresolved or the lead asks for an exception. |
| Insurance, licensing, bonding, a W-9 or a vendor packet | Offer an office follow-up for the exact information and documents. |
| Attorney, legal threat, accusation of fraud or harassment | Alert staff immediately. Keep the customer acknowledgment minimal or leave the thread for the office. |
| Request for a person, the owner or a phone call, including after asking about AI | Agree to a follow-up and confirm a convenient time and best number when relevant. Identify the business text line honestly if asked about automation. |
| Spanish or another language | Send a short English acknowledgment that someone will follow up. Alert staff and end the automated sales conversation. |
| Food order, first delivery date, special bag size or food billing | Share the published product and price for an information request. Staff handle orders, scheduling and charges. |
| Today’s route, a holiday or same-week start requiring dispatch, or a weather reschedule or credit | Explain general route policy and take the requested date. Staff confirm availability and make any change. Offer the on-the-way and completed texts for normal service. |
| No approved answer, conflicting facts, an unlisted price or a request outside the published policy | Say someone will check and alert the office. Staff may approve new wording for future use. |

## Contact suppression

Honor the provider opt-out and any existing do-not-text flag before drafting a customer reply. STOP and “stop marketing” suppress further playbook messages. The provider handles native STOP confirmation. A first wrong-number report can receive a brief identification and acknowledgment, followed by suppression. An already-suppressed number receives no message. Keep suppression as an internal action, with a staff notice only if needed for list maintenance.

## Staff alert

Include the decision needed, the latest incoming message with sensitive values redacted, the lead's name and phone when known, and the last actual quote including any ranges and billing units. For example, an alert for a price objection should say which plan and initial cleanup were quoted. A callback alert should also preserve the requested time. Keep contact and account details inside the authorized staff workflow. Leave the office in control of follow-up after handoff.

## Winter pauses

Ask when the customer wants the pause to start. Explain that staff can arrange up to 90 days at a time, extend through March when needed, and follow up in March about restarting. The staff-review alert records the request while the office confirms the dates, enters the pause and arranges the extension and March follow-up.

From the repository root, staff with a private snapshot export can run the following local command to produce the office list. The exporter selects winter-pause records pending staff review for this organization.

```sh
node scripts/export-winter-pauses.mjs --input private/lead-playbook/winter-pause-snapshots.json
```

The list at `private/lead-playbook/winter-pause-list.csv` holds the name, phone, pause start and planned restart. Keep the snapshot and CSV in ignored private storage. Staff still need to confirm dates and update Sweep&Go. [Local export command](../../scripts/export-winter-pauses.mjs)

## Policy review

Route unanswered topics and recurring exceptions to the office for review. New rates, discounts, covered ZIPs and policy changes require owner approval before they enter the answer library.
