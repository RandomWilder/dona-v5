---
number: 182
title: Log a phone or walk-in call and see it in קריאות
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 181
created: 2026-10-06
closed: 2026-10-06
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

- [x] A PHONE call and a WALK_IN call entered on the form appear in the list in NEW, each with its channel marker
- [x] The form refuses an entry missing the channel, the description, or a sender-or-unknown choice
- [x] Source channel cannot be changed after creation, through the contract or the screen
- [x] The rail shows the open-call count beside קריאות, and it matches the list
- [x] Every create is audited with the staff account
- [x] Contract tests run against real Postgres; HTTP tests cover the form and the list
- [ ] Clicked on `:3000` after a restart, and on staging after merge

## Blocked by

None (can start immediately).

## Comment — 2026-10-06

The open list and the phone / walk-in form are in. A phone call and a walk-in land in NEW, the form refuses a missing channel, description, or sender choice, and the channel cannot be changed afterwards. The rail count on קריאות matches the list. Each create is audited with the staff account.

The restarted server on `:3000` accepted both entries and showed them with the count. The browser tab itself stops at Google sign-in, so that check was a signed-in session against the live process, not a click through the login screen. Staging is still after merge. Other screens' rails do not show the count yet.

## Comment — 2026-10-06

Closed after review. The list, the refusal, the fixed channel and the staff audit held. The open-call count was only drawn while קריאות was the current page, which missed the parent story that the count is visible from any screen. It is now counted once per signed-in request and passed into the rail everywhere; the list page still uses the length of its own rows, and a request to the index and to נכסים shows the same number. A stored sender with no name reads as unknown. Staging is still after merge.
