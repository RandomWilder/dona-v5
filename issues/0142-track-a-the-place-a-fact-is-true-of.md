---
number: 142
title: "Track A — the place a fact is true of"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-22
closed:
---

## Problem Statement

Track A was named on 21 September 2026 in one clause inside another proposal's out-of-scope section —
*"Track A (the Building declaration, and pre-created spaces)"* — and mentioned three more times, every
one a disclaimer. Track B had a full draft before a line of its code was written; track A had nine
words. The evidence arrived after the name did, and the shape underneath is different from and larger
than the clause describes.

`evals/fixtures/lease-extraction.ts` records 57 hand-keyed values across two leases. Track B's seed
rows closed fourteen of the undeclared ones. **Seventeen values across twelve keys remain undeclared,
and fourteen of them are this track** — facts about a building, a unit, a unit's space, and one that is
not a fact about a place at all. They are the last thing standing between the fixture and a fully
gradable reading.

Four things are wrong at once:

**A fact is at risk of being stored where it was printed rather than where it is true.** This is the
defect the track exists to prevent, and it is the same reasoning that kept `gush` off the lease type in
the first place, applied one turn further. A lease *recites* `gush`; it *establishes* nothing about the
land. The residual sits on three levels — building, unit-or-space, and the relationship between a unit
and a space — and the line between them is not visible in the document, where all of it is printed in
one paragraph on one page.

**The bay is modelled as the flat's, and the paper disagrees.** `unit.parking_space_id` says flat 7 has
bay 574. Both specimens say this *letting* has bay 574 for as long as the landlord does not move it,
and moving it requires no amendment and no new document. Promoting the lease's number onto the unit
would write a tenancy fact onto an estate row, where it outlives the tenancy that created it — the same
class of error as `current_tenant`, which foundation rule 1 forbids and a grep guard enforces.

**Every unit the A13 screen creates gets a parking bay and a storage room that no document names.**
Silent, bounded to A13, and corrupting on every use. → #140.

**Promotion cannot reach an estate column, and would have nowhere to record it if it could.** All five
promotion targets are `tenancy.*`; `promoteExtractedField` resolves its subject through a `TENANCY`
link only; and `building`, `space` and `unit` carry no history of any kind, so a promoted room count
would replace an operator's typed value with no log but the evidence-side stamp. → #141.

## Solution

`docs/proposals/track-a-the-place-a-fact-is-true-of.md` carries the full argument and has been
grilled — its §10 records twelve answered questions and what each one changed. Where it and a SPEC file
could be read as disagreeing, **the spec wins**; the proposal is not adopted into one yet, and adoption
happens one implementing ticket at a time, spec edit before code edit.

The bias is track B's, unchanged: a seed row rather than a migration, a derived value rather than a
column, a cross-check rather than a capture. **Four new columns in the whole track** — three nullable on
`building`, one nullable on `tenancy` — and four candidates argued down to nothing.

Two decisions are the spine:

**`gush` and `helka` are typed, not extracted.** The document that establishes them is a tabu extract
or a plan; neither is a document type here and nobody has yet looked at whether the corpus holds one.
Against tens of buildings, a new document type, a new declaration set, a second promotion family and a
second golden set to read five digits that never change is not proportionate. The lease's printed value
becomes a **cross-check** instead — a scorer assertion in `evals/`, never a refusal that blocks an
operator's approval on an OCR result. If a tabu extract turns out to be routinely filed, the typed
column becomes a promotion target and nothing already written is wrong.

**A bay is two facts.** The **built bay** (`unit.parking_space_id`) is what the plan attached to the
flat: it survives vacancy and is what a gate motor hangs off. The **assigned bay**
(`tenancy.parking_space_id`) is where this household parks, reassignable at will. Both terms are in
`CONTEXT.md`. The reassignment is logged under a new `tenancy_event` kind, because `amended` is
constrained to name a source document and this act has none.

And one that removes work rather than adding it: promotion onto an estate column needs **no provenance
column**. A non-null estate value is occupied whoever wrote it, the promotion refuses, and an operator
with the lease in front of them supersedes — which is #130's existing rule, unchanged, one level down.

## User Stories

1. As an operator creating a unit, I want no parking bay or storage room invented for it, so that the
   building's space list never shows two bays per flat with nothing to say which is real.
2. As the office, I want a building's parcel identifiers on the record, so that a lease filed against
   the wrong building can be caught by the number it prints.
3. As an engineer changing the reader, I want the fourteen residual values declared and scored, so that
   the fixture grades a whole reading instead of two thirds of one.
4. As an operator, I want a promotion that would change a value I typed to stop and ask me, so that a
   model's reading of a lease never silently replaces my flat's room count.
5. As an operator, I want to know what my flat's room count used to be and who changed it, the way I
   already can for a letting.
6. As the office, I want the bay a household parks in recorded against the letting, so that moving it
   does not rewrite what the flat was built with and does not reach the next household's screen.

## Acceptance

What "track A is done" is tested against. Each line is end-to-end, not a layer.

- [ ] A unit created through A13 with no numbers given creates no `PARKING` or `STORAGE` space, and an
      unreferenced placeholder can be removed by an operator (#140)
- [ ] `building` carries `gush`, `helka` and `building_number`, filled on A11, none of them unique
- [ ] The fourteen residual values are declared and scored; the residual count falls from seventeen to
      three, and those three are named as out of scope
- [ ] A `helka` cross-check passes on `43,46` and on `46,43`, and fails on `43,47`
- [ ] A cross-check failure does not block an operator from approving the reading
- [ ] A promotion onto a non-null estate column refuses, names the existing value, and succeeds when
      superseded — with a policy case that was **red first**
- [ ] Every estate column a promotion can write appends to a log naming the actor and the document
      (#141)
- [ ] A bay reassignment is recorded without a document, and `unit.parking_space_id` is unchanged by it
- [ ] The full golden set re-run, judged over at least **eight** keyed runs, comparing ranges rather
      than means

## Order

From the proposal's *Order of work*. Reversible first; the irreversible one after the reading that
depends on it has been measured.

1. #140 — the A13 placeholder defect. Unblocked, and a prerequisite for the `has_storage` argument.
2. The typed columns on `building`, filled on A11. One migration, three nullable columns.
3. Seed rows for `rooms`, `floor`, `gush`, `helka`, `building_number` — **cross-checks only**, no
   promotion targets, no DDL. Re-measure.
4. The occupancy rule one level down, red first as a policy case. Spec edit and a test, no schema.
5. The estate promotion family — `target` CHECK widened, the link-kind branch, estate's
   `applyPromotedField`, and `estate_event` (#141).
6. The bay — `tenancy.parking_space_id`, the `reassigned` event kind, and only then
   `parking_space_number` declared on the lease type.

## Out of scope

`security_structure` (a second document type bound into one PDF under one `file_hash` — a real intake
defect, not a place fact), `index_base_month` and `index_publication_date` (indexation terms of the
letting, track B's furniture), #125 (who may read a place document — adjacent, and about reading rather
than storage), and the obligation and compliance regimes hanging off `asset`.

## Related

[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md)
— the grilled draft this is folded from. `evals/fixtures/lease-extraction.ts` is the ground truth and
already covers every value in the track. #136 is track B, closed, and the machinery this extends.
