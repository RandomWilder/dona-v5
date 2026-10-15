---
number: 242
title: A misread city still narrows the candidates to the flat the lease names
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-10-15
closed: 2026-10-15
---

On 15 Oct 2026 a real lease on staging stopped at פתיחת טיוטה with no flat chosen. The place reader
read the street and number correctly, and the apartment number correctly. The city came out wrong.
The text after the address's comma was a sentence fragment about the plans, not a town, and
`CITY_AFTER` takes whatever follows the comma. So the city was a phrase like `כמסומן בתכניות`. The
exact key `<that phrase>|<street>` matched no building. `resolvePlace` fell back to `searchEstate`
over the street. That returned every flat in the right building: 26 of them, cut to twelve on the
screen, and the flat the lease names was not among the twelve shown. The operator had to search for
it by hand.

The apartment number was read and then ignored. On the exact branch it narrows the building's units.
On the street-search branch it was never applied.

## Decision

The fix is in resolution, not in the reader. A list of words that are "not a city" would be a
reader that guesses, and the next lease would put a different phrase after its comma. Narrowing the
fallback works whatever the city reads as. That includes a lease that names no city at all.

When the exact key finds no unit and `resolvePlace` falls back to the street search, it narrows what
the search returned, in two steps:

1. Keep only the units whose building `address_line` is the same street and number as the reading.
   This is equality after stripping a leading `רחוב` and collapsing whitespace, and never
   containment. The search is a `LIKE`, so `רקפת 12` also finds `רקפת 120`.
2. Of those, keep the units whose number `apartmentMatches` the reading's apartment number.

It offers the first of these sets that is not empty: the apartment matches, then the same street,
then everything the search found.

**The fallback never files and never preselects.** Its result is always a candidate list, even with
one candidate. The city did not match, so nothing exact was found, and SPEC-evidence.md's bound holds:
an exact key match is the only thing that files without a human. On the opening screen a single
candidate renders as one unchecked, required radio. The operator ticks it and presses פתיחת טיוטה.

## Out of scope

- The reader's city rule. It stays as written.
- #177, the annex and tail read. That is a different lease shape.
- Step 3 of the same review was keeping `terms_profile` through `staging:reset`. #232 / PR #136
  already did it. Staging was empty only because the 12 Oct reset ran before that fix, and it was
  re-seeded on 15 Oct with `seed-terms-profiles`.

## Acceptance

- [x] SPEC-evidence.md's resolution section states the narrowing and the no-preselect bound.
- [x] A test in `src/evidence/place.test.ts`, red before the fix and using invented values only:
      a city misread from a phrase after the comma, a street search that returns a whole building
      plus a neighbouring `…120` with the same flat number. It resolves to exactly the one flat as a
      candidate, with `unit: null`.
- [x] With no apartment match, the same-street units are offered rather than the `120` neighbour.
- [x] `npm test` is green (1222 + 41). The local click was replaced by a read-only run of the changed
      `resolvePlace` against the staging lease that raised this issue: 26 candidates became one, the
      flat the lease names. A local click needs a Google sign-in and a lease PDF of this shape, and the
      opening screen's candidate rendering did not change.
