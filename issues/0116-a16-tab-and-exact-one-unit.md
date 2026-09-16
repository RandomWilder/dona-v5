---
number: 116
title: "A16 — tab, the file, and exactly one Unit"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 115
created: 2026-09-16
closed: 2026-09-16
---

## Parent

#115 — A16 — File a lease in one workspace (תיוק חוזה).

## What to build

An operator who may file sees **תיוק חוזה** on the rail, directly under **מסמכים**. A viewer does not. The tab's empty state is the file beat: type locked to **חוזה שכירות**, attach well, five-beat strip as status (not a skip control).

They attach a lease. The address is read on **the same step**. Exactly one Unit: they **see** it, then Continue, and only then is the Document written. Nothing is held between a read that did not file and the next post.

Wrong file for a lease, a scan the current reader cannot carry, or bytes already on file: a sentence **on this tab**, nothing stored. Duplicate bytes name the existing Document and link out by choice.

Not exactly one Unit: stay on this tab with A12's sentence for that cause and the file input re-armed. Pick, search, and create are **not** this ticket — the sentence is honest that there was not one Unit.

After a successful file they are still on this tab. **קריאה** may still be a stub. Old A12 still auto-files on exact one. **מסמכים** unchanged.

## Acceptance criteria

- [x] Rail item **תיוק חוזה** sits under **מסמכים** and is hidden without file permission
- [x] Empty state is lease-only attach; no type menu
- [x] Five beats are visible as status; a future beat is not a working shortcut
- [x] Exact one Unit is shown, then Continue files through the existing file command
- [x] Wrong type, reader-too-large, and duplicate bytes refuse on this tab and write no row and no object
- [x] Not-exactly-one stays on this tab with the matching A12 sentence and a re-armed file input; no create/search/pick UI yet
- [x] After file, the next screen is this tab, not **מה נקרא מן המסמך** and not the Tenancy page
- [x] A12's existing door still files immediately on exact one Unit
- [x] HTTP tests cover the new tab's sequence; command guts already proved are not re-specified

## Blocked by

None (can start immediately).

## Comment — 2026-09-16

Closed. Rail item **תיוק חוזה** under **מסמכים**, gated on file permission. Empty tab is lease-only attach. Exact one Unit is shown, then Continue files. Refusals stay on this tab and write nothing. After file, this tab's stub **קריאה**, not the old ledger. A12 still auto-files. HTTP suite in `src/evidence/lease-filing.test.ts`.
