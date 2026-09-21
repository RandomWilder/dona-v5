---
number: 127
title: "Score the lease reading against the fixture"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 136
created: 2026-09-21
closed:
---

## What to build

An extraction golden set joins the `evals` gate. It runs the live extractor over the two specimen
leases and compares every value it returns against the hand-keyed ground truth already committed at
`evals/fixtures/lease-extraction.ts` — 57 values, 2 credited absences, 4 arithmetic identities, 10
recorded hazards, across two documents.

The output of this ticket is a number, not an improvement. Nothing about the reader changes here. The
extractor is measured exactly as it stands today, against the declarations that exist today, so that
every later claim in track B has something to be measured against. A baseline taken after the reader
has been touched is not a baseline, and a baseline taken on a red suite is worth less than none.

Two things the scorer must encode in arithmetic rather than in prose:

**Required and optional accuracy are reported separately and never blended.** A miss on
`guarantor_name` and a miss on `rent_amount` are not the same failure, and one percentage hides which
one you are looking at.

**A credited absence scores as right.** The second specimen names no guarantor at all; extraction
returning zero of them is the correct answer. A scorer that penalises a correct nothing tunes the
reader toward inventing values, which is the exact failure this module's doctrine — *a missing
required field is a result, not an error* — exists to prevent. `CONTEXT.md` now carries the term.

The four arithmetic identities the fixture records are assertions, not commentary: both specimens
compute their deposit as (rent + maintenance) × a multiplier, and a reading that returns all three
parts but a figure that does not satisfy the identity has not read the document.

The known plot-number conflict carries no field key and no score. Both specimens print one value in
the body and another on the plan, identically, so there is no right answer to grade and grading it
would penalise a faithful reading.

This adds no new CI machinery. Like every other eval here it needs `OPENAI_API_KEY` and is skipped
without one.

## Acceptance criteria

- [ ] The extraction golden set runs under the existing `evals` gate, over both specimens
- [ ] Every value in the fixture is compared; per-field exact match is reported
- [ ] Required-field accuracy and optional-field accuracy are printed as two numbers, never one
- [ ] Both of the second specimen's credited absences score as correct, not as misses
- [ ] All four arithmetic identities are asserted
- [ ] A value returned with a confident citation that disagrees with the fixture is a failure
- [ ] The recorded plot-number conflict is scored by nothing
- [ ] The run skips without `OPENAI_API_KEY`, like every other eval, and adds no CI configuration
- [ ] The baseline numbers are recorded as a comment on this issue before it closes

## Blocked by

None (can start immediately).

## Related

`SPEC-evidence.md`, *The reading is scored before it is improved — track B*. The full argument is in
`docs/proposals/track-b-intake-and-promotion.md` §1; the spec wins wherever the two could be read as
disagreeing.
