---
number: 161
title: "שכירויות: the book of every letting"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: []
parent:
created: 2026-09-27
closed:
---

## Problem Statement

The office can find a letting only by the job that mentions it. חוזים לא שלמים lists what still needs a person. חוזים מסתיימים lists what ends inside sixty days. נכסים shows one word on the flat. There is no screen of every letting — past, current, and draft — and the word on the flat currently mixes the flat with the letting. A draft whose papers are in order and whose start is months away looks like the same unfinished thing as a draft that is missing its protocol. The administrator cannot open one book, see who is let where, and tell a waiting start from a missing document.

## Solution

A new screen, שכירויות, lists every letting. A row names the household, the place, the lease dates, and one chip, and opens the tenancy page. The activate press stays on that page. While a letting is still a draft, the chip is a label read from the activation gate, not a new stored state: טיוטה when something is missing or another letting is in the way, ממתינה when the only miss is the start date, מוכנה when the gate passes and nobody has pressed. The work list keeps its job and adopts ממתינה for the waiting chip. A flat on נכסים is only פנויה or מושכרת. The tile and the unit page show the lettings; only the unit page, and only the live letting, names the household.

## User Stories

1. As an administrator, I want a screen named שכירויות in the side menu immediately before חוזים לא שלמים, so that the book of lettings sits next to today's work.
2. As an administrator, I want the same door on the home index, immediately before חוזים לא שלמים, so that the book is reachable from the same place as the other office screens.
3. As an administrator, I want the home index to stop saying that no screen shows a tenant name, so that the index does not deny what שכירויות shows. Phone numbers stay off every screen.
4. As an administrator who can open a tenancy page, I want to open שכירויות with that same permission, so that no new role is required.
5. As an administrator, I want שכירויות to list every letting, including drafts, live lettings, lettings that ended on their date, and lettings that ended early, so that the book is the whole portfolio.
6. As an administrator, I want a draft that has no filed document to appear on שכירויות, so that a letting exists before its paper does.
7. As an administrator, I want the book in five sections from top to bottom — מוכנה, טיוטה, ממתינה, פעיל, then עבר — so that what needs a person sits above what is only waiting, and the past sits at the bottom.
8. As an administrator, I want an empty section to keep its title, so that the shape of the book does not change with the portfolio.
9. As an administrator, I want מוכנה, טיוטה, ממתינה, and פעיל sorted by oldest lease start first, so that the letting that has been waiting longest is first in its section.
10. As an administrator, I want עבר sorted by the day the household left, most recent first, so that a recent departure sits above an older one.
11. As an administrator, I want an early ending to sort by the recorded move-out date, and a letting that ran its course to sort by the contract end, so that a household that left in March sits below one that stayed through June.
12. As an administrator, I want each row to show the main tenant, the street, the building number when the building has one, the city, the unit, the lease dates, and one chip, so that the row is the same sentence as the tenancy.
13. As an administrator, I want a building with no number to omit that part of the sentence, so that the row does not invent one.
14. As an administrator, I want the name to be the primary tenant, otherwise the first person on the letting, otherwise the place alone, so that a letting with no household still has a row.
15. As an administrator, I want drafts and past lettings on שכירויות to carry the household name too, so that the book does not go nameless for the rows that are not live.
16. As an administrator, I want co-tenants to stay on the tenancy page, so that the row names one person.
17. As an administrator, I want a row to open the tenancy page, so that the checks and the press are one click away.
18. As an administrator, I want no activate button on the row, so that I see why the gate is dark before I press.
19. As an administrator, I want a draft that is missing a protocol, or blocked by another letting, to read טיוטה, so that a reason to stay draft is not dressed up as waiting.
20. As an administrator, I want a draft whose papers are in order, or whose protocol was waived, and whose only miss is the start date, to read ממתינה, so that a March letting is not called ready.
21. As an administrator, I want a draft whose start date has arrived, whose gate passes, and which nobody has pressed, to read מוכנה, so that the book shows that a person may press.
22. As an administrator, I want ממתינה and מוכנה to be labels on a draft, so that the stored state stays a draft until a person presses.
23. As an administrator, I want the clock to keep never activating a letting, so that a start date arriving does not make the letting live.
24. As an administrator, I want a live letting to read פעיל, a letting that ran its course to read הסתיים, and an early ending to read הופסק, so that those three words stay what they already are.
25. As an administrator, I want the tenancy page heading to use the same sentence, including the building number when there is one, so that the page and the row do not disagree about the place.
26. As an administrator, I want the tenancy page to keep listing the gate checks, so that why a draft is not live stays beside the press.
27. As an administrator, I want a protocol waiver to remain one named person and one written reason, with no second approver, so that "approved" does not grow a new step.
28. As an administrator, I want חוזים לא שלמים to stay the work list, so that opening the book is not how I find what needs a person today.
29. As an administrator, I want the work list's waiting chip to read ממתינה and still show the date, so that the same draft is not called נדלקת on one screen and ממתינה on the other.
30. As an administrator, I want the waiting block to keep the title נדלקות בקרוב, so that the title still names the fourteen-day window.
31. As an administrator, I want a ממתינה draft whose start is more than fourteen days away to appear on שכירויות and to stay off נדלקות בקרוב, so that the work list does not become the whole future.
32. As an administrator, I want מוכנה היום and מוכנה מאז to stay on the work list only, so that the book has the one word מוכנה.
33. As an administrator, I want the work list to keep refusing a party name, so that today's jobs stay a list of places.
34. As an administrator, I want search to keep refusing a party name, so that the book is the only portfolio list that names a household.
35. As an administrator, I want a flat on נכסים to read only פנויה or מושכרת, so that the tile names the flat and not the letting.
36. As an administrator, I want פנויה to mean no letting counts today, including when a draft is waiting, so that an empty flat with a March letting is still empty.
37. As an administrator, I want מושכרת to mean a letting counts today, including when that letting ends soon, so that an ending date does not rename the flat.
38. As an administrator, I want חוזה בטיוטה and בסיום to stop being names for the flat, so that those facts live on the letting instead.
39. As an administrator, I want חוזים מסתיימים to keep listing a live letting that ends inside its window, so that the ending date still has its work list.
40. As an administrator, I want vacancy headlines to keep counting a flat as vacant whenever nobody counts today, so that a waiting draft does not fill a vacant count.
41. As an administrator, I want the נכסים tile to stay nameless, so that the building grid is not a roll of households.
42. As an administrator, I want the tile to show the chip and lease dates of the letting that counts today, and of the next draft when there is one, so that the flat and its lettings are both visible without opening the unit.
43. As an administrator, I want the past to stay off the tile, so that a flat's history does not compete with who is there now.
44. As an administrator, I want two drafts on one flat to put the earlier start on the tile, so that the tile has one next draft and the other is not dropped from the book.
45. As an administrator, I want the unit page to list that flat's lettings in the book's order, with no section titles, so that a handful of lettings is one list.
46. As an administrator, I want each letting on the unit page to open its tenancy page, and to carry the same chip as שכירויות, so that the flat and the book agree.
47. As an administrator, I want only the live letting on the unit page to show the main tenant's name, so that the page answers who is there today.
48. As an administrator, I want a vacant flat's unit page to show no tenant name, even when a draft is waiting, so that a future household is not presented as the current one.
49. As an administrator, I want drafts and past lettings on the unit page to be a chip and lease dates, without repeating the address, so that the page does not restate the place it is already about.
50. As an administrator, I want the documents already on the unit page to stay, so that the new list does not replace the paper.
51. As an administrator, I want the unit page heading to include the building number when the building has one, so that two buildings on one street stay distinct after the drill.
52. As an administrator, I want parking and storage vacancy to stay as they are, so that this change is about flats and lettings.

