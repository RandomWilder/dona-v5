---
number: 170
title: Every estate link and redirect to a building lands on נכסים
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

Within `src/estate/`, everything that sends an administrator to a building or the building list
sends them to נכסים:

- The unit page's back link → `/estate/inventory/:buildingId`, still labelled with the building name.
- The נכסים list's לדף הבניין → `/estate/inventory/:buildingId`.
- Search results: building hits and document hits that open a building → the נכסים building page.
- A13 (`/estate/buildings/:id/units/new`): back link and ביטול → the נכסים building page;
  `POST /estate/buildings/:id/units` 303s there.
- A11 (`/estate/buildings/new`): back link and ביטול → `/estate/inventory`; `POST /estate/buildings`
  303s to `/estate/inventory` when it is not carrying the filing walk. The filing walk's redirect
  into A13 is unchanged.

The old list and old building page keep their own links: they are hidden, not rewired.

SPEC-estate.md is edited in the same change, before the code (A11 and A13's redirect sentences, the
unit page, search, and the נכסים list's לדף הבניין sentence).

## Acceptance criteria

- [x] Each link and redirect above targets the נכסים page, asserted on `href` and `location`
- [x] A11 carrying the filing walk still continues into A13 exactly as before
- [x] `/estate` and `/estate/buildings/:id` still render
- [x] SPEC-estate.md edited in the same change
- [x] Clicked on `:3000` after a restart: list → flat → back; search → building; A13 save and
      cancel; A11 save and cancel

## Blocked by

- [#168](0168-the-inventory-building-page-carries-the-old-page.md)

## Comment — 2026-09-29

The unit page's back link, the נכסים list's לדף הבניין, a building found by search, and A11 and A13's back, cancel, and ordinary save now land on נכסים. A save that is carrying the filing walk still continues into the new-apartment form, and saving that apartment while the walk is carried still returns to the document with the new flat as the anchor — that return is what lets the walk finish. A document found by search still opens the document. The old list and the old building page keep their own links. Checked on the restarted server: list to flat to back, search to building, A11 and A13 save and cancel. The browser stopped at Google sign-in, so the same paths were driven against the server as a signed-in administrator. The temporary building used for the saves was removed.
