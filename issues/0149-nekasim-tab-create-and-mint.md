---
number: 149
title: "נכסים — tab, create, and mint"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 147
created: 2026-09-22
closed: 2026-09-22
---

## Parent

[#147](0147-nekasim-building-inventory.md)

## What to build

A new ops-rail tab **נכסים**. בניינים stays exactly as it is (shared chrome may gain the sibling
item; do not edit בניינים routes or views). Same Building / Space / Unit tables.

From נכסים an admin lists buildings and creates one: today's A11 identity fields plus four counts
(Units ≥ 1; parking, storage, elevators may be 0). Units, parking, and storage each take a first
number when their count is above zero. Names are the bare integer sequence. Elevators are TECHNICAL
Spaces named `1`…`N`. One save mints those Spaces (a Unit row per UNIT Space, `READY`, rooms and
floor empty). No occupancy column. No הצמדה pairing. No stub Asset on an elevator.

The נכסים building page lists every Space grouped by kind (names only is enough; vacancy is #150).
First mint writes one batch audit line (who, when, counts, ranges), not per-Space promotion events.

Write through the existing estate importer / unit upsert so identity keys stay in one writer.
Permission: list is `estate.read`; create and mint are `estate.write`. Re-post of the same address
updates that Building, never a second one.

This is step 2 of [#147](0147-nekasim-building-inventory.md). Parallel with #148. Click the rail,
create, and the grouped list after a `dev` restart.

## Acceptance criteria

- [x] Signed-in chrome has נכסים; בניינים still works and its screens are unchanged
- [x] An admin creates a Building from נכסים with identity fields and the four counts; Units < 1
      refuses; zero parking / storage / elevators is allowed
- [x] The mint writes the named Spaces (and Unit rows for UNIT); names are bare integers from the
      first number; elevators are TECHNICAL `1`…`N`
- [x] The נכסים building page shows those Spaces grouped by kind
- [x] One audit batch line records the mint; `estate_event` is not used for it
- [x] Viewer cannot post; existing imported buildings appear under נכסים with whatever Spaces they
      already have
- [x] Specs (`SPEC-estate.md`, `SPEC-flows.md`) updated in the same change; path clicked after a
      `dev` restart

## Blocked by

None (can start immediately).

## Comment — 2026-09-22

Shipped. Rail item נכסים at `/estate/inventory`; create+mint through `importEstate`; grouped Space
list; one `estate.inventory_mint` audit line. בניינים routes and views untouched. `npm test` green.
Dev restarted on `:3000`; the live click stopped at Google login, so the path is proved by the
HTTP suite (`src/estate/inventory.test.ts`) rather than a signed-in browser walk.
