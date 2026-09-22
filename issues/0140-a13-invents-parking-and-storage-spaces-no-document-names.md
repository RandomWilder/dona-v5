---
number: 140
title: "A13 invents parking and storage spaces that no document names"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 142
created: 2026-09-22
closed:
---

## What is wrong

`upsertUnitRow` creates, for every unit the A13 screen makes, a `PARKING` space named
`חניה {unit_number}` and a `STORAGE` space named `מחסן {unit_number}`
(`src/estate/internal/importer.ts:411`). The naming is the function's own: the register importer
passes explicit `parkingSpaceName` and `storageSpaceName` and never reaches this path, so the defect
is bounded to units created through A13 — and it is silent, which is worse than bounded.

Against the two hand-read specimens in `evals/fixtures/lease-extraction.ts`, in the same building, in
the same month:

| Flat | Placeholder created | The plan's actual bay | The plan's actual storage |
|---|---|---|---|
| 206-4 (`pinchot`) | `חניה 4`, `מחסן 4` | **594** | **unnumbered** — `מחסן צמוד מהמרפסת, כמסומן בתכניות` |
| 206-7 (`bloch`) | `חניה 7`, `מחסן 7` | **574** | **601** |

Three separate errors in one function:

1. **The names are wrong.** Bay numbering is a property of the developer's plan and is unrelated to
   the door number. Nothing will ever reconcile `חניה 7` with bay 574 except a person noticing.
2. **The storage space is created unconditionally.** `pinchot`'s flat gets a numbered storage room
   invented for a storage room that has no number, and a flat with no storage at all gets one anyway.
   `UnitRowSpec` carries no `hasStorage` field, so the screen cannot say otherwise even if the
   operator knows.
3. **`space` is keyed `(building_id, space_kind, name)`** (`0005_estate_natural_keys.sql:50`), and
   SPEC-estate already warns that two writers spelling a name two ways are two apartments behind one
   door. This function is the second writer, and it spells bay names in a scheme no document uses.

## Why it blocks more than itself

The track A proposal argues that `has_storage` should never be a column because
`unit.storage_space_id IS NOT NULL` already answers it exactly. That derivation is unsound while this
defect stands: every A13 unit has a storage space, so the derived value is a constant rather than a
fact. **This ticket is a prerequisite for that argument**, not merely adjacent to it.

## What to build

**The fix is not "name them better".** Inventing a placeholder to satisfy a nullable foreign key is
the root of it, and the key does not need satisfying: `MATCH SIMPLE` leaves `parking_space_id` and
`storage_space_id` unenforced while null, and *unassigned* is described in `0004_estate.sql` itself as
the ordinary state.

1. `upsertUnitRow` creates the `UNIT` space and nothing else. Both foreign keys are left null.
2. A13 gains optional bay-number and storage-number inputs. Given a number, the space is created with
   the number the plan prints and the unit points at it; left empty, nothing is created.
3. An operator action that detaches and deletes an **unreferenced** placeholder space. There is no
   route today that edits or deletes a `space` — the only `DELETE FROM space` outside tests is the
   building purge (`src/estate/internal/purge.ts:604`) — so without this, the rows already written have
   no forward path and a real bay number arriving later produces a *second* `PARKING` space in the
   building with no way to tell which is real.

**No backfill.** Rows already written stay until an operator removes them through (3). This is
deliberate: the cleanup is an operator judgement about which space is real, not something a migration
can decide.

The delete in (3) must be narrow and must refuse rather than cascade: `PARKING` and `STORAGE` kinds
only, no `unit` referencing it, no asset in it, no service call against it.

## Acceptance criteria

- [ ] A unit created through A13 with no numbers given has `parking_space_id` and `storage_space_id`
      null and has created no `PARKING` or `STORAGE` space
- [ ] A unit created with a bay number given has a `PARKING` space named with that number
- [ ] The register import path is unchanged — its explicit names still win
- [ ] An unreferenced placeholder space can be deleted by an operator; one that is referenced by a
      unit, an asset or a service call is refused, and the refusal says which
- [ ] `src/estate/schema.test.ts` and the A13 route tests cover the no-numbers case, which is the one
      that corrupts data today
- [ ] The screen is clicked on `:3000` after a `npm run dev` restart, both paths

## Related

`src/estate/internal/importer.ts:411`, `src/kernel/migrations/0005_estate_natural_keys.sql:50`,
`src/estate/internal/purge.ts:604`, `evals/fixtures/lease-extraction.ts`.
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md) §4,
where this was found; it is step 1 of that proposal's order and depends on none of its open questions.
