---
number: 129
title: "Raise extraction reasoning effort to medium"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: [128]
parent: 136
created: 2026-09-21
closed: 2026-09-21
---

## What to build

`extraction.reasoning_effort` defaults to `none`. Several of the values on a lease are only reachable
by arithmetic the document itself invites: a deposit stated as a number of months of rent plus
maintenance, a promissory note at six months. A reader given no room to work cannot check its own
answer against the identity printed beside it — which is the same arithmetic the scorer from #127
asserts.

The default becomes `medium`. This is a settings row read per call, not a deploy, so it is reversible
by editing a row.

Like #128, this is one variable changed alone. Re-run the golden set and record the second delta as a
comment on this issue.

**Then decide, from the two numbers, what happens to the rest of section 2.** The extractor makes one
call per document carrying every declared field across every page, and `EXTRACT_INSTRUCTIONS` is a
single accumulated string of bug patches. Both are real defects and both are larger changes than
either of these two tickets. They were deliberately deferred behind this measurement. If normalised
position moved the score, the layout hypothesis holds and splitting the call earns its cost; if it did
not, the line-reconstruction work should not be built at all. Write the decision down here either way
— an unrecorded decision is how a deferred defect becomes a permanent one.

## Acceptance criteria

- [x] `extraction.reasoning_effort` defaults to `medium`
- [x] The default is a settings row read per call; no deploy is required to change it back
- [x] This is the only behavioural change in the ticket
- [x] The golden set is re-run and the delta against #128 recorded as a comment
- [x] The comment states, from both deltas, whether the call split and the instruction rewrite are
      worth building — and opens an issue for them if they are

## Blocked by

- #128 — two changes measured together give one unattributable number.

## Related

`SPEC-evidence.md`, *ExtractedField*, and *What is deliberately not changed*.

## Comment — 2026-09-21

Shipped. Default is `medium`, a `config_settings` row read per call. 0003 still seeds the historical
`none`; a new migration rewrites only a row that is still `none`, so an operator who already moved it
keeps their choice. Walking it back is another row, not a deploy. Nothing else about the reader
changed.

**Eight runs, `gpt-5.6-luna`, `reasoning: medium`, after this change only.** Against #128's eight-run
range (required 68.8–87.5, optional 58.3 on every run, contradictions 3–6).

| run | required | optional | contradictions |
|---|---|---|---|
| 1 | 75.0% (12/16) | 75.0% (9/12) | 2 |
| 2 | 68.8% (11/16) | 75.0% (9/12) | 3 |
| 3 | 68.8% (11/16) | 75.0% (9/12) | 3 |
| 4 | 62.5% (10/16) | 75.0% (9/12) | 4 |
| 5 | 68.8% (11/16) | 75.0% (9/12) | 3 |
| 6 | 62.5% (10/16) | 75.0% (9/12) | 4 |
| 7 | 62.5% (10/16) | 75.0% (9/12) | 4 |
| 8 | 75.0% (12/16) | 75.0% (9/12) | 2 |

| | this change | #128 |
|---|---|---|
| required | 62.5% – 75.0% | 68.8% – 87.5% |
| optional | **75.0% on every run** | 58.3% on every run |
| contradictions | 2 – 4 | 3 – 6 |

**Optional is the movement, and it is the credited absence.** All eight runs returned no guarantor on
`bloch-206-7`. #128 invented one from the second tenant on every run. That is the only score this
change improved, and it is why optional left the 58.3% mode for good.

**Required got worse.** Three of eight runs sit on the 62.5% ratchet floor, which #128 never touched.
The household is unchanged in kind: `Ariella Atkin` never returned, `A36688170` never returned,
names still fuse (`Yitzchok Shmuel Bloch; דבורה בלאך`, `Rami Pinchot`, once `Rami Meir Pinchot and
Ariella Atkin`). Address still comes back with the building number stuffed in, which the fixture
refuses. Declared deposit amounts still match; the arithmetic identities stay unreachable because
`maintenance_amount` is not declared — thinking harder cannot score a field the catalogue does not
ask for.

**Decision on the rest of section 2, from both deltas.**

- **Do not split the call, and do not start line-reconstruction.** #128's own test applies: normalised
  position did not move required accuracy in the direction the layout hypothesis needed. Medium did
  not move the household either. Splitting one call-per-document to serve a layout signal the model
  is not using does not earn its cost. No issue opened.
- **Do not rewrite `EXTRACT_INSTRUCTIONS` as a ticket.** The one instruction-shaped failure these
  runs could have bought — inventing a guarantor — medium already bought. What remains of the
  household is a declaration the schema cannot say (two `tenant_name` rows with no pairing), which
  is #131, not another accumulated patch. No issue opened.

The default stays `medium` because the credited-absence fix is real and reversible. An operator who
wants the #128 required range back edits the row to `none`. `npm test` green. Four of eight `npm run
evals` passes went 10/10; the other four failed `building-empty-roll`, which is the retrieval half
and not this reader.

Closed.
