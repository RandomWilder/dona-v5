---
number: 151
title: "נכסים — add, remove, and shared spaces"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [149]
parent: 147
created: 2026-09-22
closed: 2026-09-22
---

## Parent

[#147](0147-nekasim-building-inventory.md)

## What to build

After a Building exists under נכסים, an admin may grow or shrink the inventory. Add uses the same
rule as mint: kind + count + first number (elevators: count only, names that do not collide). A
name that already exists for that kind in the Building refuses; it does not overwrite rooms, floor,
or lettings.

Remove of one Space refuses rather than cascades when a letting, built bay, built storage, Asset, or
document still points at it, and names why. An unreferenced Space may be deleted. Each later add or
remove writes one audit line for that Space, not a document promotion.

Shared places (lobby, yard, stairs) are added as an existing kind (COMMON, EXTERIOR, or TECHNICAL)
plus a typed name — not a fifth mandatory count at create.

Admin only (`estate.write`). No rename-in-place.

This is step 4 of [#147](0147-nekasim-building-inventory.md). Click add, collision, shared name, and
a refused remove after a `dev` restart. Does not wait on vacancy (#150).

## Acceptance criteria

- [x] Add with count + first number mints new named Spaces; collision refuses without overwrite
- [x] Elevator add continues TECHNICAL names without colliding with `1`…`N` already there
- [x] Remove of an unreferenced Space deletes it; a referenced one refuses and names the reason
- [x] Kind + typed name adds a shared Space onto the same grouped list
- [x] Each later add/remove has one audit line per Space; `estate_event` is unused
- [x] Specs updated in the same change; path clicked after a `dev` restart

## Blocked by

- [#149](0149-nekasim-tab-create-and-mint.md)

## Comment — 2026-09-22

Shipped. Later add on `/estate/inventory/:buildingId` uses count + first number (elevators continue
TECHNICAL integer names). Collision is `conflict` and does not overwrite. Shared add is kind + typed
name. Remove deletes an unreferenced Space; a letting, built bay/storage, Asset, or document
refuses and names why. One `estate.inventory_add` / `estate.inventory_remove` line per Space, not
`estate_event`. Specs updated. `npm test` and typecheck green. Dev restarted on `:3000`; opened
נכסים → בניין מלאות and saw הוספת חללים, מקום משותף, and הסרה. Add/collision/shared/refused-remove
writes proved by `src/estate/inventory.test.ts` (live POST click stopped after the network cut).
Parent [#147](0147-nekasim-building-inventory.md) stays open as the track map.
