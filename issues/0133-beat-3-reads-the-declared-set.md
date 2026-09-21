---
number: 133
title: "Beat 3 reads the declared set"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [131]
parent: 136
created: 2026-09-21
closed:
---

## What to build

A16's five beats — המסמך · הדירה · הקריאה · הטיוטה · די היום — are unchanged. Everything here lands
inside beat 3. The beats are named for what the operator is doing, and reading a lease and signing the
reading are one sitting; splitting them would turn the workspace the office asked for into two.

**Beat 3 widens from four rows to the declared set.** It is still one row per value, one אישור, one
optional correction.

**Fields are grouped in the view, not in the schema** — dates, money, people, place.
`document_type_field` gains no `group_key` column. The lease is the only type with enough declared
fields to need grouping, and a column added for one type is paid for by every type that follows. The
day a second type has twenty fields, the column becomes the right answer; today it is speculative
structure.

**The household is read by role, so there is no pairing step.** `main_tenant_id_number` belongs to
`main_tenant_name` because the declaration says so. No screen asks an operator to attach an identifier
to a name.

**A pair with a missing half is marked on the screen and approvable anyway.** The refusal is at
promotion, not here — capture is open and what the page says is always approvable.

**A duplicate capture renders as two rows and the operator picks.** Nothing resolves silently.

**Identifiers are shown as printed.** This flow is the administrator stance throughout and nothing in
it is masked. There is no tenant-facing route to any of these screens, and inventing masking rules for
a route that does not exist would be speculation. Noted once, here: **a screen that later grows a
tenant route and inherits the office's identifier rendering is precisely how a leak ships** — see
#125, which owns the wider version of that question.

Reveal, promote and bulk approval stay **off** this screen. This journey ends in a draft letting; the
ledger at `/documents/:id/fields` remains the door for everything else.

This is a screen. Restart `npm run dev` — it does not watch — and click the path on `:3000` before it
merges. A diff review cannot tell you the page renders.

## Acceptance criteria

- [ ] Beat 3 renders every declared field of the lease type, one row per value
- [ ] Rows are grouped into dates, money, people and place **in the view**
- [ ] `document_type_field` gains no `group_key` column
- [ ] Household values are labelled by role; no screen asks for an identifier to be paired to a name
- [ ] An amount whose currency is missing is visibly marked and can still be approved
- [ ] Two captures of one declaration render as two rows with an operator choice
- [ ] Identifiers render as printed, unmasked
- [ ] Reveal, promote and bulk approval are absent from this screen
- [ ] The path is clicked on a restarted `:3000` before merge

## Blocked by

- #131 — there is no widened declared set to render until the seed rows land.

Not blocked by #132: promotion is not on this screen.

## Related

`SPEC-evidence.md` and `SPEC-flows.md`, A16 beat 3.
