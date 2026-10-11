---
number: 183
title: Call page: identify the sender by hand and set a Category
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [182]
parent: 181
created: 2026-10-06
closed: 2026-10-06
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

Each call gets its own page with a timeline of what happened to it. An office worker identifies the
requester by linking the call to a Party; this links that one call and nothing else, and saves no
contact. The call moves NEW → IDENTIFIED. A guarantor cannot be chosen as a requester for service
(foundation rule 7).

The worker then sets a Category, the trade the call needs, and the call moves IDENTIFIED → TRIAGED.
Category is an admin-managed list of rows at /settings, seeded with a placeholder list until Dona Dom
supplies theirs, deactivated and never deleted. It is distinct from `asset_type` and feeds nothing
else.

Every transition is a command a person issues, appears on the timeline, and is audited. The list
gains filters on state and Category.

## Acceptance criteria

- [x] The call page shows the call's details and a timeline of every transition with who made it
- [x] Linking a Party moves the call to IDENTIFIED and creates no PartyContact
- [x] A guarantor cannot be linked as the requester; a policy case covers it, red first
- [x] Setting a Category moves the call to TRIAGED; only active Categories are offered
- [x] Categories can be added and deactivated at /settings without a deploy; a deactivated Category stays on calls that carry it
- [x] The list filters on state and on Category
- [ ] Clicked on `:3000` and on staging

## Blocked by

- #182 — Log a phone or walk-in call and see it in קריאות

## Comment — 2026-10-06

The call page shows the call and a timeline of who opened it, who identified the requester, and who set the Category. Linking a party moves that one call to IDENTIFIED and writes no contact. A guarantor who is not a service contact is refused by the database; a service contact who also guarantees another lease can still be the requester. Setting an active Category moves the call to TRIAGED, and a later change stays there. Categories are added and deactivated at /settings. A deactivated Category stays on the calls that already carry it and drops out of the choices. The list filters on state and on Category.

The restarted server on `:3000` showed the list, the state filter, and the placeholder Category list in a signed-in browser. The write path — open, identify, set Category, filter — was run against that same process. Staging is still after merge.
