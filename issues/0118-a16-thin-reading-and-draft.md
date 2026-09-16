---
number: 118
title: "A16 — thin reading, draft arrival, enough for today"
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

After a lease is filed on this tab, **קריאה** is a new screen here — not the old ledger. Only the stamps that open a letting: names and dates. Approving those stamps writes the draft at the same moment as today. Arrival is **טיוטה** on this tab: title, people, dates, whether **פרוטוקול מסירה** is missing or present. No activate. No protocol attach.

A second lease on the same Unit and the same start date is `conflict` on this tab, with a link to the existing Tenancy. Overlapping live + draft on one Unit remains allowed.

**די היום** (quiet in the strip until this arrival): file another (empty state of this tab), open the Tenancy, open the Unit. Those last two are the existing screens, by choice. This tab does not list unfinished filings.

The old ledger, promote, reveal, and bulk approve-rest stay where they are for every other door.

## Acceptance criteria

- [x] After file, **קריאה** is this tab: names and dates to stamp; not a clone of the full ledger
- [x] Approving the required stamps writes a draft Tenancy (existing command, same moment as #110)
- [x] Next screen is **טיוטה** on this tab, not the Tenancy page
- [x] טיוטה shows title, people, dates, and protocol missing/present; no activate; no protocol file
- [x] Same Unit + same start date is `conflict` here with a link to the existing Tenancy
- [x] די היום offers file another, open the Tenancy, open the Unit
- [x] File another returns to this tab's empty state without destroying the draft
- [x] `GET` of the old ledger still works for other doors; this journey does not load it
- [x] HTTP tests for this sequence; draft/conflict internals already proved are not re-specified

## Blocked by

- #116 — A16 — tab, the file, and exactly one Unit

## Comment — 2026-09-16

Closed. After file, **קריאה** on this tab stamps names and dates only; approve writes the draft via `establishApprovedLease`. Next GET is **טיוטה** (title, people, dates, protocol missing/present) plus **די היום** (file another / Tenancy / Unit). Same Unit + same start is `conflict` here with a link. Old ledger GET unchanged. HTTP sequence in `src/evidence/lease-filing.test.ts`.
