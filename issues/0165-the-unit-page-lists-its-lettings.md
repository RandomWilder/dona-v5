---
number: 165
title: "The unit page lists that flat's lettings"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [164]
parent: 161
created: 2026-09-27
closed:
---

## Parent

[#161](0161-the-tenancies-book.md)

## What to build

The unit page lists that flat's lettings. One list, no section titles, in the book's order: מוכנה, then טיוטה, then ממתינה, then פעיל, then the past, most recently left first. Each row carries the same chip as שכירויות and opens the tenancy page.

Only the letting that counts today shows the main tenant's name. Drafts and past lettings are a chip and lease dates. They do not repeat the address. A vacant flat shows no tenant name, even when a draft is waiting. Co-tenants stay on the tenancy page.

The unit page heading includes the building number when the building has one. The documents already on the page stay.

The estate spec and the flows spec are edited in the same change, before the screen changes.

## Acceptance criteria

- [ ] The unit page lists that flat's lettings in the book's order, with no section titles
- [ ] Each row carries the same chip as שכירויות and opens the tenancy page
- [ ] Only the live letting shows the main tenant's name; a vacant flat shows none
- [ ] Drafts and past lettings are a chip and lease dates, and do not repeat the address
- [ ] The heading includes the building number when the building has one
- [ ] The documents already on the page stay
- [ ] The estate spec and the flows spec are edited in the same change
- [ ] Clicked on the dev server after a restart

## Blocked by

- [#164](0164-a-flat-is-only-vacant-or-let.md)
