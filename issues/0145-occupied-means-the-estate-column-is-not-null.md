---
number: 145
title: "Occupied, one level down, means the estate column is not null"
status: closed
labels: []
assignee: cursor
blocked_by: [144]
parent: 142
created: 2026-09-22
closed: 2026-09-22
---

## What to build

#130's occupancy rule does not survive the move to estate columns. On a tenancy, occupancy is a stamp
from a *different* extracted field, not a register date — because the register writes dates without a
document and treating those as occupants would make the ordinary case an error.

`unit.rooms` is `NOT NULL`. Every unit has a value, written by A13 or the register, with no
`extracted_field` behind it. A promotion that still looks for a stamp would find none and silently
overwrite an operator's typed room count with a model's reading of a lease. `space.floor` is
nullable but written by the same two hands, and has the same problem whenever it is set.

**Settled: no provenance column.** A non-null estate column is occupied, whoever wrote it. A
promotion onto it refuses and names the existing value. An operator with the lease in front of them
may `supersede`, and that is the record of who decided. Tenancy occupancy is unchanged.

**Spec edit and a test, no schema.** Do not widen `field_promotion.target` — that is #141. Prove the
estate occupancy definition **red first** (policy case, or a seam test if promote cannot yet reach an
estate column). #141 must consume this definition rather than re-deriving it.

This is step 4 of [#142](0142-track-a-the-place-a-fact-is-true-of.md). #130's ordering, reused: build
the refusal while the gap is still survivable.

## Acceptance criteria

- [x] A case asserting the estate occupancy rule is written and observed failing before any
      implementation
- [x] Spec states: a non-null estate column is occupied whoever wrote it; tenancy occupancy is
      unchanged
- [x] No migration. `field_promotion.target` is not widened
- [x] Superseding remains the explicit overwrite
- [x] `npm run test:policy` is green (or the seam test is, if that is the honest place)

## Related

[#142](0142-track-a-the-place-a-fact-is-true-of.md) acceptance line 6. #130 (closed) is the tenancy
rule this amends one level down.
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md)
§7. Blocked by #144 so the irreversible promotion family still waits on a measured reading.

## Closed

No migration. `field_promotion.target` untouched. Tenancy occupancy (#130) unchanged.

Estate occupancy is `occupantOfEstateColumn`: a typed `unit.rooms` is occupied whoever wrote it; a
`space.floor` is occupied only when set. #141 consumes that definition.

**Red first.** `tests/policy/estate-column-occupied.test.ts` failed on a missing export before the
function existed (`does not provide an export named 'occupantOfEstateColumn'`).

## Comment — 2026-09-22

Closed as above. Map #142 frontier becomes #141 (`needs-design` — answer its three questions before DDL).
