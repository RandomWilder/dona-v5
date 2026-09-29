---
number: 168
title: The נכסים building page carries what the old building page had
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [166]
parent: 167
created: 2026-09-29
closed: 2026-09-29
---

## Parent

[#167](0167-one-building-page.md)

## What to build

`GET /estate/inventory/:buildingId` becomes the page painted in `mockups/building.html`, minus the
Q&A panel (#169):

- Header: back link ← נכסים, building name, status chip, address. For `estate.write`: דירה חדשה →
  `/estate/buildings/:id/units/new` (A13). For a viewer who may file: הוספת מסמך → `/documents/new`.
- Stat row: flats, let today with the meter, vacant flats, vacant parking. Replaces today's headline
  chips.
- פרטי הבניין card: handover, end of warranty, tender, gush, helka, building number — the old
  page's facts; absent optional facts are left out.
- The spaces as the list's drill, one section per kind, flats first and open, using the list's tile
  renderer (shared, not copied). Flat tiles add a floor · rooms · area line from the unit row.
- חניות ומחסנים ללא שיוך with A13's remove control, hidden when empty. A13's
  `POST /estate/spaces/:spaceId/remove` now 303s to this page.
- מסמכי הבניין: the building's linked documents, as on the old page.
- עריכת המלאי, collapsed at the bottom: today's per-space remove, הוספת חללים, and מקום משותף forms,
  unchanged in what they post. Arriving from the list's הוספת חללים or מקום משותף opens it.

SPEC-estate.md's נכסים section is edited in the same change, before the code.

## Acceptance criteria

- [x] The page shows the header, stat row, facts card, drill, unassigned panel, documents, and
      editing section as painted
- [x] Flat tiles are rendered by the same function as the list's and carry floor · rooms · area
- [x] דירה חדשה, the remove controls, and עריכת המלאי appear only for `estate.write`; הוספת מסמך
      only for a viewer who may file
- [x] Removing an unassigned bay lands back on this page
- [x] The list's הוספת חללים and מקום משותף land with עריכת המלאי open
- [x] The add, shared, and remove posts behave as before and 303 to this page
- [x] SPEC-estate.md edited in the same change
- [x] Clicked on `:3000` after a restart, as admin and as a viewer

## Blocked by

- [#166](0166-inventory-remove-test-survives-a-leftover-document.md)

## Comment — 2026-09-29

The נכסים building page now carries the old page's header, facts, unassigned bays, and documents, with the list's tiles and the inventory edit section collapsed at the bottom. Checked on the restarted server as an admin and as a viewer.
