---
number: 169
title: The building's document Q&A panel on the נכסים building page
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

The #121 panel — same split, same collapse, same checkbox-and-label pattern — on
`GET /estate/inventory/:buildingId` for a signed-in holder of `documents.read`.

New posts `POST /estate/inventory/:buildingId/office-turn` and
`POST /estate/inventory/:buildingId/office-thread` run the same office-turn command and thread clear,
bound to the same Building, and 303 back to the נכסים building page. On `unavailable` the turn 303s
to that page with `ask=unavailable` and the panel paints the frozen Hebrew notice. CSRF and a
session on both; VIEWER may ask; no new permission. The panel's form actions come from the page the
panel is on, not from a hard-coded `/estate/buildings/` prefix.

The thread is the one the old page shows, because it is keyed by account and Building. The old
building routes are untouched.

`mockups/building.html` is deleted in this change: the paint is fully wired.

SPEC-estate.md's #121 paragraph is edited in the same change, before the code.

## Acceptance criteria

- [x] A `documents.read` holder sees the panel on the נכסים building page; others do not
- [x] Asking posts to the new route and returns to the נכסים building page with the turn painted
- [x] `unavailable` returns to the same page with the frozen notice and an unchanged thread
- [x] Clearing wipes only this account's thread for this Building and returns to the same page
- [x] A thread started on the old page shows on the new page, and the reverse
- [x] The Unit panel is unchanged
- [x] `mockups/building.html` deleted
- [x] SPEC-estate.md edited in the same change
- [x] Clicked on `:3000` after a restart: ask, hide, show, clear

## Blocked by

- [#168](0168-the-inventory-building-page-carries-the-old-page.md)

## Comment — 2026-09-29

The נכסים building page now carries the same document Q&A panel as the old building page. Asking and clearing post to this page and return to it, and the thread is the one the old page shows, because it is keyed by account and Building. The building paint is gone. Checked on the restarted server: ask, hide, show, and clear.
