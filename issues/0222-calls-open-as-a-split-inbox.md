---
number: 222
title: Calls open as a split inbox
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [217]
parent: 216
created: 2026-10-13
closed: 2026-10-13
---

## Parent

#216 — The קריאות tab matches the approved screens.

## What to build

קריאות opens as a list beside a preview of one call. Choosing a row previews that call and keeps
the filter. A selection that is missing, closed, returned, or outside the filter is skipped, and
the first row in the current list is previewed. An empty list has an empty preview.

The list built in #217 remains available as the list view, and it is the only layout on a narrow
screen. The default response includes both layouts, so the server does not need to know the
viewport. The list-view request includes only the list. The list rows keep the marks the tests
already select on. The split rows carry a different mark, so one call is not counted twice.

The split header summarises open calls, emergencies, and calls past the goal, in place of the long
lede and the stat row. The warnings stay. There is still no search. The preview's next step, for a
new call or one waiting on a category, links to the call page. A finished or later-state call has
no such strip. The requester's name in the preview is text.

## Acceptance criteria

- [x] The calls spec records the split inbox, the list view, and the narrow-screen rule, before the code
- [x] The default page is the split inbox; the list view is an explicit request; a narrow viewport shows the list
- [x] A selection outside the current list previews the first row; an empty list has an empty preview; the filter is kept
- [x] The list rows keep the existing marks; the split rows are marked differently, so a call is not counted twice
- [x] The preview name does not link to the profile; a new or uncategorised call offers a way to the call page; there is no search
- [x] The route test covers the default, the list view, a good selection, a bad selection, and an empty list
- [x] Clicked on `:3000`, including a narrow width

## Blocked by

- #217 — The open list leads with what needs attention

## Comment — 2026-10-13

קריאות opens as a split inbox. The list view is `view=list`, and below 64rem the default page shows only that list. A row previews that call and keeps the filter. A missing, closed, or out-of-filter selection previews the first row. An empty list has an empty preview. List rows keep their marks. Split rows use a different mark. The preview name is text. A new or uncategorised call links to the call page. The split header counts open calls, emergencies, and calls past the goal, and keeps the way into the filtered list. There is no search.

The route test covers the default, the list view, a good selection, a bad selection, and an empty list. The full suite is green. On `:3000`, a signed-in session: choosing a row changed the preview, the list view dropped the preview, and a narrow width showed only the list.
