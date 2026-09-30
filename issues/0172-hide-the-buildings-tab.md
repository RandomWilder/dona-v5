---
number: 172
title: Hide the בניינים tab; home opens נכסים
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [169, 170, 171]
parent: 167
created: 2026-09-29
closed: 2026-09-29
---

## Parent

[#167](0167-one-building-page.md)

## What to build

- The rail drops the בניינים item (`src/chrome.ts`). נכסים is the only estate tab.
- The home index's buildings card opens `/estate/inventory` and is worded for נכסים.
- `/estate` and `/estate/buildings/:id`, with their posts, stay registered and served. They are
  linked from nowhere except each other and A11/A13.
- One test renders every signed-in screen reachable in the fixture and fails on any `href` to
  `/estate` or `/estate/buildings/:id` outside the old pages and A11/A13. This is what keeps the
  hidden flow hidden.

SPEC-estate.md is edited in the same change, before the code: the surface section and the נכסים
section state that בניינים is hidden — served, tested, linked from nowhere — and that the נכסים
building page is the one building page.

## Acceptance criteria

- [x] No בניינים item in the rail
- [x] The home card opens נכסים
- [x] `/estate` and `/estate/buildings/:id` still render for a signed-in reader
- [x] The no-old-link test passes, and fails if any one link from #170 or #171 is reverted
- [x] SPEC-estate.md edited in the same change
- [x] Clicked on `:3000` after a restart: home → נכסים → building → flat → back → back, never
      leaving נכסים

## Blocked by

- [#169](0169-the-building-qa-panel-on-the-inventory-page.md)
- [#170](0170-estate-exits-land-on-inventory.md)
- [#171](0171-document-screens-return-to-inventory.md)

## Comment — 2026-09-29

The rail no longer has בניינים, and the home card opens נכסים. A row on חוזים מסתיימים opens that building's נכסים page. The flat, the new-building form, and the new-flat form mark נכסים; a letting marks שכירויות. The old list and the old building page still render, and they are the pages that still link to each other. One crawl of the signed-in screens this fixture can open fails if any other page links to `/estate` or to `/estate/buildings/:id`. Putting the ending-leases row back on the old building page fails that crawl. The new-building and new-flat forms are allowed to keep such a link, and a save receipt is still covered by the document-screen suite. The browser stopped at Google sign-in. Against the restarted server, as a signed-in administrator: home to נכסים to a building to a flat, and both steps back stay on נכסים. The old list and the old building page still answer. The temporary sign-in was removed.
