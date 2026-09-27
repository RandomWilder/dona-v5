---
number: 163
title: "The work list calls a waiting draft ממתינה"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 161
created: 2026-09-27
closed:
---

## Parent

[#161](0161-the-tenancies-book.md)

## What to build

חוזים לא שלמים stays the list of what needs a person today. It does not become the book, and it still does not name a household.

A draft whose only miss is the start date, and whose start falls inside the fourteen-day window, keeps its place in נדלקות בקרוב. The block title stays. The chip changes from the old "arms on" wording to ממתינה, and it still shows the date. A waiting draft whose start is further out than fourteen days stays off this block.

מוכנה היום and מוכנה מאז stay on the ready block of this list and nowhere else in this ticket. A draft with no filed document stays off the list, as it does today.

The estate spec and the flows spec are edited in the same change, before the screen changes.

## Acceptance criteria

- [ ] The waiting chip reads ממתינה and still shows the date
- [ ] The block title stays נדלקות בקרוב, and the fourteen-day window is unchanged
- [ ] A waiting draft outside that window stays off the block
- [ ] מוכנה היום and מוכנה מאז stay on the ready block
- [ ] The list still shows no household name
- [ ] A draft with no filed document stays off the list
- [ ] The estate spec and the flows spec are edited in the same change
- [ ] Clicked on the dev server after a restart

## Blocked by

None. Can start immediately.
