---
number: 164
title: "A flat is only פנויה or מושכרת"
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

On נכסים, a flat is only פנויה or מושכרת. פנויה means no letting counts today, even when a draft is waiting. מושכרת means a letting counts today, even when that letting ends soon. חוזה בטיוטה and בסיום stop being names for the flat, on the tile and on the unit page. The ending date stays on the letting. חוזים מסתיימים still lists a live letting that ends inside its window. Vacancy headlines still count a flat as vacant whenever nobody counts today.

The tile stays nameless. It shows the flat's word, plus the chip and lease dates of the letting that counts today and of the next draft when there is one. The past is not on the tile. Two drafts: the earlier start is the one on the tile; the other is not dropped from the book, but it is not on the tile. The chip is the same label as on שכירויות: טיוטה, ממתינה, מוכנה, or פעיל. Tiles stay the same width and the same height. The legend drops the two retired words. Parking and storage stay as they are.

The estate spec and the flows spec are edited in the same change, before the screen changes.

## Acceptance criteria

- [ ] A flat reads only פנויה or מושכרת, on the tile and on the unit page
- [ ] A waiting draft does not stop a flat reading פנויה; an ending soon does not stop it reading מושכרת
- [ ] חוזה בטיוטה and בסיום are gone as names for the flat
- [ ] חוזים מסתיימים is unchanged, and vacancy headlines still count a flat as vacant when nobody counts today
- [ ] The tile stays nameless and shows the chip and lease dates of the letting that counts today and of the next draft
- [ ] The past is not on the tile; two drafts put the earlier start on the tile
- [ ] Tiles stay equal in size; parking and storage are unchanged
- [ ] The estate spec and the flows spec are edited in the same change
- [ ] Clicked on the dev server after a restart

## Blocked by

None. Can start immediately.
