---
number: 141
title: "An estate promotion has nowhere to record old → new"
status: closed
labels: []
assignee: cursor
blocked_by: [144, 145]
parent: 142
created: 2026-09-22
closed: 2026-09-22
---

## What is wrong

This is a defect that does not exist yet, filed so it is not discovered late. **It is the estate
promotion family** (step 5 of #142). It must not be built before #144 and #145, and it must not be
forgotten when those close.

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

**This is the whole of step 5**, not only the table: a widened `target` CHECK (estate columns the
lease may establish — `unit.rooms`, `space.floor`; not `gush` / `helka` / `building_number`, which
stay typed), a link-kind branch in `promote.ts` (`UNIT` / `BUILDING` links already exist), estate's
`applyPromotedField` under the seam `applyProtocolSeed` already establishes, and `estate_event`.
Occupancy is #145's rule: a non-null estate column is occupied whoever wrote it.

**Session start:** answer the three questions on this issue, with reasons, then set `labels` to
`[ready-for-agent]`, then write DDL. Do not implement while the label is `needs-design`. Plan mode —
this is the irreversible schema change.

## Acceptance criteria

- [x] The three open questions above are answered on this issue with reasons before any DDL is written
- [x] No estate column is writable by promotion without an append landing here
- [x] The table is append-only by trigger, as `tenancy_event` is — not by convention
- [x] `at` comes from the injected clock; no `DEFAULT now()` anywhere, per `0004_estate.sql`'s rule
- [x] `unit.rooms` and `space.floor` are promotion targets; `gush` / `helka` / `building_number` are not
- [x] A `unit.*` target resolves through a `UNIT` link, a `building.*` target through `BUILDING`
- [x] Evidence issues no estate SQL
- [x] A promotion onto a non-null estate column refuses per #145 and succeeds when superseded

## Related

`src/kernel/migrations/0019_tenancy_event.sql`, `src/evidence/internal/promote.ts`,
`src/estate/` (`applyProtocolSeed`, the seam this extends).
[docs/proposals/track-a-the-place-a-fact-is-true-of.md](../docs/proposals/track-a-the-place-a-fact-is-true-of.md) §6
and its step 5. Blocked by #144 (the reading is measured) and #145 (the refusal exists).

## Comment — 2026-09-22

`blocked_by` was `[140]` at filing, meaning only that nothing in track A starts before the
placeholder defect. The children of #142 are now filed: this ticket is step 5, blocked by #144 and
#145, and it is the whole estate promotion family, not only the log table.

## Comment — 2026-09-22

The three design questions, answered before DDL:

**One table, discriminator, two nullable ids.** `estate_event` with `entity_type` in
`BUILDING | UNIT`, nullable `building_id` / `unit_id`, and a CHECK that exactly one id is set and
matches the type. Same shape as `document_link`. Not a table per entity. No `space_id`: this
ticket's writes are `unit.rooms` and `space.floor` on the unit's space (`unit_id` = `space_id`).

**Only a promotion appends.** A11, A13, and the register stay silent. Same rule as `tenancy_event`:
the log answers *a document changed this*. The typed original is `old_value` on that first
promotion row. Wiring every estate write is a second product and is out of scope.

**Register importer does not append.** Same reasoning as `0019_tenancy_event.sql`'s header.

## Closed

`0038_estate_event.sql`: append-only `estate_event`, no `DEFAULT now()`, XOR `BUILDING|UNIT` ids.
`field_promotion.target` admits `unit.rooms` and `space.floor` only. Estate `applyPromotedField`
writes the column and the log. `promoteExtractedField` resolves a `UNIT` link, consumes
`occupantOfEstateColumn`, and refuses a typed room count unless `supersede`. Policy case red first
(`listEstateEvents` missing, then the unmapped target), then green. A2 still does not auto-promote
rooms. Frontier of #142 becomes #146.

## Comment — 2026-09-22

Closed as above. Pointer on the map:
[issues/0142-track-a-the-place-a-fact-is-true-of.md](0142-track-a-the-place-a-fact-is-true-of.md).
