---
number: 124
title: "Tenant stance needs a Tenancy bound"
status: closed
labels: [ready-for-agent]
assignee: claude
blocked_by: []
parent: null
created: 2026-09-21
closed: 2026-09-21
---

## What is wrong

`searchPassages` permits tenant stance on a Unit bound, and a Unit bound is wider than one
household. It matches a Document two ways: through a `UNIT` link, or through **any** `TENANCY` of
that Unit — every household the flat has ever had. That width is correct for the office, which is
why #112 built it. It is wrong the moment the asker is a tenant.

Masking does not close it. `maskIdentifierRuns` hides identifier-shaped runs; it does not hide a
previous tenant's name, their rent, their deposit or their dates. A tenant asking a plain question
about their own flat would be answered out of the previous household's lease, with the amounts as
printed.

The defect is **latent, not live**. The only production caller of `searchPassages` is the office
turn, whose stance is `'administrator'` and is not a parameter a caller may omit or swap. Tenant
stance is reached today only from tests. `SPEC-evidence.md` says so outright: there is no
tenant-facing surface on this command yet. This issue closes the door before the room is built,
because the tenancy card that Track B ends in is the room.

## What to build

A fourth retrieval bound, `{ kind: 'tenancy'; id }`, matching Passages of Documents linked to that
one Tenancy and to nothing else. Tenant stance requires it. `unit`, `building` and `portfolio`
become administrator-only.

The Tenancy and not a narrowed Unit, because a flat outlives its households and a Tenancy **is** the
household. The same reasoning that makes a Tenancy the row a lease creates makes it the row a
tenant's isolation is drawn around. A Unit bound narrowed for the tenant would still be a Unit bound
that happens to be filtered, and the next reader of the code would widen it back.

The first cut is strict: `TENANCY` links only. A tenant does not see `UNIT`-linked place paper for
their own flat — an inspection report, a handover protocol — even during their own term. That is a
real question and it is deferred on purpose: widening a bag later costs a filter, and narrowing one
after a tenant has read something costs more than that.

The office turn does not accept a Tenancy bound. `OfficeRetrievalBound` is already the narrower of
the two types, so the compiler names every place that has to decide; the conversion refuses a
Tenancy bound with `not_allowed` rather than silently widening it to the Unit.

## Acceptance criteria

- [x] `RetrievalBound` gains `{ kind: 'tenancy'; id }`, validated like the other id-carrying kinds
- [x] A Tenancy bound returns only Passages of Documents carrying a `TENANCY` link to that Tenancy
- [x] Tenant stance on a `unit`, `building` or `portfolio` bound is `not_allowed`
- [x] Administrator stance may still use all four kinds; the Unit bound keeps its #112 width
- [x] A policy case, red first: the previous household's lease on the same Unit is absent from the current Tenancy's bag
- [x] A policy case, red first: tenant stance on a Unit bound is refused
- [x] The office turn refuses a Tenancy bound rather than converting it
- [x] `SPEC-evidence.md` records the fourth bound and the narrowed tenant rule in the same change
- [x] `CONTEXT.md` glossary names the Tenancy bound
- [x] Full golden set runs; no assertion on distance

## Blocked by

None.

## Comment — 2026-09-21

Closed. `RetrievalBound` has a fourth kind, `{ kind: 'tenancy'; id }`, matching Passages of
Documents that carry a `TENANCY` link to that one Tenancy and nothing else — not the `UNIT` link the
same lease also carries, and not a sibling Tenancy of the same flat. Tenant stance may ask nothing
wider: `unit`, `building` and `portfolio` are all `not_allowed` for a tenant. Administrator stance
keeps all four, and the Unit bound keeps the #112 width it was built with.

The office turn refuses a Tenancy bound at `asOfficeBound` rather than widening it to the Unit. That
seam was free: `OfficeRetrievalBound` is already the narrower of the two types, so the compiler
named the one place that had to decide.

Two policy cases written red first in `tests/policy/retrieval-bound.test.ts` — tenant stance on a
Unit bound is refused, and the previous household's lease on the same flat is absent from the
current Tenancy's bag. Both were red for the right reasons: no `tenancy` kind in the source, and the
previous lease present in the result set. Two existing tenant-stance cases in
`src/evidence/search.test.ts` moved to a Tenancy bound, which is the proof a tenant can still read
their own lease with the identifiers masked.

No migration. `document_link` already carries `TENANCY`.

**The golden set ran and did not fail: 5 of 10 passed, 5 skipped, 0 failed.** The five skips are the
retrieval-ranking cases, which `evals/corpus.ts` skips without an `OPENAI_API_KEY` — including
`neighbour-unit-absent`, the case nearest this change. They were not graded here. A bound change is
retrieval configuration, so the five want a keyed run before this behaviour reaches a tenant route.
There is no tenant route yet, which is why the door was closed before the room was built.

## Comment — 2026-09-21, the keyed run

The run above wanted a key and has now had one. Against the real provider — 86 passages indexed
through `openai:text-embedding-3-large@1536`, and the behavioural cases answered by the office turn
rather than by the harness stub — the golden set is **10 of 10 passed, 0 failed, 0 skipped**.
`neighbour-unit-absent`, the case nearest this change, is green on a graded run and not on a skipped
one. The caveat this comment was left open for is discharged.

Two things the earlier paragraph got wrong, recorded here rather than silently corrected. The five
that "passed" unkeyed passed against `placeholderSubject`, a stub returning fixed strings, so the
honest count for an unkeyed run is not five graded and five skipped — it is nothing graded at all.
And the local golden set has no equivalent of CI's `REQUIRE_EMBEDDINGS=1`: absent a key it reports a
pass count instead of saying it measured nothing. That is a defect in the harness rather than in
this change, and it belongs in an issue of its own.
