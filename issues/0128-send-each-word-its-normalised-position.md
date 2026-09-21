---
number: 128
title: "Send each word its normalised position"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 136
created: 2026-09-21
closed:
---

## What to build

The mapping model is handed `{id, page, text}` per word. The measuring engine produced `x`, `y`,
`width`, `height` and `confidence` for every one of those words, and all of it is discarded before the
prompt is built.

On a Hebrew lease this costs something specific. The annex carrying the commercial terms is a
two-column right-to-left table: the label sits *beside* its value, not before it. In reading order the
two are far apart; on the page they are adjacent. Stripping position removes the only signal that says
so.

Each word is therefore sent with a normalised position — `x` and `y` as integers in a 0–1000 page
space, no width and no height. Normalised rather than raw because page dimensions vary across the
corpus and what the model needs is relative placement, not absolute points. Origin only because the
token cost of four coordinates per word across a 38-page document is real, and the extent of a word
carries little that its origin does not.

**This changes nothing about citation.** `extracted_field.bbox` is written by the measuring engine and
is what the provenance viewer highlights. It is untouched. The two are separate uses of the same
measurements, and conflating them has already produced one wrong estimate in this project.

This is one variable, changed alone, so that the re-measured score is attributable to it. That is the
whole reason it is not the same ticket as the reasoning-effort change: the delta is the decision about
whether the larger line-reconstruction work is worth building at all, and a delta from two
simultaneous changes cannot make that decision.

Re-run the golden set from #127 and record the delta as a comment on this issue. If normalised
position does not move the score, say so plainly — that is a real result, and it is the one that tells
us the layout hypothesis is wrong.

## Acceptance criteria

- [ ] Each word reaches the mapping model as `{id, page, text, x, y}`
- [ ] `x` and `y` are integers in a 0–1000 page space, normalised per page
- [ ] No `width`, `height` or `confidence` is added to the prompt payload
- [ ] `extracted_field.bbox` and the provenance highlight are unchanged
- [ ] This is the only behavioural change in the ticket — reasoning effort is untouched
- [ ] The golden set is re-run and the delta against #127's baseline recorded as a comment

## Blocked by

- #127 — there is no delta without a baseline, and the baseline must be taken on the untouched reader.

## Related

`SPEC-evidence.md`, *ExtractedField*, the **Two engines** bullet.

## Comment — 2026-09-21

Unblocked: #127 is closed and the baseline is the comment on it. Two things from it bear on this
ticket directly.

**Measure over at least five runs, not one.** Five runs of the current reader over identical words
spread required-field accuracy across 12.5 points (68.8 / 75.0 / 81.3 / 81.3 / 68.8). A single run
showing normalised position helping, or not helping, is inside the noise and means nothing. The
proposal's own test for this change — *if normalised position does not move the score, the layout
hypothesis is wrong and the larger line-reconstruction work should not be done at all* — needs a
distribution on both sides of it or it cannot be applied honestly.

**The number to watch is required-field accuracy, and the mechanism to watch is the household.** All
four missing required values are the two tenants' names and identifiers, and all three recurring
contradictions are the same defect: the household read as a block rather than as people
(`Rami Meir Pinchot; Ariella Atkin` in one value, `A36688170` returned as `36688170`). The signatory
block is laid out exactly like the two-column annex this change is aimed at, so it is the place
position should show up first if the hypothesis is right.

## Comment — 2026-09-21 (correction)

**Read *eight* runs, not five.** The comment above says at least five on each side of the change, and
five turned out to be exactly the sample size that looks sufficient and is not: the ceiling set from
five runs on #127 was broken by the sixth. Fourteen runs put required accuracy between 68.8% and
81.3% and the contradiction count between 2 and 5. Judge this change on distributions of at least
eight, and compare ranges rather than means — a mean moving inside a 12.5-point spread is not a
result.

Two more things from #127's correction that bear on what to measure here:

**Optional-field accuracy is bimodal, so quote it as two values.** It is 75.0% or 58.3% and never
between, because the difference is exactly `bloch-206-7`'s two credited absences. If normalised
position helps the household at all, the visible effect is that figure spending more runs at 75.0 —
not a fractional improvement, a change in how often the reader invents a guarantor out of the second
tenant.

**The signatory block is the place to look first.** Every value this change could plausibly fix is
there: two names, two identifiers, and a guarantor invented from a tenant. It is laid out the same
way as the נספח א׳ annex the layout hypothesis is about — label beside value, right to left — so if
position is going to show up anywhere it is there. If it moves nothing there, the proposal's own
conclusion applies and the larger line-reconstruction work should not be started.
