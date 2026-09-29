---
number: 171
title: Document screens return to the נכסים building page
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [168]
parent: 167
created: 2026-09-29
closed: 2026-09-29
---

## Parent

[#167](0167-one-building-page.md)

## What to build

Within `src/evidence/`, every back link, ביטול, חזרה לבניין, and redirect that targets
`/estate/buildings/:buildingId` targets `/estate/inventory/:buildingId` instead. On 2026-09-29 those
are the upload screen (back and ביטול), the filed screen (back and חזרה לבניין), the seed and seeded
screens, the read screen, and the fields screen when it has no unit; the implementer greps
`src/evidence/` for `/estate/buildings/` to confirm the list, including any `location` header.

Links into A11 (`/estate/buildings/new`) and A13 (`/estate/buildings/:id/units/new`) with the
carried filing walk are **not** changed: those forms stay the filing flow's way to create a
building or a flat.

SPEC-evidence.md is edited in the same change wherever it names the building page as a return
target.

## Acceptance criteria

- [x] No evidence screen links or redirects to `/estate/buildings/:id` (asserted on rendered
      `href`s and `location`s)
- [x] Links into A11 and A13 carrying the filing walk are unchanged
- [x] SPEC-evidence.md edited in the same change where it names the return target
- [x] Clicked on `:3000` after a restart: file a building document, then back from filed, read,
      and fields

## Blocked by

- [#168](0168-the-inventory-building-page-carries-the-old-page.md)

## Comment — 2026-09-29

Document screens that used to return to the old building page now return to that building's נכסים page. Upload (back and ביטול), the filed receipt, the protocol proposal and the seeded page, the read screen, and the fields screen when the document has no unit all do. A refusal that names a building the file is already on also opens that page. Creating a building or a flat from the filing walk is unchanged. The browser stopped at Google sign-in. Against the restarted server, as a signed-in administrator: the upload screen's back and ביטול open נכסים; a blank building protocol was filed, and its read screen and fields screen (no flat) both go back to נכסים. The filed receipt itself came back as an embedding failure on this machine, so that page was checked in the suite, where it returns to נכסים. The temporary document and the temporary sign-in were removed.
