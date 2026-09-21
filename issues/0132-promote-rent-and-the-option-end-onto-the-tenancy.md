---
number: 132
title: "Promote rent and the option end onto the tenancy"
status: closed
labels: [ready-for-agent]
assignee: cursor
blocked_by: [131, 130]
parent: 136
created: 2026-09-21
closed: 2026-09-21
---

## What to build

Three declared fields become promotable, and the typed columns they land on are created.

`rent_amount` and `rent_currency` promote together or not at all: the lease *is* the source of the
price of the letting, in exactly the sense its dates are the source of its term, and arrears,
reminders and the office bag all branch on it. `option_end_date` promotes because whether a letting
can be extended, and until when, is a question the renewal path asks of the record rather than of the
paper.

Nothing else widens. The test is **"will code branch on it?"** — not "is it important". A tenant's
passport number is important and is never compared to anything by a machine; the rent is compared to a
payment. The deposit, maintenance and promissory-note figures are quoted at move-out and cited from
the page, and nothing branches on them. Names and identifiers are unchanged from the 7.4 ruling: a
household is written by the confirm as `PARTY` links, and an identifier becomes `party.national_id` by
an act rather than a copy. `signed_date` and `deposit_months` are facts about the document with no
column to land on.

**This is the one irreversible ticket in track B.** It costs a migration: the `field_promotion.target`
CHECK widens, and `tenancy` gains `rent_amount`, `rent_currency` and `option_end_date`. None of the
three is `NOT NULL` — completeness is a state and never a constraint. A balance is still Priority's;
nothing here writes one.

**Named blast radius:** `src/tenancy/schema.test.ts` asserts `tenancy`'s column list exactly. It goes
red on the three new columns by design and moves in the same change.

### A half-priced pair is not promotable

An amount may be **approved** without its currency — capture is open, and what the page says is always
approvable. It may not be **promoted** without it. The refusal lives in `promote`, beside the approval
requirement and for the same reason: the columns a copy lands on are read by machinery no model
decides, and half a price on one of them is worse than no price at all. This is the seam the module
already has, used as designed — open on the way in, governed at the gate.

This is a policy case, **red first**, and it belongs here rather than in its own ticket because before
this migration there is no promotable pair for it to refuse.

The conflict rule from #130 already guards the new columns the moment they exist; nothing about it is
re-stated here.

## Acceptance criteria

- [x] A policy case asserting the half-pair refusal is written and observed failing first
- [x] A migration widens `field_promotion.target` to admit `rent_amount`, `rent_currency` and
      `option_end_date`
- [x] `tenancy` gains those three columns, all nullable
- [x] `src/tenancy/schema.test.ts`'s exact column list moves in the same commit
- [x] An approved amount without its currency can be approved, and refuses to promote
- [x] The pair promotes together; neither half lands alone
- [x] Promoting rent onto a tenancy that already carries a different rent refuses with `conflict`
      (#130's rule, now reaching a column that matters)
- [x] Nothing else is added to the promotion target list
- [x] `npm run test:policy`, `npm test` and `npx tsc --noEmit` are green

## Blocked by

- #131 — `option_end_date` is not declared until then, so there is nothing to promote.
- #130 — the overwrite rule lands before the column whose overwrite would move a price.

## Related

`SPEC-evidence.md`, *Three more copies — track B* and *A half-priced pair is not promotable*.
`SPEC-tenancy.md`, the *no amount column* paragraph, which this change amends in the same commit.

## Comment — 2026-09-21

Closed: `0034` widens the CHECK and adds the three nullable columns. Rent is a pair — an amount
without a currency is approvable and not promotable (`conflict`); both halves land together. #130
now reaches the price. Policy case red first: CHECK `field_promotion_target_check` before the
mapping existed.

