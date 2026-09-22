---
number: 141
title: "An estate promotion has nowhere to record old → new"
status: open
labels: [needs-design]
assignee:
blocked_by: [140]
parent: 142
created: 2026-09-22
closed:
---

## What is wrong

This is a defect that does not exist yet, filed so it is not discovered late. **It must not be built
before the estate promotion family it belongs to, and it must not be forgotten when that family is
built.**

Promotion onto a tenancy column records itself: `tenancy_event` is append-only, holds `old_value` and
`new_value`, names the actor, and every `amended` row names the document that caused it
(`src/kernel/migrations/0019_tenancy_event.sql:11`). **Estate has no counterpart.** `building`,
`space` and `unit` carry no history of any kind.

So the moment a promotion can write `unit.rooms` or `space.floor` — the track A proposal's step 5 —
an operator's typed value can be replaced by a model's reading of a lease and the only surviving
record is `extracted_field.promoted_to` / `promoted_at` on the evidence side. That answers *which
reading was promoted*. It does not answer *what my flat's room count used to be and who changed it*,
which is the question an operator actually asks, and it is answerable today for a tenancy and would
not be for a flat.

## Why not the two cheaper options

- **Reuse `tenancy_event`.** Wrong. A building or unit fact caused by a lease is not an event in the
  letting's life, and a table that answers two different questions answers neither when read.
- **Accept the evidence-side record as the whole log.** It is what step 5 would ship by default, and
  it is the reason this issue exists rather than a comment: the gap is invisible until someone needs
  the history and finds there is none.

## What to build

An `estate_event` table mirroring `tenancy_event`'s shape and its append-only trigger, keyed by the
entity the promotion wrote — `building_id` or `unit_id` — and written by estate's
`applyPromotedField`, the second function under the seam `applyProtocolSeed` already establishes.
Evidence issues no estate SQL and must not start.

Open at filing time, and these are the design questions this ticket carries:

- One table with an entity-type discriminator, or a table per entity. `document_link` already has the
  discriminator shape; a `CHECK` enum plus two nullable ids is the cheaper mirror of it.
- Whether a value an operator types on A11 or A13 also appends, or only a promotion does. If only a
  promotion does, the log says *a document changed this* and is silent about the typed original —
  which is exactly what makes the promotion's `old_value` the first record of a value nobody logged.
- Whether the register importer appends. `tenancy_event`'s answer was no, stated in `0019`'s header,
  and the same reasoning probably holds.

**This is DDL that step 5 needs and the track A proposal did not count.** Step 5 is a widened `target`
CHECK, a link-kind branch in `promote.ts`, an estate-side `applyPromotedField` — and this table.

## Acceptance criteria

- [ ] No estate column is writable by promotion without an append landing here
- [ ] The table is append-only by trigger, as `tenancy_event` is — not by convention
- [ ] `at` comes from the injected clock; no `DEFAULT now()` anywhere, per `0004_estate.sql`'s rule
- [ ] The three open questions above are answered on this issue with reasons before any DDL is written

## Related

`src/kernel/migrations/0019_tenancy_event.sql`, `src/evidence/internal/promote.ts`,
`src/estate/` (`applyProtocolSeed`, the seam this extends).
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md) §6
and its step 5. Blocked by #140 only in the sense that nothing in track A starts before it.
