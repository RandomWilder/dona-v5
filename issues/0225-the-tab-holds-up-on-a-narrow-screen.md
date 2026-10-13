---
number: 225
title: The tab holds up on a narrow screen
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [218, 221, 224]
parent: 216
created: 2026-10-13
closed: 2026-10-13
---

## Parent

#216 — The קריאות tab matches the approved screens.

## What to build

Every קריאות screen holds up when the window is narrow, and the whole tab is clicked through once
the pieces are in place.

On a narrow phone-width screen the stat row is two columns, a call row wraps so the status and the
age sit under the text, the call page's aside stacks above the conversation, the eight steps
collapse to one line, the log dialog becomes a sheet, and the filtered cards are a single column.
The default call list already shows only the list view below the split-inbox width.

Targets are tall enough to hit. Small buttons and segments may be the shorter height the assets
screens already use. Focus is visible on the radio segments and the option rows. Forward points
left and back points right. Inbound messages sit on the start side and office echoes on the end
side. Numbers, emails, and file names read left to right. Reduced motion stays as the rest of the
product already handles it.

No new behaviour. A mockup painted for this flow is deleted once this pass finds the flow wired.

## Acceptance criteria

- [x] Phone width: two stat columns, wrapped call rows, the aside above the conversation, a one-line indicator, a sheet for the dialog, and a single column of filtered cards
- [x] The default call list is the list view below the split width, and the split inbox above it
- [x] Interactive targets meet the tap height, focus is visible on radio segments and option rows, and the chevrons, bubbles, and left-to-right strings match the Hebrew page
- [x] Every path is clicked on `:3000`: log a call both channels, named and unknown, plus a refusal; each segment and menu; split and list view; a narrow width; open a call; identify; set a category; save a contact; flag and clear; close with each exit plus a refusal; return to filtered; rescue both origins; split selection; a closed call
- [x] Any mockup painted for this flow is gone

## Comment — 2026-10-13

The narrow pass changed layout and markup only. Below 40rem the stat row is two columns, the segments wrap so the current one stays in view, the eight steps are one line of dots with the current state named, the log dialog is a sheet on the bottom edge, and the filtered cards stay one column. The aside is first in the markup, so it sits above the record. The conversation puts the inbound message on the start side and the office echo on the end side. A file name is marked left to right, and so is any sender or actor label with no Hebrew in it. Back links carry a chevron pointing right and forward links one pointing left. Radio labels are the touch height and draw the focus ring, and a whole list row is the link. `src/calls/narrow.test.ts` asserts the direction marks and the chevrons. It was red first.

Clicking found two overflows that the tests could not see. The closed list's two segment rows widened the auto grid track to 437px on a 375px phone, so the tab's grids are now `minmax(0, 1fr)`. Every glass-stage page also scrolled 8px sideways on a phone. The cause was the shared ambient layer (`.glass-stage::before`, inset −24px) against the 16px phone gutter, and it is fixed in `tokens.css`, which covers the assets screens too. Every calls screen now measures 0px of sideways overflow at 320px and 375px.

Clicked on a local server built from this branch. Port 3000 was held by another session's stale server, so this one ran on an auto-assigned port. The paths clicked: logging both channels, named and unknown, plus a refusal; every segment, both menus, and cancel keeping the filter; split, list, and split selection; identify; the category; save contact; flag and clear; all four exits plus a refusal; return to filtered; rescue from both origins; a closed call, with and without the receipt; and the closed list. The sorter-origin row and an office echo were seeded straight into the local database, so as not to call the paid sorter. No mockup existed for this flow.

## Blocked by

- #218 — Logging a call is a dialog on the list
- #221 — The filtered list narrows by origin
- #224 — The closed list shows the last thirty days
