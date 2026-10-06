---
number: 183
title: Call page: identify the sender by hand and set a Category
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [182]
parent: 181
created: 2026-10-06
closed:
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

- [ ] The call page shows the call's details and a timeline of every transition with who made it
- [ ] Linking a Party moves the call to IDENTIFIED and creates no PartyContact
- [ ] A guarantor cannot be linked as the requester; a policy case covers it, red first
- [ ] Setting a Category moves the call to TRIAGED; only active Categories are offered
- [ ] Categories can be added and deactivated at /settings without a deploy; a deactivated Category stays on calls that carry it
- [ ] The list filters on state and on Category
- [ ] Clicked on `:3000` and on staging

## Blocked by

- #182 — Log a phone or walk-in call and see it in קריאות
