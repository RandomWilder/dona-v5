---
number: 136
title: "Track B — intake, promotion, and the tenancy card"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-21
closed:
---

## Problem Statement

The lease extraction field list was derived from one document on 20 September 2026 and extended by a
second on 21 September. Reading both end to end, by hand, produced a set of values the running system
does not reach — not because the model is wrong, but because of what this codebase does to the
document before the model ever sees it, and because of what the schema does with the answer
afterwards.

Four things are wrong at once, and each hides the next:

**Nothing measures the reading.** There is no score for extraction, so no change to the reader can be
called an improvement or a regression. Every claim about the extractor to date has been an argument.

**The model is handed less than was measured.** Each word reaches it as `{id, page, text}`; `x`, `y`,
`width`, `height` and `confidence` were all produced and all discarded. On a Hebrew lease that is
expensive in a specific way — the commercial-terms annex is a two-column right-to-left table where
the label sits beside its value, so in reading order they are far apart and on the page they are
adjacent. And `reasoning_effort` was `none` until #129, on a document whose deposit is printed as an arithmetic
identity the reader is never given room to check.

**The declaration cannot say who a value belongs to.** Two rows of `tenant_name` and two rows of
`tenant_id_number` arrive with no link between them. On the second specimen the two signatories carry
different kinds of identifier — a passport and a ת.ז. — one line apart. A pairing heuristic that gets
that wrong writes one person's identifier onto another person's record and looks correct doing it.

**Promotion has no overwrite rule and too narrow a target list.** The price of a letting is on the
paper and nowhere in the schema, so nothing can branch on it; and where promotion does write, a
second document on the same letting can move a typed column with nothing said.

Underneath all four: two documents is a thin sample, and the standing risk is over-fitting a schema
to them.

## Solution

Score the reading first, then change it, then widen what a lease declares, then — and only then —
spend one migration.

Everything is biased toward the reversible change: a seed row rather than a column, a view rather than
a schema, a declaration rather than a constraint. **One migration is proposed in the whole track**,
and its justification is that something deterministic will read what it adds. The filter for a typed
column is *"will code branch on it?"* — not *"is it important"*. A tenant's passport number is
important and is never compared to anything by a machine; the rent is compared to a payment.

The reading screen and the tenancy card render the rest as **cited captures** under the render-only
rule: a view may display and cite an approved `ExtractedField`, and may never branch on one.

The authority is the SPEC files — `SPEC-evidence.md`, `SPEC-tenancy.md`, `SPEC-flows.md` and
`CONTEXT.md`. `docs/proposals/track-b-intake-and-promotion.md` is the adopted draft they were folded
from and carries the full argument; where the two could be read as disagreeing, the spec wins.

## User Stories

1. As an engineer changing the extractor, I want a score over hand-keyed ground truth, so that I can
   tell an improvement from a regression instead of arguing about it.
2. As an operator reading a lease, I want the household shown by role, so that I never have to attach
   an identifier to a name by hand.
3. As an operator reading a lease, I want every value the document prints on one screen, grouped, so
   that signing the reading is one sitting.
4. As the office, I want the rent on the record and not only on the paper, so that arrears and
   reminders can be computed from it.
5. As the office, I want a promotion that would change a value already on the record to stop and tell
   me, so that a re-filed or corrected document never moves a price silently.
6. As the office, I want a card for one letting showing everything the lease says with a link to the
   page it says it on, without twenty migrations to get there.
7. As a tenant who takes the option, I want my letting extended rather than ended and restarted, so
   that my own earlier paper does not become somebody else's.

## Acceptance

This is what "track B is done" is tested against. Each line is end-to-end, not a layer.

- [ ] An extraction score exists, runs on the `evals` gate, and reports required- and optional-field
      accuracy separately with credited absences scored as right
- [x] The two reader changes were each measured alone, and both deltas are written down
- [x] The decision on splitting the extractor call and rewriting `EXTRACT_INSTRUCTIONS` is recorded,
      whichever way it went
- [ ] A lease read today yields the household by role, with no pairing step anywhere in the flow
- [ ] `deposit_months` and `option_end_date` are read from the paper, not assumed
- [ ] September's `tenant_name` values still mean what they meant — the old declarations were closed,
      not edited
- [ ] Rent, its currency and the option end reach `tenancy` only through approve → promote
- [ ] A promotion that would overwrite a different value refuses and names what is already there
- [ ] An amount without its currency can be approved and cannot be promoted
- [ ] The reading screen and the tenancy card cite every value they show
- [ ] No deterministic path reads a capture — the contract test is green and **unmodified**
- [x] Exercising an option extends the letting; a tenant's retrieval bound reaches the same paper
      after the extension as before it
- [ ] `test:policy`, `evals`, `npm test` and the guards are green; every new deterministic constraint
      had a policy case that was red first

## Children

In dependency order. The frontier is #130 and #131, which are independent of each other now that #129 is closed.

1. #127 — Score the lease reading against the fixture · **closed 2026-09-21**, baseline on the issue
2. #128 — Send each word its normalised position · *blocked by 127* — **closed 2026-09-21**
3. #129 — Raise extraction reasoning effort to medium · *blocked by 128* — **closed 2026-09-21**;
   call split and instruction rewrite are not being built; deltas on the issue
4. #130 — Refuse a promotion onto an occupied column · *unblocked*
5. #131 — Declare the lease household by role, and the terms it prints · *unblocked*
6. #132 — Promote rent and the option end onto the tenancy · *blocked by 131, 130* · **the migration**
7. #133 — Beat 3 reads the declared set · *blocked by 131*
8. #134 — The tenancy card, under the render-only rule · *blocked by 132*
9. #135 — Exercising the option extends the letting · *blocked by 132* · **closed 2026-09-21**
10. #137 — A long scan is read to page fifteen, and everything downstream extracts from there ·
    *unblocked, raised by #127* · a prerequisite of nothing above, and it bounds what all of them can
    achieve in the live path: the baseline on #127 is measured over every page, and the running
    system reads fifteen

## Out of scope

Track A — the Building declaration and pre-created spaces — and track C — the retrieval bound leak,
closed as #124. `gush`, `helka` and the plan's structure designation are printed on both specimens and
belong to track A: they are facts about the building, not about the letting.

#125 is not a child of this track. It asks what place paper a tenant may read, is parented to #124,
and is the director's to triage.
