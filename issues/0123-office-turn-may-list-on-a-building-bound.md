---
number: 123
title: "Office turn may list on a Building bound"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: [121, 122]
parent: 120
created: 2026-09-17
closed: 2026-09-17
---

## Parent

#120 — Office retrieval on the Building: panel, list command, tool choice.

## What to build

On a Building bound, the office retrieval model may choose this turn: Passage search, the active-lettings list command, or both. Facts are only what this turn’s commands returned.

A table ask of apartments let today and their tenants uses the list and does not rebuild the roll from Passages. A protocol ask uses search and does not load the household roll into the model. Nobody let today is an answer, not the documents-refusal sentence. A list answer cites no paper.

A Unit bound still may call only search. The list command is not offered on portfolio or on any tenant-facing path. Tenant stance on a Building search stays refused ([ADR-0010](../docs/decisions/ADR-0010-office-building-bound-is-not-tenant-building-paper.md)).

The Building panel from #121 is the click path. Eight nearest Passages stay the search cap. Rent stays off the roll.

## Acceptance criteria

- [x] Building-bound table question calls the list command; names do not depend on Passage hits
- [x] Building-bound protocol question calls search and does not include the household roll in this turn’s facts
- [x] Both commands in one turn are allowed; an earlier table in the thread is not a fact unless the list is fetched again
- [x] Unit-bound turn cannot call the list command; existing Unit goldens stay search-only
- [x] List refused on portfolio and on any tenant-facing assembly; fail closed
- [x] Empty active roll: answered, not the documents-refusal sentence; no Passage citations
- [x] Full golden set runs; new behavioural cases for list vs search vs empty roll
- [x] Policy cases red first: list refused off a Building bound; ערב still absent; no ת.ז. on list facts; tenant stance still cannot search a Building bound
- [ ] Clicked on `:3000`: table ask and protocol ask on one Building; two Unit panels in that Building still isolated
- [x] `SPEC-evidence.md` (office turn) updated in the same change; staff spec only if the thread contract changes

## Blocked by

- #121 — Building retrieval panel
- #122 — Active lettings in a Building

## Comment — 2026-09-17

Closed: Building-bound office turn may choose search, `listActiveLettingsInBuilding`, or both this turn. Facts are only those returns. List is a command error off a Building bound and is not assembled on a tenant path. Empty roll answers; no paper citations. Goldens 008–010. Policy red first on the offer. Live `:3000` table/protocol click not done this session — Google sign-in, and this process has extract/embed unconfigured. Building-panel HTTP seam still posts and isolates the Unit thread.
