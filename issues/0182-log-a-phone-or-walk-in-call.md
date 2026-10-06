---
number: 182
title: Log a phone or walk-in call and see it in קריאות
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The first tracer bullet through `calls`. The stub קריאות tab becomes the real list. An office worker
opens a short manual-entry form, picks PHONE or WALK_IN, writes a description, and either names the
sender in free text or marks the sender unknown. No sorter runs. The call is created in NEW with its
Source channel set once and never changed, and the write is audited with the staff account that made
it.

The tab lists open calls with their Source channel marker, state, sender (or "unknown") and age, and
the rail shows the open-call count beside קריאות. The page is server-rendered with no client
JavaScript and follows the approved stakeholder mockup. The ServiceCall entity, its migration and the
calls contract arrive here, tested against real Postgres in the style of the tenancy tests.

SPEC-calls.md is the requirement; edit it first if anything here turns out to disagree.

## Acceptance criteria

- [ ] A PHONE call and a WALK_IN call entered on the form appear in the list in NEW, each with its channel marker
- [ ] The form refuses an entry missing the channel, the description, or a sender-or-unknown choice
- [ ] Source channel cannot be changed after creation, through the contract or the screen
- [ ] The rail shows the open-call count beside קריאות, and it matches the list
- [ ] Every create is audited with the staff account
- [ ] Contract tests run against real Postgres; HTTP tests cover the form and the list
- [ ] Clicked on `:3000` after a restart, and on staging after merge

## Blocked by

None (can start immediately).
