---
number: 135
title: "Exercising the option extends the letting"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: [132]
parent: 136
created: 2026-09-21
closed: 2026-09-21
---

## What to build

Both specimens run an initial term with an option to extend. When a tenant takes the option, the
letting does not end and a new one does not begin: **the same household stays in the same flat under
the same agreement, for longer.**

**Exercising the option writes a `tenancy_event` and moves `end_date`.** The event is the history, in
the same shape `ACTIVATED` and `TERMINATED` already use.

**The event kind is `extended`, with a nullable `source_document_id`.** This is neither neighbour's
shape, deliberately: `amended` requires a document and `terminated`/`activated` forbid one, while an
option exercise is honestly sometimes a signed notice and sometimes a phone call. Forcing it into
either neighbour would mean either fabricating a document reference or discarding a real one.

**`option_end_date` is not cleared.** A letting that was extended is a different fact from a letting
that was always five years long, and the column is the only place that distinction survives.

Two alternatives were considered and refused, and both refusals are load-bearing:

Updating `end_date` alone loses the fact that an option ever existed.

Creating a second tenancy row makes one continuous letting look like a turnover — which is exactly the
distinction the isolation rule exists to preserve. A previous household's paper must not be reachable
from a current letting, and **a renewal is not a previous household.** That is the same bound #124
drew, and a second row would quietly hand this household's own earlier paper the shape of somebody
else's.

## Acceptance criteria

- [x] Exercising the option appends a `tenancy_event` of kind `extended`
- [x] `source_document_id` on that event is nullable, and an exercise with no paper is representable
- [x] `end_date` moves to the option's end
- [x] `option_end_date` retains its value after the exercise
- [x] No second `tenancy` row is created; the letting's identity is unchanged
- [x] A tenant's retrieval bound after an exercise reaches the same paper it reached before —
      an extension is not a turnover
- [x] A policy case covers the last two, red first

## Blocked by

- #132 — `option_end_date` is not a column on `tenancy` until then.

## Related

`SPEC-tenancy.md`, *The option, exercised — track B*. `CONTEXT.md` glossary, **Option**.
#124 — the Tenancy bound, and why a turnover and an extension must not look alike.

## Comment — 2026-09-21

Closed: `0035` widens `tenancy_event` to `extended`. `exerciseOption` moves `end_date` to
`option_end_date`, leaves the option column, and appends the event with a nullable
`source_document_id`. Same `tenancy_id`. Policy case red first: the file imported
`exerciseOption` before it existed, so identity and bag could not be asserted until the
command landed. Schema CHECK `tenancy_event_kind_check` was a separate red, in the tenancy
schema suite.
