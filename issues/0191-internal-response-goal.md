---
number: 191
title: The internal response goal
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [182]
parent: 181
created: 2026-10-06
closed: 2026-10-07
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The amber and red age thresholds of the internal response goal become rows at /settings, editable
without a deploy. Each open call in the list shows its age against them, and the list filters on
amber and red. The goal is internal and shown to no tenant; a promise to tenants is an SLA, and that
is the director's decision when one is made.

## Acceptance criteria

- [x] Thresholds are editable at /settings and take effect without a deploy
- [x] A call older than amber shows amber, older than red shows red; closed calls show neither
- [x] The list filters on amber and red
- [x] Clicked on `:3000`

## Comment — 2026-10-07

Closed. The amber and red thresholds are whole minutes at /settings, placeholders 240 and 1440 until Dona Dom supplies theirs. An open call older than amber shows amber, older than red shows red, and a closed call shows neither. The list filters on the band. Red must be later than amber. A save is read on the next request.

Clicked on :3000 while signed in. The three open calls, all older than two minutes, showed red after a temporary save of 1 and 2. The amber filter was empty. Those placeholders were put back at 240 and 1440. The temporary save left one audit row.

## Blocked by

- #182 — Log a phone or walk-in call and see it in קריאות
