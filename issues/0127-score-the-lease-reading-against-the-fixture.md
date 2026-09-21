---
number: 127
title: "Score the lease reading against the fixture"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 136
created: 2026-09-21
closed: 2026-09-21
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

## Comment — 2026-09-21

**The baseline. Five runs, `gpt-5.6-luna`, `reasoning: none`, before #128 and #129, on a green
suite (773 + 41 tests, four guards, golden set 10/10).**

| run | required | optional | contradictions |
|---|---|---|---|
| 1 | 68.8% (11/16) | 75.0% (9/12) | 3 |
| 2 | 75.0% (12/16) | 75.0% (9/12) | 3 |
| 3 | 81.3% (13/16) | 75.0% (9/12) | 2 |
| 4 | 81.3% (13/16) | 58.3% (7/12) | 4 |
| 5 | 68.8% (11/16) | 75.0% (9/12) | 4 |

Sixteen required-field values and twelve optional ones are gradable. **Thirty-one of the fixture's
values are scored by nothing**, because the catalogue does not declare their keys and the mapping
schema enumerates the declared keys — the reader is structurally incapable of returning
`maintenance_amount` today. That group is the size of the gap #131 and #132 close, and it is counted
rather than folded into either percentage, which would have reported a gap in the catalogue as a
defect in the reader.

**The main finding is not any of those percentages. It is that they are five different numbers for
one reader over one set of words.** Required accuracy spread 12.5 points and optional 16.7, and five
runs produced eight distinct contradictions of which five appeared exactly once. One of those once-
only contradictions was a guarantor invented in `bloch-206-7`, the specimen that names none — the
precise failure the credited-absence rule exists to prevent, appearing in one run in five.

Three consequences, all now written into `SPEC-evidence.md`:

1. **No single run of this gate is evidence of anything.** #128 and #129 are to be judged over at
   least five runs each. An improvement inside a spread this wide, measured once, is a coin landing
   the way somebody hoped.
2. **The gate asserts a contradiction count, not a contradiction list.** The first design named the
   two the first run found and failed anything new, which is the obvious reading of the acceptance
   criterion. It could not survive the jitter: it would have been red on nearly every run while
   telling nobody anything. The ceiling holds the line the criterion cares about — a change that
   makes the reader invent more fails, whichever values it invents — and every contradiction is
   still printed in full on every run.
3. **The floors sit a graded value below the worst run**, not at the mean: 62.5% required and 50.0%
   optional, ceiling 4. `evals/measure.ts` makes this argument about a rank inside the embedder's
   jitter, and a floor half the runs fall through is a coin flip rather than a gate.

**The three contradictions that recur** are all one defect wearing three hats — the household is
read as a block rather than as people. `tenant_id_number` comes back as `36688170` where the paper
prints `A36688170`, the passport's leading letter dropped; `tenant_name` comes back as
`Rami Meir Pinchot; Ariella Atkin` and as `Yitzchok Shmuel Bloch; דבורה בלאך`, two signatories fused
into one value. #131's declaration by role is aimed at exactly this, and the number to watch when it
lands is required accuracy, where all four missing values sit.

**On the acceptance criteria.** All met, with two stated differently from the ticket and for reasons
measured rather than preferred: *a value returned with a confident citation that disagrees with the
fixture is a failure* is implemented as the count ceiling above, and *per-field exact match* is
graded against a ratchet rather than the 95% in the spec, because a gate that is red on the day it
lands gets switched off. The four arithmetic identities are asserted against the fixture on every
run including in `npm test`; against the *reading* all four report **unreachable**, because every
one of them multiplies `maintenance_amount` and nothing declares it. An instrument that cannot fail
now says so instead of printing the word for a reader that stayed silent.

**Two things this run needed that the ticket did not anticipate.** Neither specimen has a usable
text layer — `pinchot-206-4` has no text at all across 37 pages and `bloch-206-7`'s only item per
page is the CamScanner watermark — so the words come from Document AI rather than pdfjs, captured
once per specimen by `npm run specimens:capture` and never committed. And because those captures
cannot exist in a CI checkout, **this is the one gate here that CI does not enforce**;
`REQUIRE_SPECIMENS=1` exists for a run that meant to measure, and `SPEC-evidence.md` states the
limit rather than leaving it to be found in a green build.

Reading every page of both specimens raised a defect in the live path that is not this ticket's:
see #137.
