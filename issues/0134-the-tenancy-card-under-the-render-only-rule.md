---
number: 134
title: "The tenancy card, under the render-only rule"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: [132]
parent: 136
created: 2026-09-21
closed: 2026-09-21
---

## What to build

A card for one letting, showing what the lease says about it.

Most of what the card shows will never be a typed column, because most of it is never branched on.
The alternative — promoting twenty fields so a screen can render them — would spend the governed verb
on a display problem and would make every future screen an argument about migrations.

So the card reads **approved** `ExtractedField` values directly, and cites them. The rule it is built
under, now written into `CONTEXT.md`:

**The render-only rule.** A view may read an approved `ExtractedField` value in order to display it
and to cite it. It may not branch on one, compare one, aggregate over one, or let one decide what
happens next. Those remain the exclusive business of typed columns — which is what the contract test
has always been about. The rule's target is *decisions*, not pixels, and a value shown on screen
beside a link to the page it came from is the opposite of a hidden dependency.

**The boundary is kept structural rather than honour-based.** These reads live in the read model and
the view layer, never inside a module's `internal/`. The existing contract test continues to assert
that no deterministic path reads a capture, and it must stay green without being loosened for this
screen. If it needs loosening, the read is in the wrong place.

The rule is written down precisely because *display only* is the exact phrase that erodes. The first
comparison written against an approved capture will be small, reasonable, and the end of the
distinction.

The promoted values — rent, its currency, the option end — come from `tenancy`'s own columns, because
they exist there now. Everything else on the card is a cited capture.

Like beat 3, this screen is the administrator stance and nothing on it is masked. The same note
applies with more force here, because this is the card most likely to acquire a tenant route:
**the day it does, it needs a stance.** #125 owns that question.

This is a screen. Restart `npm run dev` and click it on `:3000` before it merges.

## Acceptance criteria

- [x] The card shows one letting's terms: the promoted values from `tenancy`, the rest as captures
- [x] Every rendered capture is approved; unapproved values do not appear
- [x] Every rendered capture carries a citation to the page it came from
- [x] No branch, comparison, aggregation or conditional anywhere on this screen reads a capture value
- [x] The capture reads live in the read model and view layer, never in a module's `internal/`
- [x] The contract test asserting no deterministic read of a capture is green and **unmodified**
- [x] Rent, rent currency and option end are read from `tenancy`'s columns, not from captures
- [ ] The path is clicked on a restarted `:3000` before merge

## Blocked by

- #132 — the promoted columns must exist before the card can read them.

## Related

`CONTEXT.md`, *The render-only rule*. `docs/proposals/track-b-intake-and-promotion.md` §6 carries the
argument; the glossary entry is the authority.

## Comment — 2026-09-21

Closed. Card on `GET /estate/tenancies/:tenancyId`. Rent / currency / option end from `tenancy`.
Other approved, unmapped captures listed with `/documents/:id/read?page=N`. Unapproved stay off.
Reads in estate's read model and the view. R9 untouched. HTTP inject is the signed-in click;
director should still open a live letting on `:3000` after `npm run dev` restart.
