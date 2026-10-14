---
number: 239
title: "One approval screen for leases"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed: 2026-10-14
---

## Parent

#232: A lease is unassigned until its draft opens ([0232](0232-a-lease-is-unassigned-until-its-draft-opens.md)).

## What to build

A lease is approved in one place, with one meaning per press:
- `/documents/:id/fields` for a `lease` redirects to A16's הקריאה for that document. A15 stays the ledger for every other type, and both call one approval command.
- הקריאה gains one `אישור כל מה שלא סומן`. It approves every unapproved row except the **identity-and-access set**:
  - every name, identifier, phone and email row;
  - start date and end date;
  - the read address fields;
  - every row A15 would flag for read quality.

  Those are sorted to the top and stay one press each.
- A second press on an already-approved row is a sentence on the step, not an error page.
- Once the document has a `TENANCY` link, its reading is closed. Approval and correction on its rows refuse with a sentence that points to the person or tenancy, where the correction is made with the reading shown beside the record (#229's display).

Spec: SPEC-flows A15 and A16 as amended at #232.

## Acceptance criteria

- [x] A15 on a lease redirects to A16's הקריאה. A15 on another type is unchanged.
- [x] "Approve the rest" stamps every row outside the identity-and-access set and leaves every row inside it unapproved.
- [x] On a fixture lease of about 30 rows, the remaining deliberate presses are only the identity-and-access rows.
- [x] A double press on one row shows a sentence and stays on the step.
- [x] After opening, approving or correcting a row of that document is refused with a sentence and a link to the tenancy.
- [x] HTTP tests at the A16 and A15 seams.
- [x] Clicked on `:3000`.

## Comment — 2026-10-14

The identity-and-access set is one predicate, `pressedAlone` in `src/evidence/internal/approve.ts`.
`approveUnflagged` uses it to choose what to skip, and both screens use it to choose what goes at the
top, so the rows at the top are exactly the rows the press leaves. On a lease the set is:
- every name, identifier, phone and email row;
- `start_date` and `end_date`;
- `address`, `apartment_number` and `building_number`;
- every row read below 0.8 or never measured.

On הקריאה those rows sit under a heading, כל שורה באישור משלה, and everything else sits under השאר.
Each part keeps the dates, money, people and place groups. That way a native PDF, where every row is
unmeasured and so every row is its own press, still reads in groups.

The reading is closed at the routes, not in `approveExtractedField`, so A2's and A3's confirm screens
still sign their dates. Both approve routes answer 409 with a sentence and a link to the tenancy. The
issue says "person or tenancy". The tenancy is the one place a correction is shown beside what the
paper said (#229), so the link goes there and not to a person.

The first criterion was read as applying while the draft is unopened. Once the draft is open, A15 on
that lease no longer redirects. A16's tab has moved on to הטיוטה by then. A15 shows the reading
closed, with no אישור and no bulk press, and keeps `קדם`. `קדם` stays because a bay or storage space
added to the Building after the opening still has to land.

The carry that ran on approval is gone. `carryBoundLease` had no caller left once a bound lease
stopped taking approvals. Thirty-odd existing tests that approved rows after opening, or that read a
lease on A15, were moved to approve before opening, or to read on A16. One test was removed: the one
proving a late approval carries.

One wording is now out of date. The tenancy page's half-rent sentence ("החצי השני של דמי השכירות
טרם אושר") suggests an approval that can no longer happen after opening.

Clicked on `:3000`. The local test lease used was 01a13bb2; its address was "עיר בדיקה" and three
synthetic rows were added to it.
- A15 redirected to הקריאה.
- The two parts rendered, along with the bulk button, its count chip (its missing space is fixed)
  and its hint.
- The bulk press approved the three rows outside the set and left the five set rows.
- A second press got 409 and the sentence above הקריאה.
- On an opened lease, A15 rendered closed with the link, and a bulk post to A16 got 409 with the
  sentence and the tenancy link.

The full suite passed.

## Blocked by

- #234
