---
number: 150
title: "נכסים — vacancy on the inventory"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [148, 149]
parent: 147
created: 2026-09-22
closed: 2026-09-22
---

## Parent

[#147](0147-nekasim-building-inventory.md)

## What to build

On the נכסים building page, vacancy is derived, never stored. Headlines: counts by kind, plus vacant
Units, vacant parking, and vacant storage. Per-row chip on Unit, PARKING, and STORAGE. No chip on
elevators or later COMMON / EXTERIOR / extra TECHNICAL. No rent, no lease-end on this list.

Vacant Unit: no letting that counts today. Vacant parking: no assigned bay on a letting that counts
today (a built-bay link does not occupy the bay). Vacant storage: no assigned storage on a letting
that counts today (built storage does not occupy it).

“Counts today” is the same injection the occupancy chip already uses. Estate does not grow a second
day predicate.

This is step 3 of [#147](0147-nekasim-building-inventory.md). Click headlines and chips after a
`dev` restart: let a Unit, assign a bay and a storage room, watch the chips move.

## Acceptance criteria

- [x] Headlines show kind counts and vacant Units / parking / storage
- [x] Each Unit, PARKING, and STORAGE row has a vacancy chip; elevators and extra shared Spaces do
      not
- [x] A letting that counts today occupies its Unit, its assigned bay, and its assigned storage
      only
- [x] Built bay / built storage without an assigned letting still shows those Spaces vacant
- [x] Rent and expiry are absent from this page
- [x] Specs updated in the same change; path clicked after a `dev` restart

## Blocked by

- [#148](0148-assigned-storage-on-the-letting.md)
- [#149](0149-nekasim-tab-create-and-mint.md)

## Comment — 2026-09-22

Shipped. Vacancy on `/estate/inventory/:buildingId` is derived: `resolveOccupiedUnits` for Units,
assigned bay / assigned storage on those tenancy ids only. Built links do not occupy. Headlines plus
per-row chips on UNIT / PARKING / STORAGE; none on elevators or COMMON. Specs updated. `npm test`
green. Dev restarted on `:3000`; clicked נכסים → בניין קליק: headlines `דירות · 1` / `דירות פנויות · 1`
and chip `פנויה`. Occupied-vs-built path proved by `src/estate/inventory.test.ts`.
