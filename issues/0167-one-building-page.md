---
number: 167
title: "One building page: נכסים is the only estate drill, both ways"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-29
closed: 2026-09-30
---

## Problem Statement

The estate has two drills over the same rows. בניינים (`/estate`, `/estate/buildings/:id`) is the
original; נכסים (`/estate/inventory`, `/estate/inventory/:id`) is its improvement and where every
inventory change since #149 has gone. The administrator goes *into* a flat from a נכסים tile, but
every way *out* lands in the old flow: the unit page's back link, the list's לדף הבניין button, six
document screens, and the search results all point at `/estate/buildings/:id`, whose own back link
is the old בניינים list. The office works in one tree and is quietly moved to the other.

The old building page is not simply redundant. It carries things the נכסים building page does not:
the building's facts, its documents, the bays and stores no flat points at, the דירה חדשה door, and
the building-bound document Q&A panel.

## Solution

The נכסים building page, `/estate/inventory/:buildingId`, becomes the one building page. It takes
the old page's content, redesigned in the נכסים style, as painted in `mockups/building.html` and
approved on 2026-09-29. Every link and redirect that ends on a building lands there; every link that
ends on the building list lands on `/estate/inventory`. The בניינים rail tab is hidden and the home
card points at נכסים.

**Nothing is deleted.** `/estate`, `/estate/buildings/:id`, and their posts stay registered and
served, linked from nowhere. A11 (`/estate/buildings/new`) and A13
(`/estate/buildings/:id/units/new`) stay as they are, because the filing flow carries its walk
through them in hidden inputs that the נכסים create form does not accept; only their back, cancel,
and after-post destinations move.

## User Stories

1. As an administrator, I want the building page I open from נכסים to show the building's facts — handover, end of warranty, tender, gush, helka, building number — so that I do not need a second page for them.
2. As an administrator, I want the four headline numbers at the top of the building page — flats, let today, vacant flats, vacant parking — so that the building reads at a glance.
3. As an administrator, I want the building's spaces as the same drill the נכסים list uses, flats first and open, so that the building page and the list are one design.
4. As an administrator, I want each flat tile on the building page to carry floor, rooms, and area under its word, so that the old flat cards are not needed.
5. As an administrator, I want a flat tile to open the unit page, as it does on the list.
6. As an administrator who may shape the estate, I want דירה חדשה on the building page, opening the existing A13 form for this building.
7. As an administrator who may file, I want הוספת מסמך on the building page, opening the existing document upload.
8. As an administrator, I want the building's documents listed on the building page.
9. As an administrator who may shape the estate, I want the bays and stores no flat points at listed on the building page with their remove control, and to land back on the building page after removing one.
10. As an administrator who may shape the estate, I want adding and removing spaces, and adding a shared place, collapsed under עריכת המלאי at the bottom, so that the page reads as a building first.
11. As an administrator arriving from the list's הוספת חללים or מקום משותף, I want that editing section already open.
12. As a holder of `documents.read`, I want the building's document Q&A panel on the building page, asking and clearing without leaving it.
13. As an administrator, I want the unit page's back link to return to that building's נכסים page.
14. As an administrator, I want the list's לדף הבניין button to open the נכסים building page.
15. As an administrator, I want every document screen that returns to a building to return to its נכסים page.
16. As an administrator, I want a building found by search to open its נכסים page.
17. As an administrator, I want A11 and A13's back and cancel links, and where they land after saving, to be נכסים pages.
18. As an administrator, I want no בניינים tab in the rail and the home card for buildings to open נכסים.
19. As an administrator with an old bookmark, I want `/estate` and `/estate/buildings/:id` to keep working.
20. As a viewer without `estate.write`, I want the building page without any write control.

## Implementation Decisions

- The one building page is `GET /estate/inventory/:buildingId`. Its route gathers what `GET /estate/buildings/:buildingId` gathers today (building detail, units, unassigned spaces, the building's linked documents, the occupancy injection, the retrieval view) in addition to what it already gathers. No new read model is needed; the old page's reads are reused.
- The flat tiles on the building page are the list's tiles, rendered by one shared function, not a second copy. The floor · rooms · area line comes from the unit row; a missing floor or area is left out of the line.
- The building's Q&A panel gets `POST /estate/inventory/:buildingId/office-turn` and `…/office-thread`, running the same office-turn command bound to the same Building and 303ing back to the נכסים page (with `ask=unavailable` on `unavailable`). The thread is the same thread the old page shows, because it is keyed by account and Building. The old building routes are untouched.
- A13's `POST /estate/spaces/:spaceId/remove` and `POST /estate/buildings/:buildingId/units` 303 to the נכסים building page. A11's `POST /estate/buildings` 303s to `/estate/inventory` when it is not carrying the filing walk; the filing walk's redirect into A13 is unchanged.
- The הוספת מסמך door on the building page opens `/documents/new` with no unit, flow A12, whose address search places the paper. Preselecting the building on that screen is out of scope.
- "Hidden" means: the rail item is gone, and no rendered screen other than the old pages themselves and A11/A13 links to `/estate` or `/estate/buildings/:id`. The routes stay registered with their tests.
- SPEC-estate.md (and SPEC-evidence.md where evidence screens change) is edited in each ticket's change, before the code. The נכסים section stops saying בניינים routes and views are unchanged and states the hidden rule.
- `mockups/building.html` is deleted in the ticket that wires its last part (the Q&A panel).

## Testing Decisions

A good test asserts what an administrator sees and where a link or redirect goes: section present, fact printed, control present or absent by permission, `href` and `location` targets. It does not re-test derivations the tiles already test (vacancy, the flat's word, the letting chips).

Seam: the rendered office pages through `app.inject`, the seam `src/estate/inventory.test.ts` already uses. Existing assertions that expect `/estate/buildings/:id` as a back link or redirect target are rewritten to the נכסים target. A final test renders every signed-in screen reachable in the fixture and fails on any link to `/estate` or `/estate/buildings/:id` outside the old pages and A11/A13.

No prompt, model, retrieval config, or tool definition changes, so the golden set does not run. No policy case: no new deterministic constraint.

Each ticket is clicked on `:3000` after a restart.

## Out of Scope

Deleting the בניינים routes or views. Merging A11 into the נכסים create form. Preselecting the building on the upload screen. Changing the unit page beyond its back link. Changing the נכסים list beyond its לדף הבניין target.

## Further Notes

Children, in order:

- [x] [#168](0168-the-inventory-building-page-carries-the-old-page.md) — the page takes the old content
- [x] [#169](0169-the-building-qa-panel-on-the-inventory-page.md) — the Q&A panel; the paint is deleted
- [x] [#170](0170-estate-exits-land-on-inventory.md) — estate's own links and redirects
- [x] [#171](0171-document-screens-return-to-inventory.md) — evidence's links
- [x] [#172](0172-hide-the-buildings-tab.md) — hide the tab, repoint home, the no-old-link test

#166 goes first so the suite is green before any of this starts.

## Comment — 2026-09-30

Closed. All five children are closed. #166 landed first so the suite was green.

- [#168](0168-the-inventory-building-page-carries-the-old-page.md) — the נכסים building page carries the old page.
- [#169](0169-the-building-qa-panel-on-the-inventory-page.md) — the document Q&A panel is on that page; the paint is gone.
- [#170](0170-estate-exits-land-on-inventory.md) — estate exits that open a building land on נכסים.
- [#171](0171-document-screens-return-to-inventory.md) — document screens return to נכסים.
- [#172](0172-hide-the-buildings-tab.md) — בניינים is hidden; home opens נכסים.

No next child. A new session does not pick work from here.
