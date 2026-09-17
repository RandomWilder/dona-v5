---
number: 122
title: "Active lettings in a Building"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 120
created: 2026-09-17
closed: 2026-09-17
---

## Parent

#120 — Office retrieval on the Building: panel, list command, tool choice.

## What to build

A documented tenancy command: given a Building and today’s clock, return each Unit in that Building that has an active letting covering today.

Each row is one Unit: unit name, letting start and end dates, names of every party on that letting except the ערב. No phone, no ת.ז., no rent, no captured fields. Vacant, draft, ended and future lettings are absent. An empty result is valid.

No panel and no office turn yet — this ticket is the command, greppable and testable without the chrome. Estate does not own this read; evidence does not query tenancy tables.

## Acceptance criteria

- [x] Command returns one row per Unit let today in that Building
- [x] Names include every role except ערב; ערב is absent
- [x] Shape has no phone, no ת.ז., no rent, no captured field
- [x] Vacant Units and non-active lettings are absent
- [x] Another Building’s lettings are absent
- [x] Empty Building (nobody let today) returns an empty list, not an error
- [x] Policy cases written red first where they are new constraints (ערב absent; no identifiers on the shape)
- [x] `SPEC-tenancy.md` records the command in the same change

## Blocked by

None (can start immediately).

## Comment — 2026-09-17

Closed: `listActiveLettingsInBuilding` on the tenancy contract. One row per Unit let today in that Building — name, dates, parties except ערב. Vacant, draft, ended, future, and another Building absent. Empty list, not an error. Policy cases red first (ערב; no ת.ז./phone/captured field on the shape). Clock covers today in this command; the isolation SQL predicate is not restated.
