---
number: 112
title: "Required retrieval bound"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: []
parent: 111
created: 2026-09-16
closed: 2026-09-16
---

## Parent

#111 — Office retrieval on the Unit: bound search, cited answers, persisted thread.

## What to build

Every passage search names a **retrieval bound**. There is no default and no whole-store search by
omission.

A Unit bound returns only Passages from Documents linked to that Unit. A Passage that belongs to
another Unit does not appear, even if it is nearer in embedding space. Existing rent and deposit
rank cases stay green by naming an explicit portfolio bound — the same command, a wider filter —
not by leaving the bound off.

Administrator stance still returns the paper as printed (names, amounts, identifiers) for every
staff role that may read Documents. Tenant stance still masks identifier-shaped runs and does not
rewrite the store. A Building or portfolio bound asked with tenant stance fails closed.

This is the search half of office retrieval. There is no panel and no thread yet.

## Acceptance criteria

- [x] `searchPassages` requires a bound; omitting it is a type/command error, proven by a policy case that was red first
- [x] A Unit bound returns only Passages of Documents linked to that Unit (UNIT link, or TENANCY link whose tenancy’s unit is that Unit)
- [x] A golden retrieval case: a neighbour Unit’s answering Passage is not in the result set
- [x] Existing rent and deposit rank cases remain green against an explicit portfolio bound
- [x] Administrator stance returns identifiers as printed; tenant stance masks on the read; stored Passages unchanged
- [x] Building or portfolio bound + tenant stance is refused at the command
- [x] No assertion on distance; full golden set runs on this change
- [x] `SPEC-evidence.md` records the bound in the same change (glossary already names it)

## Blocked by

None (can start immediately).

## Comment — 2026-09-16

Closed. `searchPassages` takes a required retrieval bound (Unit, Building, or portfolio). Omitting it is `invalid`. Tenant stance on a Building or portfolio bound is `not_allowed`. A Unit bound is the UNIT link or a TENANCY link whose tenancy's unit is that Unit; a neighbour's nearer Passage is absent from that bag. Rent and deposit rank cases name an explicit portfolio bound. Golden case `neighbour-unit-absent`. Policy case written red first in `tests/policy/retrieval-bound.test.ts`.
