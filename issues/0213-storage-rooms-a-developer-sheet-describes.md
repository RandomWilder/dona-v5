---
number: 213
title: Storage rooms as a developer sheet describes them — attached without a number, above a bay
status: closed
labels: []
assignee:
blocked_by: []
parent:
created: 2026-10-12
closed: 2026-10-13
---

## Problem

The Beit Shemesh sheet (BSM-MSK) describes a flat's storage room in four ways, and the system can hold
only one of them:

- `צמוד בקומה 401` — a numbered room on the flat's own floor. Seeded as a STORAGE space on that floor.
- `534 על החניה` — a numbered room above a parking bay. Seeded as a STORAGE space at the bay level,
  which loses "above a bay" and leaves storage 534 and bay 534 side by side with the same name.
- `מחסן צמוד מהגינה / מהמרפסת ללא מספר` — a room attached to the flat, reached from its garden or
  balcony, with no number (12 flats). Not seeded at all: nothing can hold it.
- `אין` — no storage room.

Dona Dom shows all of these. A tenant asking about "my storage room" and a lease naming one must both
find it.

## What it should do

The spec decides how each form is held. The likely shape: an attached unnumbered room is a fact on the
Unit (its presence and where it opens from), not a Space, because it has no door of its own to assign;
a room above a bay is a STORAGE space that names its bay. The building plan file and
`building-sheet-to-plan` take the new facts, the flat and storage tiles show them, and BSM-MSK is
refilled with `--update`.

## Comment — 2026-10-13

Closed by 0066. The sheet showed the ticket's guess about "534 על החניה" was wrong: none of the
eighteen storage numbers written that way matches a bay of its flat, so the room does not name a bay.
It is a numbered storage room built above the parking, and the fact kept is where it is,
`space.over_parking`, on the STORAGE Space only. An attached room with no number is
`unit.attached_storage` (from the garden or from the balcony), a fact on the flat and not a Space. A
sheet's `אין` is not written, because no flat is linked to its numbered room either. The three BSM plan
files carry all of it, and staging is refilled with `--update` once 0066 is deployed.
