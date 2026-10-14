---
number: 229
title: A disagreement between the record and the paper shows both
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [227]
parent: 226
created: 2026-10-13
closed: 2026-10-14
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

- [x] The office-turn instructions require both values, the record's named as current, and both citations.
- [x] Golden case, red first: a Unit whose record area differs from its lease's printed area answers with both values and both citation kinds. The full golden set passes.
- [x] A turn that finds a disagreement writes nothing outside the office retrieval thread.
- [x] Clicked on `:3000`: a seeded disagreement shows both values and both citations open their targets.

## Comment — 2026-10-14, closed

#227 had already put a general disagreement sentence in the prompt, and the turn already kept and
persisted a record citation beside a page citation. So the first form of golden case 015 (both
values, both citation kinds) passed straight away: 10/10 keyed runs, even with that sentence taken
out. The model gives both values and both citations without being told. What it did not do reliably
was say which value is current. With HEAD's prompt, 3 of 8 runs named the record's as current, in
whatever words they chose.

The prompt now fixes the form: the record's value comes first, as `הערך הנוכחי: <value>`, then the
paper's as printed, with `cites_record` set and the passage's number in `hit_indexes`. Case 015
asserts `הערך הנוכחי: 82` and `85`, and the citation kinds `record` and `paper`. The grader gained
`citesKinds` for that. Red first: 0/8 against HEAD's prompt. Green: 10/10 against the new one. The
full keyed set passes: golden 15/15, sorter 14/14, extraction required 14/14 and optional 43/46.

The fixture page for case 015 lives in the eval subject, keyed by Unit like the fixture records. It
is not a corpus row, so no portfolio-bound ranking or grounding ratchet moved.

"Writes nothing outside the thread" is a policy case, `tests/policy/office-disagreement-writes-nothing`.
It reads `pg_stat_xact_user_tables` around one turn on a let flat, and allows only the two thread
tables plus scope's `scope.resolve_unit_occupants` access line. Red first by mutation: an
`UPDATE unit SET area_sqm` in the turn failed it on `unit`, and a `disagreement.flagged` audit line
failed it on that action. The evidence test keeps the seam-1 half: both citations are kept and
persisted.

Clicked on `:3000` after a restart, logged in as the director. A local lease page printing 100 m²
was filed onto Unit 2 at בניין מלאות, whose record says 97 m². The question was `מה גודל הדירה?`. The
answer was `הערך הנוכחי: 97 מ״ר. בחוזה השכירות: 100 מ״ר, כולל ממ״ד ומרפסת.`. `כרטיס הדירה` opened the
Unit page, which still says 97, and `חוזה שכירות · עמוד 2` opened the page that prints 100.

## Blocked by

- #227
