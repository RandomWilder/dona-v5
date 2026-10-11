---
number: 206
title: "Contacts on the profile: add, label, set primary, close"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [202]
parent: 199
created: 2026-10-11
closed: 2026-10-11
---

## Parent

#199 — the אנשי קשר tab.

## What to build

An operator adds a phone or an email to a party, from today or a given date, with an optional label
such as "יוסי – סדרן"; marks one contact primary; and closes a contact on a date. A phone typed in any
local form is stored in the international form. A number another party holds on any day of the new
contact's period is rejected, naming the other party. A closed contact is kept and shown with its
dates, never deleted, and from the day after its end date it identifies nobody at the front door.
Once closed, the same number can be added to its new holder. The directory's phone search also
matches closed contacts, flagged as a former number.

`party_contact` gains a nullable `label`, marked `-- pii`. SPEC-parties is amended first.

The policy case comes first and is seen red: closing a contact keeps the row, and after its end date
the number resolves to no unit — written beside the recycled-number case, through the scope contract.

## Acceptance criteria

- [x] The policy case is written before the code, fails first, and passes after.
- [x] Adding a phone in local, spaced or hyphenated form stores it in the international form.
- [x] Adding a number another party holds on an overlapping day is refused with the other party named; nothing is written.
- [x] A contact can carry a label, shown on the profile; a schema test covers the column.
- [x] Setting a contact primary is reflected in the directory row.
- [x] Closing a contact sets its end date and keeps the row; there is no delete route.
- [x] After closing, the same number can be added to a different party from the following day.
- [x] A phone search matches a closed contact and marks it as a former number.
- [x] Each add, primary change and close writes an audit row with the actor, role, party id, contact id and channel.
- [x] Route tests cover each of the above as OPERATOR, and the refusal as VIEWER.
- [x] The contact screens are removed from the mockup; clicked on `:3000`.

## Comment — 2026-10-11

Closed. An operator adds a phone or an email, with a label, marks one primary, and closes it on a date. The row stays. The day after the end date the number resolves to no unit, and the same number can be added to its new holder from the following day. A phone search of a closed number is marked as a former number. Clicked on `:3000` after a restart: a local number was stored in the international form with its label, the directory row showed it once it was primary, and after close the search marked it a former number.

## Blocked by

- #202 — the tab and the profile exist.
