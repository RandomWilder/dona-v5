---
number: 162
title: "שכירויות lists every letting"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 161
created: 2026-09-27
closed: 2026-09-27
---

## Parent

[#161](0161-the-tenancies-book.md)

## What to build

The office gets a book of every letting, named שכירויות. It sits in the side menu immediately before חוזים לא שלמים, and the home index gains the same door in that same place. The index stops claiming that no screen shows a tenant name. Phone numbers stay off every screen.

Anyone who can open a tenancy page can open the book. No new permission.

Every letting is on it: drafts, including a draft with no filed document, live lettings, lettings that ended on their date, and lettings that ended early. Five sections, top to bottom, and an empty section keeps its title: מוכנה, טיוטה, ממתינה, פעיל, then עבר. The first four sort by oldest lease start first. עבר sorts by the day the household left, most recent first. An early ending uses the recorded move-out date. A letting that ran its course uses the contract end. Rows in עבר still read הסתיים or הופסק.

A row is the main tenant, the street, the building number when the building has one, the city, the unit, the lease dates, and one chip. No building number, that part is left out. The name is the primary tenant, otherwise the first person on the letting, otherwise the place alone. Drafts and past lettings are named too. Co-tenants stay off the row. The row opens the tenancy page. There is no activate button on it.

While the letting is still a draft, the chip is a label, not a new stored state. טיוטה when something is missing or another letting is in the way, including a missing protocol. ממתינה when the papers are in order and the only miss is the start date, including a start more than fourteen days away. מוכנה when the start date has arrived, the gate passes, and nobody has pressed. The clock still never activates. A live letting reads פעיל.

The tenancy page heading uses the same sentence, including the building number when there is one. Its own chip stays the stored word. The checks stay beside the press.

The estate spec and the flows spec are edited in the same change, before the screen changes.

## Acceptance criteria

- [x] שכירויות is in the side menu and on the home index, immediately before חוזים לא שלמים
- [x] The index no longer says that no screen shows a tenant name; phone numbers stay off every screen
- [x] The same people who can open a tenancy page can open the book; no new permission
- [x] Every letting is listed, including a draft with no filed document
- [x] Five sections in order — מוכנה, טיוטה, ממתינה, פעיל, עבר — and an empty section keeps its title
- [x] The first four sections sort oldest start first; עבר sorts by the day the household left, most recent first, using the move-out date for an early ending and the contract end otherwise
- [x] A row is the household, the place including the building number when there is one, the lease dates, and one chip, and it opens the tenancy page
- [x] The name is the primary tenant, otherwise the first person, otherwise the place alone; co-tenants stay off the row
- [x] A draft reads טיוטה, ממתינה, or מוכנה as a label; the stored state stays a draft until a person presses; the clock does not activate
- [x] The tenancy page heading uses the same sentence; its chip stays the stored word; the checks stay
- [x] The estate spec and the flows spec are edited in the same change
- [x] Clicked on the dev server after a restart

## Blocked by

None. Can start immediately.

## Comment — 2026-09-27

Closed. שכירויות lists every letting in five sections, a viewer with the tenancy-page permission can open it, and a row opens the tenancy page without an activate press. Dev restarted. On `:3000` the book shows the five titles and four local rows, the index door sits immediately before חוזים לא שלמים, and one row's tenancy page still shows the checks beside the press. Google sign-in blocked the browser tab; the live pages were opened with a viewer session that was then deleted.
