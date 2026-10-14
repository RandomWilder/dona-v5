---
number: 238
title: "ממתינים לפתיחה in שכירויות"
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

A lease one step short of a tenancy is visible where tenancies are looked for. At the top of **שכירויות**, for a role holding `documents.write`, a **ממתינים לפתיחה** section lists every `lease` document with no `TENANCY` link. Each row shows the upload date, the main tenant name as read (or a mark that none was read), and a link to the file. Its action is:
- **פתח טיוטה** when the reading is ready;
- **המשך קריאה**, back to הקריאה, when it is not.

The list does not depend on #237. Before it, an unopened lease filed on a flat is listed the same way. When the list is empty, the section is not shown.

Spec: SPEC-flows A16 as amended at #232.

## Acceptance criteria

- [x] A lease with no tenancy link appears in the section with date, name read, file link, and the right action for its reading state.
- [x] Opening the draft removes the lease from the list.
- [x] A role without `documents.write` does not see the section.
- [x] No unopened leases: no section, no empty heading.
- [x] HTTP test at the app seam.
- [x] Clicked on `:3000`.

## Comment — 2026-10-14

Evidence owns the read: `listUnopenedLeases` lists every `lease` document with no `TENANCY` link,
newest first. Each row carries the upload day, the main tenant as read, the stored uri and whether
הקריאה is ready. The name is the signed correction when there is one, else the first capture, and
it falls back to the September `tenant_name` the same way `leaseReadingGaps` does; both now share
one helper. Ready means `leaseReadingGaps` returns nothing, the same test הקריאה uses. The
composition root signs each file the way the documents panel is signed (`signLinkedDocuments` is
now generic over anything with a `storageUri`). Estate prints the section above the book only
when the role holds `documents.write` and the list is not empty.

The test is the missing link, not the unassigned path, so a lease filed on a flat before #237 is
listed and opens the same way. SPEC-evidence and SPEC-flows A16 now say so. The hidden-buildings
crawl no longer walks into each filing workspace, because the new section links every unopened
lease in the shared test database and that exhausted its 200-screen cap.

Two things are left as they are, on purpose. First, the list reads each lease's fields one by
one. On the local test database that is 4,706 leftover rows and the page takes 0.9 s; on staging
it is a handful. Second, the section is gated on `documents.write` while פתח טיוטה's route needs
`tenancy.write`. Every role today holds both or neither. A role that splits them would see a
button that refuses.

Clicked on `:3000` while signed in. The section rendered at the top of שכירויות. A ready row's
פתח טיוטה opened the פתיחת טיוטה screen, and an unready row's המשך קריאה opened הקריאה (200). The
removal after opening is proven by the HTTP test. The full suite passed with 1203 tests, plus the
41 hook tests.

## Blocked by

- #234
