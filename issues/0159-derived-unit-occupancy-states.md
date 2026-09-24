---
number: 159
title: "Derived Unit occupancy states on נכסים and the Unit page"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [154]
parent: 152
created: 2026-09-24
closed: 2026-09-24
---

## Parent

[#152](0152-tenancy-lifecycle-activation-and-turnover.md)

## What to build

#150 shows a Unit as פנויה or not. Widen the chip to four derived states, still with no column:

- **פנויה** — no letting counts today and no draft is waiting;
- **חוזה בטיוטה** — no letting counts today, and a `DRAFT` exists whose end is today or later;
- **מושכרת** — a letting counts today (`resolveOccupiedUnits`, unchanged);
- **בסיום** — a letting counts today and its `end_date` is within 60 days, or it carries a
  `notice_date`.

A let Unit with a waiting draft is **מושכרת**, with the draft named as a second, quieter line —
that is the ordinary turnover, not a separate state.

*Counts today* stays `resolveOccupiedUnits`; the draft and ending reads come from tenancy's existing
lettings reads plus the clock. No new day predicate is written in estate, and guard two still
passes. The 60 days reuse the expiring-leases window rather than a new number. Vacancy headlines on
נכסים keep counting פנויה as vacant; חוזה בטיוטה counts as vacant too, because nobody lives there.

## Screen

Approved on the second look, 24 September 2026. On the נכסים building these four states are the
existing unit tiles, not a new chip on the old row. פנויה and חוזה בטיוטה use the dashed vacant
tile. מושכרת and בסיום use the occupied tile. Every tile is the same width and the same height,
including a tile with no second line. The second line, when there is one, stays inside that height,
so a building of many units stays a regular grid. The Unit page uses the same four words.

## Acceptance criteria

- [x] Four states derived, none stored
- [x] `resolveOccupiedUnits` untouched; guard two green
- [x] 60-day window is the existing constant
- [x] Headlines unchanged in meaning; the four states are equal-size unit tiles on נכסים, and the same four words on the Unit page
- [x] `src/estate/inventory.test.ts` covers each state
- [x] SPEC-estate.md and SPEC-flows.md A17 edited in the same change
- [x] Clicked on `:3000` after a `dev` restart

## Comment — 2026-09-24

Four states, none stored. Counts-today stays the occupancy read. Drafts and notice come from the letting list, and the sixty days are the expiring-lease window. A notice on a letting that ends later than that window is בסיום with no ending date on the line. A waiting draft on a let unit stays מושכרת or בסיום and names the draft underneath.

Dev restarted. The browser stopped at Google sign-in. The restarted server, read as an existing admin, shows פנויה and חוזה בטיוטה on the נכסים tiles (the draft line is טיוטה מ־2026-01-01 · ממתינה להפעלה) and the same words on those unit pages. The local lettings have no active household, so מושכרת and בסיום are not on `:3000`. Those two are the inventory test, including the 60th day and the day after. No active letting was inserted to manufacture the click.
