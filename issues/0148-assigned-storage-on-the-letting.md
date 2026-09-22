---
number: 148
title: "Assigned storage belongs on the letting"
status: closed
labels: []
assignee: cursor
blocked_by: []
parent: 147
created: 2026-09-22
closed: 2026-09-22
---

## Parent

[#147](0147-nekasim-building-inventory.md)

## What to build

Storage is two facts, like a bay. Built storage stays on the Unit. **Assigned storage** is the
STORAGE Space this household uses; it belongs on the letting, and the landlord may move it with no
amendment and no new document.

`storage_space_number` is already extracted. It is a reading, not a promotion onto the Unit. Give it
a correct target: a nullable assigned-storage column on the letting, constrained to a STORAGE Space.
Promote onto that column, never onto built storage. A printed number that matches no STORAGE Space
in the Building refuses that write only — approve of the rest may succeed; the lease does not mint a
Space.

Reassignment without paper uses the same `reassigned` kind as the assigned bay (no source document).
A document-caused promote remains `amended`. Occupied means the column is not null: a second copy
refuses and names the value unless superseded.

Plan mode — schema on tenancy, then the seed that retargets the declaration. Click promote and
reassign. One keyed eval run after the catalogue seed, recorded here; do not change the extractor
prompt; do not rerun eight keyed ranges unless a floor breaks.

This is step 1 of [#147](0147-nekasim-building-inventory.md). It can start immediately, in parallel
with #149. Vacancy chips for storage (#150) wait on this column.

## Acceptance criteria

- [x] The letting carries a nullable assigned-storage column constrained to a STORAGE Space
- [x] Promote of `storage_space_number` lands on the letting, never on the Unit's built storage
- [x] A name that is not a STORAGE Space in this Building refuses that promote only
- [x] Reassignment appends `reassigned` with no source document; built storage is unchanged
- [x] A later promote onto an occupied assigned-storage column refuses and names the value unless
      superseded (policy case red first)
- [x] Specs (`SPEC-tenancy.md`, `SPEC-evidence.md`; glossary already has assigned storage) updated in
      the same change; path clicked after a `dev` restart

## Blocked by

None (can start immediately).

## Closed

`0040_assigned_storage.sql`: nullable `tenancy.storage_space_id` constrained to `STORAGE`.
`storage_space_number` retargeted onto that column by `seed:doctypes` (not the extractor prompt).
Promote never writes built storage. A missing STORAGE name refuses that copy; the rest of approve
still may. Occupancy is the column: a later copy after a move refuses unless superseded. Golden set
`gpt-5.6-luna` / `reasoning: medium`: required 14/14, optional 43/46, 2 contradictions, 3
undeclared; storage scored (credited absence on pinchot, `601` on bloch). One keyed run this ticket.
Reassignment clicked on `:3000` after a `dev` restart: 302, assigned moved, built unchanged,
`reassigned` with no paper.

## Comment — 2026-09-22

Closed as above. Step 1 of [#147](0147-nekasim-building-inventory.md). Vacancy chips wait on #150.
