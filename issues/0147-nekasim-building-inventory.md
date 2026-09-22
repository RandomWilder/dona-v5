---
number: 147
title: "נכסים — building inventory, minted before paper"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-22
closed:
---

## Problem Statement

An admin cannot see what a building is *made of* — only what has already been typed or imported, one
flat at a time. Vacant Units and vacant parking in a building are unanswerable unless every Space of
that kind already exists. Creating a building today writes an empty shell; adding an apartment does
not mint the rest of the parking, storage, or elevators. Staging after Track A looked unchanged
because that track never shipped an inventory: it stopped inventing placeholder bays and taught
place facts where they are true.

The office still needs the denominator: how many Units, how many bays, how many storage rooms, how
many elevators, and which of the private ones are unassigned today. Paper should fill those rows, not
create them.

## Solution

Add a new ops-rail tab **נכסים**. All inventory work in this spec lives **only** there. The existing
**בניינים** tab, its routes, and its screens stay as they are. Retiring בניינים is a later decision,
after נכסים is accepted — not this spec.

Same Building, Space, Unit, and Tenancy tables. A Building minted under נכסים will also appear under
בניינים because the row is the same row. No shadow schema.

On first save an admin types the A11 identity fields plus four counts (Units ≥ 1; parking, storage,
and elevators may be 0). Units, parking, and storage each take a **first number**; names are the
bare integer sequence from that first number. Elevators are TECHNICAL Spaces named `1`…`N`. Each
minted Unit is a Unit row in `READY` condition with rooms and floor empty. Occupancy is not stored.
הצמדה (built bay / built storage) is not paired in this spec.

The נכסים building page lists every Space, grouped by kind, with headline counts and derived vacancy
chips. Later add uses the same count + first-number rule and refuses a name collision. Later remove
refuses if a letting, built link, Asset, or document still points at the Space. Shared places (lobby,
yard, stairs) are added later as kind + typed name, not as a fifth mandatory metric.

A lease still files against a Unit. Printed bay and storage numbers promote onto the **letting** as
assigned bay and **assigned storage**. No matching Space: that assignment stays unset; the rest of
approve may succeed; the lease does not mint. Built columns on the Unit are untouched. A12 may still
create one flat through today’s A11/A13 when the address or Unit is missing.

First mint writes **one** audit batch (who, when, counts, ranges). Later add or remove of a named
Space writes **one** line for that Space. Neither is mixed into document `estate_event` promotion.

## User Stories

1. As an admin, I want a נכסים tab beside בניינים, so that I can try inventory without changing the
   live buildings screens.
2. As an operator or viewer, I want בניינים to behave exactly as it does today, so that today’s
   building work is not a beta.
3. As an admin, I want to create a Building from נכסים with name, address, city, optional project,
   dates, status, and optional גוש / חלקה / מספר בניין, so that identity and inventory land together.
4. As an admin, I must enter how many Units, and that count must be at least one, so that a
   configured Building always has a leasable denominator.
5. As an admin, I may enter zero parking, zero storage, or zero elevators, so that a building without
   those kinds is still valid.
6. As an admin, I want a first number for Units, parking, and storage whenever that count is above
   zero, so that each Space has a bare numeric name the lease can match.
7. As an admin, I want elevators to need only a count, named `1` through `N` as TECHNICAL Spaces, so
   that I am not inventing a new Space kind.
8. As an admin, I want one save to mint all those Spaces (and a Unit row for every UNIT Space), so
   that the building is a complete set of places before any document arrives.
9. As an admin, I do not want occupancy or “empty” stored on those rows, so that vacancy cannot drift
   from live lettings.
10. As an admin, I do not want stub Assets on elevator Spaces, so that inspection still waits for
    real equipment paper.
11. As an admin, I do not want Units auto-paired to bays or storage on mint, so that הצמדה is not a
    guessed sequence.
12. As an admin, I want to open the Building under נכסים and see every Space grouped by kind, so that
    I can scan the inventory in one place.
13. As an admin, I want headline counts per kind plus vacant Units, vacant parking, and vacant
    storage, so that “how many empty flats / bays in this building?” is one glance.
14. As an admin, I want a vacancy chip on each Unit, parking, and storage row, and none on elevators
    or COMMON / EXTERIOR / TECHNICAL extras, so that the chip means assignment, not existence.
15. As an admin, I do not want rent or lease-end on this list, so that inventory is not mixed with
    the roll (חוזים מסתיימים stays the expiry list).
16. As an admin, I want a vacant Unit to mean no letting active today, so that the chip matches the
    occupancy already used on בניינים cards.
17. As an admin, I want a vacant parking Space to mean no assigned bay on a letting that counts
    today, so that a built-bay link does not hide an unassigned bay.
