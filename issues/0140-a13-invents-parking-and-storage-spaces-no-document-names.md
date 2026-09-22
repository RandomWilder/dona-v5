---
number: 140
title: "A13 invents parking and storage spaces that no document names"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 142
created: 2026-09-22
closed: 2026-09-22
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

- [x] A unit created through A13 with no numbers given has `parking_space_id` and `storage_space_id`
      null and has created no `PARKING` or `STORAGE` space
- [x] A unit created with a bay number given has a `PARKING` space named with that number
- [x] The plan-shaped import path is unchanged — `importEstate` still takes the names off the plan
- [x] An unreferenced placeholder space can be deleted by an operator; one that is referenced by a
      unit or an asset is refused, and the refusal says which
- [x] `src/estate/schema.test.ts` and the A13 route tests cover the no-numbers case, which is the one
      that corrupts data today
- [x] The screen is clicked on `:3000` after a `npm run dev` restart, both paths

## Related

`src/estate/internal/importer.ts:411`, `src/kernel/migrations/0005_estate_natural_keys.sql:50`,
`src/estate/internal/purge.ts:604`, `evals/fixtures/lease-extraction.ts`.
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md) §4,
where this was found; it is step 1 of that proposal's order and depends on none of its open questions.

## Closed

Three changes, in `src/estate/`, plus a type that propagates to two callers.

1. **`upsertUnitRow` names no space its caller did not name.** `UnitRowSpec.unit` is a whole
   `UnitPlan` now rather than a `UnitPlan` with the two bay names omitted, so the names are always
   the caller's and null writes nothing. `UnitRowResult.inserted.parking` and `.storage` are
   `boolean | null` on the same footing as `.project`; `src/register/`’s `record` already skipped a
   null, so that module needed no code change beyond passing the two nulls explicitly.
2. **A13 asks for the two numbers, optionally.** `parking_space_name` and `storage_space_name`, text
   and not number (a bay is printed `594` in one plan and `12/ב` in the next), blank-to-null through
   the same `blankToNull` the floor input uses. What the operator types is the Space's name.
3. **`POST /estate/spaces/:spaceId/remove`** (`internal/spaces.ts`), behind `estate.write`. It
   detaches the one unit pointing at the Space and deletes it in one transaction, and refuses rather
   than cascading: an asset in it, or two units assigned to it, is a `conflict` naming which.

**Two corrections to this ticket as written.**

- *"the register importer passes explicit `parkingSpaceName` and `storageSpaceName` and never
  reaches this path"* was wrong about the code. `UnitRowSpec` omitted both fields, so **every**
  caller of `upsertUnitRow` got the placeholders, the register CSV import included — the path with
  explicit names is `importEstate`, the plan-shaped one, and that is what is unchanged. So the fix's
  blast radius was wider than "bounded to A13": the nine-row register fixture’s space counts move
  **15/12 → 5/4**, one `UNIT` Space per line instead of three. This is right — the 22-column header
  names no bay — and `SPEC-register.md` now says so.
**A third correction, from `/code-review`.** The first cut keyed the remove on the unit — `POST
/estate/units/:unitId/spaces/:spaceId/remove` — and refused a space the flat did not point at. That
reading makes the criterion above impossible to satisfy: an *unreferenced* space was exactly the one
that could not be removed. It also left the ticket's own scenario open, because an operator who
writes the real bay number **before** deleting `חניה 7` repoints the flat and orphans the
placeholder, and the orphan was then unreachable forever — which of the two you got depended only on
the order you happened to work in. The route is keyed on the Space now, the building page grew a
`חניות ומחסנים ללא שיוך` section so an unassigned bay is visible at all, and one unit pointing at the
space is detached rather than refused (two is the `conflict`). `src/estate/routes.test.ts` covers the
orphan end to end: placeholder, correction, the section, the remove, the section gone.

- **The service-call refusal could not be written: there is no table.** `src/calls/` is unbuilt and
  `0004_estate.sql` has no `service_call`; the only two rows that reference `space` are `unit` and
  `asset`, and both are refused. `internal/spaces.ts` marks where the third `NOT EXISTS` goes.

No backfill, as specified. The rows 4.6 already wrote stay until an operator removes them through
(3) — `npm run seed` data included, which is why the Shoham plan’s 184 spaces are untouched.

Clicked on `:3000` after a `npm run dev` restart, both paths: a flat with both inputs blank wrote
one Space and no bay chips; a flat with `574` and `601` wrote three, showed both on the card, and
the חניה הסרה control took the bay off and left the store. Then the orphan
path, after a second restart for the review changes: `חניה 7`, corrected to `574`, the placeholder
appearing under `חניות ומחסנים ללא שיוך`, removed from there, and the section gone with its last
row.
