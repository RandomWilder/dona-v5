---
number: 244
title: The flat is preselected from the approved address
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 243
created: 2026-10-15
closed:
---

## What

On פתיחת טיוטה, the flat is resolved from the lease's **approved** `address` and `apartment_number`,
not from the regex place reading stored at upload (ADR-0016, SPEC-evidence *Resolution*, SPEC-flows
A2).

- **Building the reading.** `address` is split at its first comma: the street and number before it,
  the town after it. No comma means no town. The result goes to `resolvePlace` unchanged:
  - exact key first;
  - then the street search, narrowed to the same street and then the apartment (#242);
  - never a unit on the fallback.
- **Preselection order:**
  1. the document's anchor, for a lease filed on a flat before #237;
  2. the flat from the unit-page upload door;
  3. the exact match from the approved address.
- **An unapproved `address`** preselects nothing. The screen says the address has not been approved
  yet and offers search.
- The stored place reading is no longer read for a lease. #246 stops writing it.
- `building_number` is not used: SPEC-estate rules it an identifier, not a key.

#242's narrowing is already on this branch, in PR #139, which stays open. That narrowing is the fallback here. Do not merge #139 before this ticket.

## Acceptance

- [ ] **Red first:** a regex reading with the wrong town and an approved `address` of
      `רקפת 12, שוהם` with `apartment_number` `6` (invented values) preselect flat 6 at that address.
- [ ] An approved address with no town lists the same-street flat 6 as the one candidate, unchecked.
- [ ] An unapproved address preselects nothing, and the screen says why.
- [ ] Existing A16 route tests stay green. The test "exact one flat is preselected at opening"
      approves the address first.
- [ ] A read-only check against staging: `01a13e3f` preselects flat 6 at building 205, and
      `01a13956` keeps flat 13.