## Implementation Decisions

- Estate renders שכירויות, the tile, the unit-page list, the work-list chips, the tenancy heading, the side menu, and the home index. Tenancy already owns the activation gate and the lettings. The three draft chips are a reading of that gate. No second copy of its checks is written.
- A draft reads מוכנה when the gate says it can be activated. It reads ממתינה when the only failing check is that the start date has not arrived, including a start beyond fourteen days. Every other failure, including a missing protocol and a letting in the way, reads טיוטה. A recorded protocol waiver is the existing one-person write; it is not a new approval.
- Nothing is stored for the chip, and nothing is stored for the flat's word. Counts-today stays the occupancy read that already decides whether a letting covers today. A מוכנה draft does not occupy the flat. The clock still never activates.
- עבר holds lettings that ended on their date and lettings that ended early. The sort date is the recorded move-out when the letting ended early, and the contract end when it ran its course. The section title is עבר. The row chip stays הסתיים or הופסק.
- The household name is the primary tenant already on the letting, then the first person in the order the tenancy page already uses, then the place with no person. Co-tenants are not added to the sentence. The name is not written onto the unit.
- The building number is the one the building already has. When it is absent, that part of the sentence is left out. The sentence is used on the שכירויות row, the tenancy page heading, and the unit page heading.
- The work list's waiting block keeps its fourteen-day window and its title. Only the chip changes, from the old "arms on" wording to ממתינה plus the date. מוכנה היום and מוכנה מאז stay on the ready block of that list and nowhere else. That list still does not name a person. A draft with no filed document stays off that list, as it does today, and still appears in the book.
- The tile shows פנויה or מושכרת, plus the chip and lease dates of the letting that counts today and of the next draft. The next draft is the one with the earlier start among drafts that have not ended. The tile stays the same width and the same height across the grid. The legend drops חוזה בטיוטה and בסיום. Parking and storage chips are unchanged.
- The unit page lists that flat's lettings in the book order without section titles. Only the letting that counts today shows the main tenant's name. The documents already on the page stay.
- שכירויות uses the same read permission as the tenancy page. No new permission, no migration, no new column.
- SPEC-estate.md and SPEC-flows.md are edited in the same change as the screens, before the code that changes the behaviour. CONTEXT.md already records that a tenancy is the letting. [ADR-0011](../docs/decisions/ADR-0011-the-tenancies-book-may-name-the-household.md) records that this list may name the household.

