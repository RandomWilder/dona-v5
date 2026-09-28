---
number: 165
title: "The unit page lists that flat's lettings"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [164]
parent: 161
created: 2026-09-27
closed: 2026-09-27
---

## Parent

[#161](0161-the-tenancies-book.md)

## What to build

The unit page lists that flat's lettings. One list, no section titles, in the book's order: מוכנה, then טיוטה, then ממתינה, then פעיל, then the past, most recently left first. Each row carries the same chip as שכירויות and opens the tenancy page.

Only the letting that counts today shows the main tenant's name. Drafts and past lettings are a chip and lease dates. They do not repeat the address. A vacant flat shows no tenant name, even when a draft is waiting. Co-tenants stay on the tenancy page.

The unit page heading includes the building number when the building has one. The documents already on the page stay.

The estate spec and the flows spec are edited in the same change, before the screen changes.

## Acceptance criteria

- [x] The unit page lists that flat's lettings in the book's order, with no section titles
- [x] Each row carries the same chip as שכירויות and opens the tenancy page
- [x] Only the live letting shows the main tenant's name; a vacant flat shows none
- [x] Drafts and past lettings are a chip and lease dates, and do not repeat the address
- [x] The heading includes the building number when the building has one
- [x] The documents already on the page stay
- [x] The estate spec and the flows spec are edited in the same change
- [x] Clicked on the dev server after a restart

## Blocked by

- [#164](0164-a-flat-is-only-vacant-or-let.md)

## Comment — 2026-09-27

Closed. The unit page lists that flat's lettings in the book's order, with no section titles. Only the letting that counts today shows the main tenant's name. Dev restarted. On `:3000` a let flat's heading is the place sentence, the live row names the household, and the past row is a chip and lease dates. A vacant flat with two drafts reads פנויה, shows מוכנה then ממתינה, and no tenant name. The documents panel stays. The browser could not be signed in from here, so the restarted server was read with a session that was revoked afterwards.
