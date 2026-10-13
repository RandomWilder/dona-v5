---
number: 224
title: The closed list shows the last thirty days
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [222, 223]
parent: 216
created: 2026-10-13
closed: 2026-10-13
---

## Parent

#216 — The קריאות tab matches the approved screens.

## What to build

The closed segment uses the same split inbox and list view as the open list. It shows calls closed
in the last 30 days, newest close first, grouped as today, yesterday, the rest of the Israeli week
back to Sunday, and older. An empty group is left out.

The previous 30 days load only when a closed call exists before the window. The list can be
narrowed by exit, and those counts match the calls on the page. The category menu stays. The
open-call summary stays about open calls.

A closed row shows the exit and the close time, with no goal marker. A call that was ever an
emergency carries היה חירום. The split preview shows the outcome, and not a next step, a progress
strip, or a message bubble. An older closed call remains on its own page and on the requester's
profile.

An index on close time is added only if a measurement shows the planner chooses it. The plan and
the timings are written into the calls spec. An index the planner will not choose is not added.

## Acceptance criteria

- [x] The calls spec records the 30-day window, the day groups, and the exit filter, before the code
- [x] The closed list shows the last 30 days, newest close first, grouped today, yesterday, the rest of the week back to Sunday, and older, with an empty group omitted
- [x] Older calls load 30 days at a time, and only when one exists before the window
- [x] The exit filter's counts match the rows on that page; the category menu remains; the open-call counts do not change meaning
- [x] A closed row shows the exit and the close time, no goal marker, and היה חירום when the call was ever flagged
- [x] The preview shows the outcome only; an older closed call still opens from its page and from the party profile
- [x] An empty recent window and an empty filtered window say different things
- [x] The close-time index is measured and the result is written into the calls spec, whichever way it goes
- [x] The route test covers the groups across midnight, the exit filter, and paging back until nothing older remains
- [x] Clicked on `:3000`

## Comment — 2026-10-13

The closed segment shows the calls closed in the last 30 days, newest close first, under היום, אתמול, השבוע and קודם by the day of the close in the office's zone, with an empty group left out. It can be narrowed by exit, and each exit count is the number of rows that exit has in the window under the chosen category. A closed row shows the exit and the close time. The split preview shows the outcome with no excerpt, next step or steps. The route test runs at a 2020 clock: 00:10 and 23:50 either side of midnight, a Sunday, a Saturday, a Monday with no week heading, and the exit and category filters. It pages back to an exact 30-day boundary and stops when nothing older remains.

The review found that the older link could lead to an empty window, which story 92 rules out. The spec now says the link leads to the window that holds the newest older close. The test covers a 200-day gap that skips five empty windows. A partial btree on `closed_at` for closed calls is chosen for the window and for the older read, at 2,908 and 29,080 measured closes. The plans and timings are in SPEC-calls.md and migration 0067. On :3000, signed in, the closed list, the split preview, the exit filter with its empty copy, and the empty older page all opened with no server errors. The local database holds one closed call, so the older link was checked by the route test, not by a click.

## Blocked by

- #222 — Calls open as a split inbox
- #223 — A closed call shows its outcome