## Testing Decisions

A good test asserts what an administrator sees: the section, the sentence, the chip, the name, and where the name is absent. It does not assert how the chip is computed, and it does not re-prove the activation gate.

One seam: the rendered office pages. That is the seam the inventory tiles and the tenancy page already use. The cases that today expect חוזה בטיוטה, בסיום, or the old waiting chip are rewritten to the words in this spec. New cases cover the five sections, a nameless building number, the three draft chips including a start beyond fourteen days, the past sort by move-out against contract end, the work list keeping מוכנה היום and מוכנה מאז, the tile showing the earlier draft and no past, and the unit page naming only the live letting.

The policy gate and the eval set are unchanged: nothing a model may decide moves.

The screens are clicked on the dev server after a restart, on the book, the work list, a tile, and a unit page.

## Out of Scope

A name on the נכסים tile. Moving the activate press onto a row. A new stored state, including a future state. A second approver for a protocol waiver. A household name on search, on חוזים לא שלמים, or on חוזים מסתיימים. Changing who may open a tenancy. Automatic activation when the start date arrives. Co-tenant names on a row.

## Further Notes

The tile stays nameless in this work. A later change can put a name on it. Nothing here depends on that staying true.

The tenancy page chip stays the stored word. The derived chips are the labels on the book, the unit list, the tile, and the work list's waiting rows. The checks on the tenancy page remain the explanation.
