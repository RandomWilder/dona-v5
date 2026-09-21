---
number: 129
title: "Raise extraction reasoning effort to medium"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [128]
parent:
created: 2026-09-21
closed:
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

- [ ] `extraction.reasoning_effort` defaults to `medium`
- [ ] The default is a settings row read per call; no deploy is required to change it back
- [ ] This is the only behavioural change in the ticket
- [ ] The golden set is re-run and the delta against #128 recorded as a comment
- [ ] The comment states, from both deltas, whether the call split and the instruction rewrite are
      worth building — and opens an issue for them if they are

## Blocked by

- #128 — two changes measured together give one unattributable number.

## Related

`SPEC-evidence.md`, *ExtractedField*, and *What is deliberately not changed*.
