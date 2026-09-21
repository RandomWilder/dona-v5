---
number: 128
title: "Send each word its normalised position"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [127]
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
