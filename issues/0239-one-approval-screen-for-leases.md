---
number: 239
title: "One approval screen for leases"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed:
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

- [ ] A15 on a lease redirects to A16's הקריאה. A15 on another type is unchanged.
- [ ] "Approve the rest" stamps every row outside the identity-and-access set and leaves every row inside it unapproved.
- [ ] On a fixture lease of about 30 rows, the remaining deliberate presses are only the identity-and-access rows.
- [ ] A double press on one row shows a sentence and stays on the step.
- [ ] After opening, approving or correcting a row of that document is refused with a sentence and a link to the tenancy.
- [ ] HTTP tests at the A16 and A15 seams.
- [ ] Clicked on `:3000`.

## Blocked by

- #234
