---
number: 175
title: An approved value that is not on the letting says so, and why
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

Today an approved value whose field has a promotion target but was never promoted appears nowhere on
the letting page: #134's captures list excludes promotion targets, and the fixed rows read the empty
column, so the page says `—`. After this ticket, `—` means only *nothing approved*.

On the letting page under *מה נשא החוזה אל ההשכרה*, when rent, option end, assigned bay or assigned
storage is empty on the column and an approved, uncarried row exists, the row shows the approved
value, its page link, and the mark *מאושר, לא הועבר להשכרה* with a one-sentence reason. Rooms and
floor, which land on the Unit, appear in the captures list with the same mark when uncarried. A15's
ledger shows the same reason sentence beside the row's `קדם`; A16's reading step shows the sentence
and no button.

The reason is computed on read from current state — no column, no migration:

- the other rent half is not approved;
- the named number is not a `PARKING` / `STORAGE` Space in this Building;
- the column already holds a different value (name it);
- the Unit already holds a different rooms / floor (name it).

Spec first, same change: amend SPEC-estate's #134 captures paragraph (and the matching SPEC-evidence
ledger text) to add the *approved, not carried* row.

This ticket does not depend on #174: approved, unpromoted rows already exist on staging (the
30 Sep 2026 lease) and on any lease approved before #174 lands.

## Acceptance criteria

- [x] Spec amendments above land in the same change as the code.
- [x] A letting whose lease has approved but uncarried rent shows the amount, its page, and the mark
      with the *other half* or other applicable reason — not `—`.
- [x] Same for option end, assigned bay, assigned storage; rooms and floor in the captures list.
- [x] A bay number not in the Building shows *not in this building* with the number and the Building
      named.
- [x] A value held differently on the column names the held value.
- [x] Once the value is carried (by `קדם`), the mark is gone and the column value shows.
- [x] A15's ledger shows the same reason beside the row; A16's step shows it without a button.
- [x] An unapproved row never appears on the letting page.
- [ ] Clicked on `:3000` against a lease with approved, unpromoted rows.

## Comment — 2026-09-30

An approved value that never landed on the letting is no longer a dash. The letting page shows the signed amount, the page it came from, and *מאושר, לא הועבר להשכרה*, with a reason read from the current state: the other rent half is unsigned, the bay or storage number is not a Space in the Building (the sentence names the number and the Building), or the column or the flat already holds a different value (the sentence names it). Rooms and floor show in the captures list with the same mark. The ledger shows that sentence beside קדם. The reading step shows it and still has no button. Once קדם carries the value, the mark is gone and the column shows. An unsigned row stays off the page. The local database has no approved uncarried row, and the app asks for a Google sign-in, so this was not clicked on :3000. The letting page, the ledger and the reading step were read through the approval routes.

## Blocked by

None (can start immediately).
