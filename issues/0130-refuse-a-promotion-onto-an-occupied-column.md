---
number: 130
title: "Refuse a promotion onto an occupied column"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: []
parent: 136
created: 2026-09-21
closed: 2026-09-21
---

## What to build

`promoteExtractedField` is idempotent for the same row re-promoted, but nothing today examines whether
the target column already carries a value promoted from a *different* extracted field. A second
document on the same letting, a corrected reading, or an amendment can therefore move a typed column
with nothing said to anyone.

**A promotion onto an occupied column succeeds silently when the value is identical, and refuses with
`conflict` when it differs.** Re-filing the same lease is an ordinary act and must not be an error.
A value that changed is the single thing an operator most needs to be told. The refusal names the
existing value and the document it came from; superseding it is a deliberate second act, not a side
effect of filing.

This ticket lands **before** the migration that widens the promotion target list, and that ordering is
the point. With dates alone the gap was survivable, so the rule can be built and proved today against
the targets that already exist. When rent arrives on a typed column in #132, it arrives at a `promote`
that already refuses conflicts, rather than shipping a price with no overwrite rule and a follow-up
ticket to add one. Make the change easy, then make the easy change.

This is a policy case, **red first**. Both gates in this repo are test suites and a new deterministic
constraint gets a failing case before it gets an implementation.

## Acceptance criteria

- [x] A policy case asserting the conflict refusal is written and observed failing before any
      implementation
- [x] Re-promoting the same extracted field onto the same column succeeds and is silent
- [x] Promoting a *different* extracted field whose value is identical succeeds and is silent
- [x] Promoting a different extracted field whose value differs refuses with `conflict`
- [x] The refusal names both the existing value and the document it was promoted from
- [x] Superseding an existing promotion remains possible as an explicit act
- [x] `npm run test:policy` is green

## Blocked by

None (can start immediately). Independent of the scorer chain — it touches the promotion gate and not
the reader.

## Related

`SPEC-evidence.md`, *A promotion onto an occupied column*.

## Comment — 2026-09-21

Closed: occupancy is a stamp from a different extracted field on the same letting. Same value stamps
quietly; a different value is `conflict` and names the existing value and its document. `supersede`
is the explicit overwrite — amendment confirm passes it for `new_end_date`. Policy case red first:
`Missing expected rejection` before the command refused.
