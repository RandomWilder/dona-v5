---
number: 173
title: An approved lease carries onto its letting
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-30
closed: 2026-09-30
---

## Problem Statement

On 30 Sep 2026 the director filed a real lease on staging through the lease-filing tab (A16),
approved every value the reader found — on A16's reading step and then on the A15 ledger — and
opened the letting it produced (דירה 13, הרב קוק 50, בית שמש). Under *מה נשא החוזה אל ההשכרה* the
rent, the option end, the assigned bay and the assigned storage all read `—`. The ledger for the same
document shows every one of them captured and approved: rent 5200 ILS, option end 2031-09-11,
parking 552, storage 505, all on page 7. Rooms (4) and floor (3) are in the same position on the
Unit. From the director's side, the system asked for a signature on each value, received it, and then
behaved as if the lease had never said any of it.

Three separate things produce that picture.

1. **Approval does not carry, and the draft carries only the dates.** Since A15, approving is a stamp
   on the evidence row and promoting is a separate command behind a `קדם` button on the ledger. When
   the approved reading establishes the draft (#110 / A2, reached from both A15 and A16), only
   `start_date` and `end_date` are promoted. Every other mapped field — `rent_amount`,
   `rent_currency`, `option_end_date`, `parking_space_number`, `storage_space_number`, `rooms`,
   `floor` — waits for a click that neither the A16 tab nor the letting page ever asks for. The
   director did not know the click existed; nothing on the path they took would have told them.
2. **The letting page hides an approved value that has not been promoted.** The captures list on the
   letting (#134) shows every approved row that is *not* a promotion target, on the reasoning that a
   target's value already lives on `tenancy`. That reasoning holds only after promotion. Between
   approval and promotion the value is on neither list, so the page reports `—` — which reads as *the
   lease does not say* when the truth is *the lease says 5200 and nobody carried it*.
3. **The building does not hold bay 552 or storage room 505.** The director attempted one `קדם` at
   07:33:54; it answered a bare `400`. The Building's inventory holds bays 21 and 24 and storage 21
   and 24 only. `parking_space_number` and `storage_space_number` resolve to a `PARKING` / `STORAGE`
   Space in the letting's Building by name, and a name that is not there is refused with *that
   parking space is not in this building*. The director has confirmed **552 and 505 are correct**:
   the lease is right and the inventory is incomplete. The refusal was correct; its delivery — an
   unexplained error page, with no route to the fix — was not.

## Solution

Approving a mapped value on a lease is the act that carries it onto the letting. When the approved
reading first establishes the draft, every mapped value that is already approved is carried with the
dates, not just the dates. When a lease is already bound to a letting, approving one more mapped
value carries that value at the same moment. The operator signs once; there is no second verb on the
normal path.

A carry that cannot land does not undo the approval and does not throw the operator onto an error
page. The approval stands, the value stays visibly *approved and not carried*, and the reason is
said in a sentence where the operator is looking: on the letting page under *מה נשא החוזה אל
ההשכרה*, and beside the row on the ledger. For an assigned bay or assigned storage whose number is
not a Space in the Building, the sentence names the number and the Building and links to נכסים'
later-add for that Building (A17), which is where the director adds bay 552 and storage room 505.
Once the Space exists, the ledger's existing `קדם` carries the value.

`קדם` stays on the ledger for what it was always for beyond the normal path: a value that could not
land at approval time, and the deliberate replace of a value already on the column (the existing
overwrite confirmation).

## User Stories

1. As an operator filing a lease on the A16 tab, I want the rent I approve to appear on the letting's
   draft, so that I do not have to find a second screen to make a signed value count.
2. As an operator, I want the rent amount and its currency to land together when both are approved,
   so that the letting never carries a price without a currency.
3. As an operator who has approved the rent amount but not yet its currency, I want the approval to
   succeed and the rent to wait, so that the order in which I sign rows does not matter.
4. As an operator, I want the option end I approve to land on the letting, so that the renewal path
   and חוזים מסתיימים see the real option date.
5. As an operator, I want the parking number I approve to become the letting's assigned bay when that
   bay exists in the Building, so that the household's bay is recorded from the lease.
6. As an operator, I want the storage number I approve to become the letting's assigned storage when
   that storage room exists in the Building, so that the household's storage is recorded from the
   lease.
7. As an operator, I want the rooms and floor I approve to land on the Unit when the Unit does not
   already hold different values, so that the flat's facts come from the lease that recites them.
8. As an operator approving the last required row, I want every mapped value I have already approved
   to be carried in the same moment the draft is written, so that rows I approved first are not left
   behind by the establishing step.
9. As an operator approving a mapped row on a lease that is already bound to a letting, I want that
   value carried at once, so that approving late is the same as approving early.
10. As an operator, I want an approval to stand even when its carry cannot land, so that a problem
    with the Building's inventory does not erase my signature on what the page says.
11. As an operator approving a parking number that is not a bay in this Building, I want to be told
    which number and which Building, so that I know the inventory is what needs fixing and not the
    reading.
12. As an operator told that bay 552 is not in this Building, I want a link to נכסים' add form for
    that Building, so that I can add it without hunting for the screen.
13. As an administrator, I want to add bay 552 and storage room 505 to the Building through A17's
    later-add, so that the inventory matches the lease without a migration or a script.
14. As an operator who has just added the missing bay, I want `קדם` on the ledger to carry the
    approved parking number, so that the value reaches the letting without re-approving anything.
15. As an operator looking at a letting, I want an approved value that has not been carried to be
    shown with its value and a mark saying it is not on the letting, so that `—` only ever means the
    lease does not say.
16. As an operator looking at a letting, I want the mark to say why the value was not carried, so that
    I know whether to fix the inventory, approve the other half of the rent, or resolve a conflict.
17. As an operator on the ledger, I want a row whose approved value is not carried to say so beside
    the row, so that the ledger and the letting page never disagree about what happened.
18. As an operator, I want a carry that would overwrite a different value already on the letting to
    stop and wait for the existing overwrite confirmation, so that approving a reading never silently
    replaces another document's truth.
19. As an operator, I want a carry that would overwrite a different rooms or floor value on the Unit
    to wait the same way, so that one lease does not quietly rewrite a flat's facts.
20. As an operator, I want an approval whose value already matches the column to count as carried, so
    that re-filing the same facts is not reported as a problem.
21. As a director, I want the letting from 30 Sep 2026 (דירה 13, הרב קוק 50) to show its rent,
    option end, bay and storage once this ships and the two Spaces are added, so that the demo path
    I clicked produces the page I expected.
22. As an operator, I want the approval screens on A15 and A16 to behave identically with respect to
    carrying, so that which door I came in by does not change what my signature does.
23. As an auditor, I want each carry to write the same `evidence.promote_field` line a `קדם` press
    writes today, naming the approver as the promoter, so that the audit trail says who made each
    value business truth.
24. As an auditor, I want an approval whose carry was refused to leave no promotion stamp, so that
    `promoted_to` means the column really holds the value.
25. As an operator without `documents.write`, I want nothing on this path to be reachable, so that
    carrying stays behind the permission that approving already needs.
26. As an operator, I want a `lease_amendment` to keep its current behaviour (A3's confirm signs and
    carries `new_end_date`), so that this change does not reopen the amendment flow.
27. As an operator, I want identifiers and names to keep having no promotion target, so that a
    household is still written by A2's act and never by a carry.
28. As an operator, I want an unapproved row never to be carried, so that 7.4's rule — only a signed
    reading becomes truth — still holds on every path.

## Implementation Decisions

- **The spec changes first, in the same change as the code.** SPEC-flows A15's *What A15 does not
  do* paragraph (which rules that approval does not promote and that A2's targets stay the two dates)
  is amended to: approval of a mapped field on a `lease` carries it when a letting is bound; A16 step
  3's *no promote* sentence is amended the same way; SPEC-evidence's A2 section (*Dates, rent and
  the option end become truth through FieldPromotion*) states that the establishing step carries
  every approved mapped field. SPEC-estate's #134 captures paragraph gains the *approved, not
  carried* row. CONTEXT.md's **Promotion** entry is unchanged — promotion is still governed, still
  requires approval, and still copies `approved_value`; only *who presses it* changes.
- **One evidence command owns the carry, and both approval doors call it.** Today both A15's and
  A16's approve routes stamp the row and then call the command that establishes the draft when the
  reading is ready. That command widens into *carry the approved lease*: if no letting is bound and
  the reading is ready, establish the draft (as now) and then carry every approved, mapped,
  uncarried row; if a letting is already bound, carry every approved, mapped, uncarried row. The
  routes do not change what they call, only what the callee does. No new route.
- **Carrying reuses `promoteExtractedField` unchanged.** The carry is a loop over rows calling the
  existing promotion command with the approver as `promotedBy` and `supersede` off. Every rule that
  command enforces — approval required, rent as a pair, occupancy and conflict, Space-in-Building
  resolution, Unit targets via the `UNIT` link — applies exactly as it does behind `קדם`.
- **A refused carry is a result, not an error.** Inside the carry loop, a `conflict` or `invalid`
  from one row is caught, that row is left uncarried, and the loop continues. The approval that
  triggered the carry has already committed and stands. The route redirects as it does today. The
  rent-pair refusal (*missing its other half*) is the expected state after approving one half and is
  treated the same way.
- **Each row carries in its own transaction.** The draft is established in its own transaction as
  now; each subsequent carry is its own `promoteExtractedField` call. One bad row therefore cannot
  roll back the draft or another row's carry. The rent pair is still one transaction inside that
  command.
- **Why a carry was refused is computed on read, not stored.** No new column and no migration. The
  read that lists a letting's approved captures widens to also return approved rows that *are*
  promotion targets but are not stamped `promoted_to`, with a reason derived from current state:
  the other rent half is unapproved; the named bay or storage room is not a Space of that kind in
  the Building; the column already holds a different value (naming it); the Unit already holds a
  different rooms / floor. The reason is recomputed each render, so adding bay 552 changes the
  sentence without anything being rewritten.
- **The letting page's carried list.** The fixed rows (rent, option end, assigned bay, assigned
  storage) show the column's value when set. When the column is empty and an approved, uncarried
  row exists, the row shows the approved value, the page it came from, and a mark *מאושר, לא הועבר
  להשכרה* with the reason sentence. Rooms and floor, which land on the Unit, appear in the captures
  list with the same mark when uncarried. `—` is reserved for *nothing approved*.
- **The ledger shows the same state beside the row.** A15's ledger marks an approved, uncarried
  mapped row with the same reason sentence beside its `קדם` button. A16's reading step shows the
  sentence and no button, keeping A16's ruling that promote is not on that tab.
- **The missing-Space sentence links to A17.** For *not in this building*, the sentence names the
  number and the Building and links to the נכסים Building page's later-add, preselecting the kind
  (parking or storage) and the number where that form accepts it. The lease never creates a Space:
  A17's rule that paper fills the inventory and does not create it stands. Adding the Space is an
  administrator's act under `estate.write`, audited as `estate.inventory_add`.
- **No backfill job.** Leases already established with approved, uncarried rows become visible
  through the new mark and are carried by `קדם` on the ledger. The staging letting from 30 Sep 2026
  is carried that way after the director adds bay 552 and storage 505 through A17.
- **Out-of-order approval.** Approving `rent_amount` before `rent_currency` leaves both uncarried
  with the *other half* reason; approving the second half triggers the carry, which lands both in one
  transaction.
- **Amendments are untouched.** The widened command acts only on `lease`. `lease_amendment` keeps
  A3's confirm, which already signs and carries `new_end_date` with `supersede`.

## Testing Decisions

- **A good test here drives the HTTP routes and reads the pages**, as the A16 suite does: sign in,
  post approvals, then GET the letting page and the ledger and assert on what an operator would see
  and on the typed columns. No test reaches into the carry loop or asserts on which function was
  called. The promotion command's own rules are already proved in the promotion suite and are not
  re-proved here.
- **One seam: the approval routes.** Both `/documents/filing/:id/approve` (A16) and
  `/documents/:id/fields/approve` (A15), with the letting page and the ledger as the read side.
  Every behaviour in this spec is observable from there. No new seam is proposed.
- **Cases, each red first:**
  - A16, approve all rows in an order that leaves rent, option end, bay and storage approved
    *before* the reading is ready: the draft carries all of them; the letting page shows 5200 ILS,
    the option end, the bay name and the storage name.
  - A15, approve rent, option end, bay and storage *after* the draft exists: each lands on approval.
  - Approve `rent_amount` alone: approval succeeds, letting page shows the approved amount with the
    *other half* mark; approve `rent_currency`: both land.
  - Approve a parking number and a storage number that are not Spaces in the Building: approvals
    succeed with a redirect, not a 400; letting page and ledger show the *not in this building*
    sentence naming the number and link to A17 later-add; after adding the Space through A17's
    route, `קדם` on the ledger lands it and the mark disappears.
  - A value that differs from one already on the column (a second lease on the same letting): not
    carried, marked with the conflict reason naming the held value; the existing overwrite
    confirmation still works.
  - Rooms and floor land on the Unit through approval; a Unit already holding a different rooms
    value is left alone and marked.
  - An unapproved mapped row is never carried and never shown on the letting.
  - A carry writes `evidence.promote_field` with the approver as actor; a refused carry writes no
    stamp.
- **Prior art:** the A16 lease-filing suite (HTTP-driven, fake extractor and OCR, real migrated
  database); the tenancy-card suite for asserting on the letting page's carried list; the promotion
  suite for the refusal messages this spec now surfaces instead of throwing.
- **No golden-set run is owed:** no prompt, model id, retrieval config or tool definition changes.
  No policy case is owed: no new deterministic constraint — the carry applies existing ones.

## Out of Scope

- **The guarantor.** The ledger shows `guarantor_name` and `guarantor_id_number` as *not read — an
  optional field* on this lease. Whether the lease names a guarantor the reader missed is a question
  for the director; if it does, the fix is an extraction-hint change with a full golden-set run, and
  it is its own ticket.
- Creating a `PARKING` or `STORAGE` Space from a lease. The lease cites; A17 creates.
- A backfill job over existing leases.
- Changing how `lease_amendment` carries `new_end_date`.
- A promotion target for any field that has none today (deposit, maintenance, promissory note,
  parcel keys, building number, apartment type, `has_storage`). Those remain display-only captures.
- Moving `קדם` onto the A16 tab.

## Further Notes

- Evidence for the problem: staging request log for document `01a0f136-618d-7b4a-a5bf-c8711cebc99f`
  on 30 Sep 2026 — A16 approvals 07:31–07:32, A15 approvals 07:33, one `POST …/promote` → `400` at
  07:33:54; the ledger at `/documents/01a0f136-…/fields` lists 26 approved rows and seven pending
  `קדם` buttons (floor, option end, parking, rent, rent currency, rooms, storage); the letting
  `01a0f13a-7c0c-7a22-be93-8bc3263ff8ab` offers bays and storage 21 and 24 only.
- The director confirmed on 30 Sep 2026 that bay 552 and storage room 505 are correct and the
  Building's inventory is what is missing them. Adding them on staging is an A17 later-add by an
  administrator; it is not part of the code change and not something an agent does unasked.
- The request log carries method, URL, status and latency only; the application writes no line of
  its own on a refused promotion, which is why the 400 had to be reconstructed from state. Whether
  refusals should log is a separate question and not decided here.

## Comment — 2026-09-30

Closed. All three children are closed. Approving a mapped field on a lease carries it onto the letting; an approved value that did not land is shown with the reason; a missing bay or storage room links to נכסים' later-add and קדם no longer answers 400.

- [#174](0174-approving-a-mapped-lease-field-carries-it.md) — approval carries the mapped fields.
- [#175](0175-an-approved-value-not-on-the-letting-says-so.md) — an uncarried approval is marked, and says why.
- [#176](0176-a-missing-bay-routes-to-inventory-add.md) — a missing bay routes to later-add.

The screen was not clicked on :3000. The app asks for a Google sign-in, and filing a made-up lease into the local database was refused. The letting page, the ledger, the reading step and קדם were read through the approval routes. An approved rent or option end that never landed — nothing blocking it, as on the 30 Sep lease — shows the mark on the letting, beside קדם, and on the reading step, with no extra sentence. The staging letting from 30 Sep 2026 is carried by the director after this ships, once bay 552 and storage 505 are added through A17. No next child.
