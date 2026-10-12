---
number: 210
title: Edit a flat's facts after the building is seeded
status: open
labels: [needs-triage]
assignee:
blocked_by: []
parent:
created: 2026-10-12
closed:
---

## Problem

From 12 Oct 2026 real buildings arrive through `npm run estate:seed` (SPEC-estate.md, "Seeding a
building from a developer sheet"). A building is seeded once. A mistake found afterwards — rooms 4
instead of 4.5, a wrong floor, a flat type typed wrong — has two fixes today: rerun the whole file
with `--update`, which is a developer's terminal act, or remove the flat and add it again on A13,
which is refused as soon as a letting points at the flat. Neither is an admin's.

The director decided in the 12 Oct grill that after creation a building is changed by hand in the
UI, and that the edit screen is its own ticket so the seed could ship first.

## What it should do

An `estate.write` holder can change a flat's rooms, floor, area, flat type and balcony area from the
flat's page. The same edge validation A13 applies. Whether a changed fact writes an `estate_event`
(which today only a promotion appends) is part of this ticket's spec.

## Not this ticket

Tenure — #211. Bays and storage rooms on a flat — they arrive from leases.
