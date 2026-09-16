---
number: 117
title: "A16 — place step: several, none, and create in-tab"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [116]
parent: 115
created: 2026-09-16
closed: 2026-09-16
---

## Parent

#115 — A16 — File a lease in one workspace (תיוק חוזה).

## What to build

The place step from #116 grows the rest of A12's four causes, still **on this tab**, still writing nothing until a file is accepted.

Nothing readable as an address, annex deferral, address in nobody's portfolio, several Units: one sentence each, as today. Candidates and estate search on the same step. Picking a candidate and attaching again files.

Create a Building and/or Unit **on this step**, not on the estate forms. Prefill from what was read; the human may edit. Then attach again. Offered only with estate write. An operator sees pick and search only — no disabled create door.

Exact-one confirm-then-file from #116 is unchanged. Estate create **screens** are not edited.

## Acceptance criteria

- [x] Four A12 refusal sentences appear on this tab for the four causes
- [x] Several Units: list to pick, then attach again files against the chosen Unit
- [x] Search for a Unit works on this step
- [x] Estate-write: create Building and/or Unit on this step, prefilled, editable, then re-attach
- [x] File-only role: candidates and search, no create control
- [x] Create uses the existing estate commands; A11/A13 screens are untouched
- [x] Nothing is stored until a file is accepted after the place is known
- [x] Exact-one path from #116 still confirms before file

## Blocked by

- #116 — A16 — tab, the file, and exactly one Unit

## Comment — 2026-09-16

Closed. Place step on **תיוק חוזה**: four A12 sentences, candidate list, search on this tab, in-tab create via `upsertUnitRow` for `estate.write` only. Operator sees pick/search, no create door. Nothing stored until attach-again files. Exact-one confirm-then-file unchanged. HTTP suite in `src/evidence/lease-filing.test.ts`.