18. As an admin, I want a vacant storage Space to mean no assigned storage on a letting that counts
    today, so that storage vacancy is the same idea as parking.
19. As an admin, I want to add more Units, parking, storage, or elevators later with count + first
    number (elevators: count, continuing from existing names without collision), so that the
    denominator can grow without a second product.
20. As an admin, I want a colliding name to be refused, not overwritten, so that rooms, floor, and
    lettings already on that Space are safe.
21. As an admin, I want to remove a Space that nothing references, so that a mistyped count can be
    undone.
22. As an admin, I want remove to refuse and name the reason when a letting, built bay, built
    storage, Asset, or document still uses the Space, so that inventory delete cannot cascade
    tenancy truth.
23. As an admin, I want to add a lobby, yard, or stairs later by choosing a kind and typing a name,
    so that shared places join the same list without a mandatory count at create.
24. As an admin, I want first mint recorded as one audit batch naming the counts and number ranges,
    so that “who configured this building?” is one line, not seventy-two.
25. As an admin, I want a later add or remove of one named Space recorded as its own line, so that
    “who deleted bay 574?” is answerable.
26. As an admin, I do not want those lines written as document promotions, so that the promotion log
    stays “paper changed a typed column.”
27. As an operator, I want a lease that names a bay to assign that PARKING Space on the letting when
    the name exists in the Building, so that the household’s assigned bay is what the contract says.
28. As an operator, I want a lease that names a storage number to assign that STORAGE Space on the
    letting the same way, so that assigned storage is not stuck on the flat.
29. As an operator, I want a missing bay or storage name to leave that assignment unset and still
    allow the rest of approve, so that a bad inventory does not strand a valid lease.
30. As an operator, I do not want the lease to create a Space, so that paper never rebuilds the
    building.
31. As an operator, I do not want the lease to write built bay or built storage on the Unit, so that
    הצמדה survives vacancy and a second household does not overwrite the plan.
32. As an operator, I want filing against an unknown address or Unit to still offer today’s A11/A13
    create of one flat, so that extraction and intake are not blocked on נכסים being finished.
33. As an operator, I want extraction of `parking_space_number` and `storage_space_number` unchanged
    as captures, so that the golden set is not a new reading problem.
34. As an engineer, I want assigned storage to be a typed column deterministic code can read, so that
    vacancy chips and promote are not render-only guesses.
35. As a viewer, I want to read נכסים lists if I can already read estate, and I must not mint, add, or
    remove, so that inventory writes stay admin (`estate.write`).
36. As the office, I want Building identity re-posts under נכסים to update the same address key, not
    duplicate the Building, so that double-submit stays the importer’s guarantee.
37. As the office, I want existing imported buildings to appear under נכסים with whatever Spaces they
    already have, so that the tab is a view of the portfolio, not only of newly minted shells.

## Implementation Decisions

- **Surface.** New rail item נכסים. New estate screens and write routes for: portfolio list under
  that tab, create Building + mint, one Building inventory page, add Spaces, remove a Space, add a
  named shared Space. Chrome dest for the new tab. **No edits to בניינים routes or views** except
  adding the sibling nav item that every signed-in screen already shares.
- **Modules.** Estate owns mint, list, add, remove, headlines. Tenancy owns assigned storage (new
  nullable column on the letting, constrained to a STORAGE Space, same standing as assigned bay)
  and the promote/reassign write. Evidence changes only the promotion **target** of
  `storage_space_number` to that column (catalogue seed). Scope (or the existing tenancy “let
  today” injection estate already uses for the occupancy chip) answers which Units / assigned bays /
  assigned storage count today. Estate must not grow a second `today` predicate.
- **Reuse.** Mint builds a plan and writes through the existing estate importer / unit upsert, the
  same natural keys as A11/A13. No second SQL writer of `space` identity. UNIT Space name = the
  integer as text, matching register/A13 bare `unit_number`. PARKING and STORAGE names = that
  integer as text. TECHNICAL elevator names = `1`…`N` as text.
- **Schema.** One new letting column: assigned storage. Composite FK to STORAGE, nullable, MATCH
  SIMPLE. Reassignment of assigned storage follows assigned bay: log `reassigned` with no document
  when an admin moves it; promote from an approved reading logs `amended` with the document. Built
  `unit.storage_space_id` unchanged by those writes.
- **Vacancy.** Unit vacant ⇔ not in the occupied-units set for today. Parking vacant ⇔ no letting
  that counts today holds it as assigned bay. Storage vacant ⇔ no letting that counts today holds it
  as assigned storage. Elevators and later COMMON / EXTERIOR / extra TECHNICAL: no vacancy chip.
