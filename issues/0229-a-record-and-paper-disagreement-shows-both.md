---
number: 229
title: A disagreement between the record and the paper shows both
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [227]
parent: 226
created: 2026-10-13
closed:
---

## Parent

#226 — The office turn reads the Unit record and the Building record.

## What to build

When the Unit record and a Passage hit carry different values for the same fact — 82 m² recorded,
85 m² printed in the lease — the answer gives both, names the record's as the current value, and
carries both the `כרטיס הדירה` citation and the Document-and-page citation. The panel never chooses
between them silently and never writes to estate, tenancy or evidence beyond the thread.

This is an instructions change to the answering model, which makes it a prompt change: the full
golden set runs.

SPEC-evidence's office-turn paragraph is amended first.

## Acceptance criteria

- [ ] The office-turn instructions require both values, the record's named as current, and both citations.
- [ ] Golden case, red first: a Unit whose record area differs from its lease's printed area answers with both values and both citation kinds. The full golden set passes.
- [ ] A turn that finds a disagreement writes nothing outside the office retrieval thread.
- [ ] Clicked on `:3000`: a seeded disagreement shows both values and both citations open their targets.

## Blocked by

- #227
