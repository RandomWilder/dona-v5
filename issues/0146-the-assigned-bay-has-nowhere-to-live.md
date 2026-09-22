---
number: 146
title: "The assigned bay has nowhere to live"
status: closed
labels: []
assignee: cursor
blocked_by: [141]
parent: 142
created: 2026-09-22
closed: 2026-09-22
---

## What to build

A bay is two facts. The **built bay** (`unit.parking_space_id`) is what the plan attached to the
flat: it survives vacancy and is what a gate motor hangs off. The **assigned bay** is where this
household parks, reassignable at will with no amendment and no new document. Today only the built
bay exists, so promoting a lease's bay number onto the unit would write a tenancy fact onto an
estate row that outlives the letting — the same class of error as `current_tenant`.

Add nullable `tenancy.parking_space_id` pointing at a `PARKING` space. Log a move under a new
`tenancy_event` kind `reassigned`, which **must not** require a source document (`amended` cannot
hold this: that kind is constrained to name a document, and this act has none). The built bay does
not change when the household is moved.

**Only then** declare `parking_space_number` on the lease type. A declaration creates a capture, a
capture invites a promotion, and until the assigned bay exists there is no correct target. Promote
onto the assigned bay, never onto the built bay.

Plan mode — schema on tenancy, a new event kind, then a seed row. Click the path that records a
reassignment. Re-measure: the two fixture `parking_space_number` values should now score, and the
track A residual should be the three keys named out of scope on #142.

This is step 6 of [#142](0142-track-a-the-place-a-fact-is-true-of.md), last on purpose.

## Acceptance criteria

- [x] `tenancy.parking_space_id` exists, nullable, constrained to a `PARKING` space
- [x] A reassignment appends `reassigned` with no source document; `unit.parking_space_id` is
      unchanged
- [x] `amended` still requires a document
- [x] `parking_space_number` is declared only after the column exists, and promotion lands on the
      assigned bay
- [x] The fourteen track-A residual values are scored; the three out-of-scope keys remain out of
      scope
- [x] Specs (`SPEC-tenancy.md`, `SPEC-evidence.md`, `CONTEXT.md` already has the two terms) updated
      in the same change

## Related

[#142](0142-track-a-the-place-a-fact-is-true-of.md) acceptance lines 3 and 8.
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md)
§3. Blocked by #141 so a promotion of the new declaration meets an estate/tenancy occupancy rule
and a log that already exists.

## Closed

`0039_assigned_bay.sql`: nullable `tenancy.parking_space_id` constrained to `PARKING`;
`tenancy_event` kind `reassigned` with no document. Operator reassignment leaves the built bay.
`parking_space_number` declared `SCHEMA_V6` and promotes onto the assigned bay. Occupancy is the
column: a later copy of the paper after a move refuses unless superseded. Golden set
`gpt-5.6-luna` / `reasoning: medium`: required 14/14 (parking 594 and 574 scored); 3 fixture
values undeclared (`security_structure`, `index_base_month`, `index_publication_date`). One keyed
run this ticket (eight-run range already on #144). Reassignment clicked on `:3000`: 302, assigned
moved, built unchanged, `reassigned` with no paper.

## Comment — 2026-09-22

Closed as above. Track A children are all closed. Pointer on the map:
[issues/0142-track-a-the-place-a-fact-is-true-of.md](0142-track-a-the-place-a-fact-is-true-of.md).