- **Validation at the edge.** Units count integer ≥ 1. Other counts integer ≥ 0. First number
  required when that kind’s count > 0; parse as an integer; increment by 1, `count` times. Elevators:
  count only. Shared-space add: existing `space_kind` plus non-empty name. Remove: same refuse
  reasons already used when an unreferenced parking/storage Space is deleted, extended to UNIT and
  TECHNICAL for this tab’s remove only — still refuse, never cascade.
- **Permissions.** GET list/detail: `estate.read`. Create, mint, add, remove: `estate.write`
  (ADMIN), including the GET of those forms.
- **Audit.** Kernel `audit_log`: one `estate.inventory_mint` (or equivalent name) payload with
  building id, counts, and inclusive name ranges. Later add/remove: one line per Space id and name.
  Do not append `estate_event` for mint/add/remove. `estate_event` remains promotion-only.
- **A12.** Unchanged. Incomplete inventory from a one-flat create is accepted until someone mints
  the rest under נכסים.
- **SPEC files in the same change as the code they describe.** `SPEC-estate.md` (inventory mint,
  list, vacancy, add/remove, audit), `SPEC-flows.md` (new flow; A11/A13 text unamended except a
  pointer that נכסים exists beside them), `SPEC-tenancy.md` (assigned storage), `SPEC-evidence.md`
  (promotion target for `storage_space_number`). Glossary already names Elevator, built storage, and
  assigned storage.
- **Catalogue.** Declaring the new promotion target is a `seed:doctypes` concern, not a Cloud Run
  migrate-only deploy. Staging will not assign storage from a lease until that seed runs, same
  standing as parking after #146.

## Testing Decisions

Tests assert observable behaviour: HTTP of נכסים, rows that exist after a post, chips and headlines
on the response, refusals, and promote/reassign of assigned storage. They do not assert helper
names or HTML structure beyond what an admin would rely on (labels, counts, missing invented
Spaces).

**Two seams, both existing shapes — do not add a third.**

1. **נכסים HTTP** (same class as today’s A11/A13 estate route tests). One building created with
   counts; assert Space/Unit rows and names; list and detail show grouped inventory and vacancy
   headlines; add/remove/collision/refuse; viewer cannot post; בניינים create and apartment screens
   still match their current assertions (regression: those tests stay green without rewriting the
   בניינים views). Rail contains נכסים and still contains בניינים.
2. **Assigned storage** (same class as assigned-bay promote and reassign tests). Promote
   `storage_space_number` onto the letting, never onto `unit.storage_space_id`; missing name refuses
   that write only; reassign without a document; vacancy chip follows the letting not the built
   link.

Policy: if assigned storage is occupied, a second promote without supersede refuses and names the
value — same rule as assigned bay. Red policy case first.

Do not re-run the eight keyed golden set unless the extractor prompt or declared lease keys change.
This spec must not change the prompt; it only retargets an already-declared key. One keyed run after
the seed, recorded on this issue, is enough to show storage scores and still promotes; ranges stay
where #142 left them unless that run breaks a floor.

Prior art: estate route tests for A11/A13 and placeholder remove; tenancy reassign and promote bay;
chrome/nav assertions on signed-in screens; occupancy chip tests that inject occupied ids rather
than embedding `today`.

## Out of Scope

- Changing or retiring בניינים screens, copy, or A11/A13 behaviour.
- Shadow tables or a second Building identity.
- Stored occupancy / empty / active on Space.
- הצמדה pairing UI; writing built bay or built storage from a lease.
- Minting Spaces from a lease; blocking approve when a bay/storage name is missing.
- Pasted irregular names (`206-4`, `12A`); integer sequence only.
- New Space kind `ELEVATOR`.
- Stub Assets on mint.
- Stub `estate_event` rows per minted Space on first save.
- Rent, expiry, or under-8K filters on the inventory list (roll stays elsewhere).
- Rename-in-place of a Space.
- Backfill of invented `חניה {n}` rows; fix forward.
- Tenant-facing נכסים; operator mint.
- Prod. Indexation / security annex / #125 place paper.

## Further Notes

Grilled 2026-09-22. Director: נכסים only until that tab is good enough to replace בניינים.

This file is the track map. `/to-tickets` should split children (tab + mint, inventory page +
vacancy, add/remove + shared name, assigned storage + promote). Do not implement the whole file in
one session.

**Seams to confirm:** (1) נכסים HTTP, (2) assigned-storage promote/reassign. No new in-process
harness.

## Comment — 2026-09-22

Published from the inventory grill. בניינים explicitly untouched; same tables; assigned storage is
the one schema add; mint audit is a batch; later add/remove is per Space on `audit_log`.
