---
number: 238
title: "ממתינים לפתיחה in שכירויות"
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

A lease one step short of a tenancy is visible where tenancies are looked for. At the top of **שכירויות**, for a role holding `documents.write`, a **ממתינים לפתיחה** section lists every `lease` document with no `TENANCY` link. Each row shows the upload date, the main tenant name as read (or a mark that none was read), and a link to the file. Its action is:
- **פתח טיוטה** when the reading is ready;
- **המשך קריאה**, back to הקריאה, when it is not.

The list does not depend on #237. Before it, an unopened lease filed on a flat is listed the same way. When the list is empty, the section is not shown.

Spec: SPEC-flows A16 as amended at #232.

## Acceptance criteria

- [ ] A lease with no tenancy link appears in the section with date, name read, file link, and the right action for its reading state.
- [ ] Opening the draft removes the lease from the list.
- [ ] A role without `documents.write` does not see the section.
- [ ] No unopened leases: no section, no empty heading.
- [ ] HTTP test at the app seam.
- [ ] Clicked on `:3000`.

## Blocked by

- #234
