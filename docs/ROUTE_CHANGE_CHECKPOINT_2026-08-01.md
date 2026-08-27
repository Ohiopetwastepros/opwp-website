# Route Change Checkpoint

Updated: August 1, 2026
Source schedule: `C:\Users\Craig\Downloads\Master Schedule (1).csv`

This file records the routing decisions and reported implementation status from the August 1 review. Route totals below are route memberships, not the exact number of cadence-due stops in a particular week.

## Reported completed in Sweep & Go

| Customer | Frequency | Previous day | New day | Routing reason |
| --- | --- | --- | --- | --- |
| Andrea Firman | Biweekly | Monday | Friday | Consolidate Bowling Green on Friday |
| Barbara Seguine | Weekly | Monday | Friday | Consolidate Bowling Green on Friday |
| Ryan Rothenbuhler | Weekly | Monday | Friday | Consolidate Bowling Green on Friday |
| Dana Mocek | Biweekly | Monday | Friday | Join the established Perrysburg Friday route |
| Michael Friess | Weekly | Monday | Friday | Join the established Perrysburg Friday route near Tony's depot |
| Barbara Lederman | Weekly | Thursday | Wednesday | Consolidate the Swanton/Whitehouse corridor on Wednesday |
| Brooke Shumer | Weekly | Thursday | Wednesday | Consolidate the Swanton/Whitehouse corridor on Wednesday |

These changes were reported as made in Sweep & Go. At the last Airtable check, Airtable still displayed the previous service days, so a post-sync reconciliation is required.

## Recommended next move - confirmation still needed

| Customer | Frequency | Current day | Recommended day | Routing reason |
| --- | --- | --- | --- | --- |
| Greg Gladieux | Weekly | Thursday | Wednesday | Greg is in Monclova near two existing Wednesday Monclova customers and the Wednesday Waterville/Whitehouse/Swanton corridor |

Greg was omitted from the earlier recommendation because the day-policy rule recognized Swanton/ZIP 43558 but not neighboring Monclova/ZIP 43542. The geographic route review supports moving him to Wednesday.

## Pending customer outreach - Monday to Wednesday

| Customer | Frequency | Current day | Proposed day | Status |
| --- | --- | --- | --- | --- |
| Eric Barnum | Biweekly | Monday | Wednesday | Pending customer approval |
| Erin Kelley | Biweekly | Monday | Wednesday | Pending customer approval |
| Jeremy Smith | Weekly | Monday | Wednesday | Pending customer approval |
| Jim Hansen | Weekly | Monday | Wednesday | Pending customer approval |
| Michelle McCaulla | Biweekly | Monday | Wednesday | Pending customer approval |

These five moves consolidate the Monday Maumee customers into the established Wednesday Maumee route.

## Route membership checkpoints

| Scenario | Monday | Tuesday | Wednesday | Thursday | Friday |
| --- | ---: | ---: | ---: | ---: | ---: |
| Master schedule before changes | 72 | 48 | 17 | 54 | 29 |
| After reported completed changes, including Michael Friess | 67 | 48 | 19 | 52 | 34 |
| After adding Greg Gladieux | 67 | 48 | 20 | 51 | 34 |
| Final plan after Greg plus the five pending Maumee moves | 62 | 48 | 25 | 51 | 34 |

## Locked scheduling rule

- Do not change service days for twice-weekly customers at this time.
- None of the customers listed above are twice-weekly.

## Route-model configuration

- Tony Bridgman's route start and end address: **25610 Luckey Rd, Perrysburg, OH 43551**.
- Tony's route mileage and drive time should include travel from and back to this depot.
- Bowling Green flexible accounts should be quoted for Friday.
- Swanton flexible accounts should be quoted for Wednesday.
- Greg Gladieux is a customer-specific Monclova move; do not infer that every Monclova account must change days without a route review.
- Michael Friess is a customer-specific Perrysburg move; do not automatically force every Perrysburg quote to Friday solely because of this move.

## Next actions

1. Confirm whether Greg Gladieux has been changed to Wednesday in Sweep & Go.
2. Contact the five pending Maumee customers about moving from Monday to Wednesday.
3. Reconcile Sweep & Go against Airtable after the completed changes sync.
4. Refresh the route plan and quoting-tool route data after Airtable reflects the final approved days.
5. Recheck Monday and Wednesday road time after customer responses; route membership totals alone do not include driving, breaks, or cadence timing.
