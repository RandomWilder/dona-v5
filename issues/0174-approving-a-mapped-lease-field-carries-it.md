---
number: 174
title: Approving a mapped lease field carries it onto the letting
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 173
created: 2026-09-30
closed: 2026-09-30
---

## Parent

#173 — An approved lease carries onto its letting.

## What to build

An operator who approves a mapped value on a `lease` — on A16's reading step or on A15's ledger —
sees it on the letting without pressing `קדם`. When the approved reading first establishes the draft,
every mapped value already approved is carried with the dates: rent (as a pair), option end, assigned
bay, assigned storage, and rooms / floor on the Unit. When the lease is already bound to a letting,
approving one more mapped value carries it at that moment.

A carry that cannot land — the other rent half unapproved, a bay or storage number that is not a
Space in the Building, a different value already on the column or the Unit — leaves that row
uncarried and does **not** fail the approval: the approve route redirects exactly as it does today,
never a 4xx. This ticket does not yet explain the uncarried row on screen; #175 does.

Spec first, same change: amend SPEC-flows A15's *What A15 does not do* paragraph and A16 step 3's *no
promote* sentence, and SPEC-evidence's A2 section, to say approval of a mapped `lease` field carries
it when a letting is bound, and that establishing the draft carries every approved mapped field.
`lease_amendment` is untouched.

## Acceptance criteria

- [x] Spec amendments above land in the same change as the code.
- [x] A16: approving rent amount, rent currency, option end, parking and storage *before* the reading
      is ready, then the last required row, produces a draft whose letting page shows the rent, the
      option end, the assigned bay and the assigned storage.
- [x] A15: approving each of those on a lease already bound to a letting lands it on approval.
- [x] Rooms and floor land on the Unit through approval when the Unit holds nothing different.
- [x] Approving `rent_amount` alone succeeds and carries nothing; approving `rent_currency` then lands
      both in one transaction.
- [x] Approving a parking or storage number that is not a Space in the Building succeeds with the
      normal redirect; nothing is stamped `promoted_to` for that row.
- [x] A value differing from one already on the column is not carried and not overwritten; the
      existing `קדם` overwrite confirmation still works for it.
- [x] An unapproved row is never carried.
- [x] Each carry writes `evidence.promote_field` with the approver as actor; a refused carry writes no
      promotion stamp.
- [x] `lease_amendment` behaviour unchanged (existing A3 suite green).
- [ ] Clicked on `:3000`: file a lease on A16, approve, open the letting, see rent and option end.

## Blocked by

None (can start immediately).

## Comment — 2026-09-30

Approving a mapped field on a lease now carries it onto the letting. The approval that first writes the draft carries every mapped field already signed — rent as a pair, the option end, the assigned bay, the assigned storage, and rooms and floor on the flat. A later approval on a lease that is already bound carries that field at once. A carry that cannot land leaves the row uncarried and the approval still redirects as before. An unsigned row is never carried. A successful carry is recorded as the approver's promotion; a refused one leaves no stamp. Amendments are unchanged. The ledger's old sentence, that promotion reaches only the two dates, was rewritten because it had become false. Saying why a row was not carried is still #175. The letting page was read through the approval routes and showed the rent, the option end, the bay and the storage. It was not clicked on the running app: that would have meant filing a made-up lease into the local database.
