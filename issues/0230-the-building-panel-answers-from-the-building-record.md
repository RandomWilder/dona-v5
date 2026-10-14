---
number: 230
title: The Building panel answers from the Building record
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [227]
parent: 226
created: 2026-10-13
closed:
---

## Parent

#226 — The office turn reads the Unit record and the Building record.

## What to build

An operator on a Building page — the old page or the נכסים page — asks about the building itself
or its inventory and gets an answer from the **Building record**, even when the Building has no
paper and no active lettings.

The Building record carries the Building's name, address, city, project, handover date, warranty
end and status; one line per Unit (number, floor, rooms, area, tenure, built bay, built storage
room); and the counts of bays and storage rooms in the Building with how many of each are assigned
to a Unit or by an active letting. No parties and no rent: who is let today stays the lettings list.
Missing fields read `לא רשום`.

On a Building bound the record is loaded every turn; the tool chooser still picks search, list or
both. The answering model is always called; the empty-roll sentence still applies only when the list
was fetched, was empty, and nothing else answers. A Building-bound refusal is
`אין בכרטיס ובמסמכים תשובה לשאלה הזו.`

A record citation names the Building, or — for an answer about one Unit line — that Unit. The panel
on both Building pages renders it as `כרטיס הבניין` linking to the Building page, or to the Unit
page for a Unit line.

SPEC-evidence (#123) and SPEC-estate (#121) are amended first.

## Acceptance criteria

- [ ] Estate exposes a read command for the Building record; evidence calls it and reads no estate table.
- [ ] On a Building bound the model input carries the Building record whatever tools were chosen; a portfolio bound carries none.
- [ ] The record carries no party and no rent.
- [ ] Bay and storage counts include how many of each are assigned.
- [ ] A Unit-line citation is validated against the Units in this Building's record; any other id is dropped.
- [ ] Both Building pages render `כרטיס הבניין` citations linking to the Building page or the cited Unit page.
- [ ] The existing Building golden cases (lettings list, protocol search, empty roll) still pass.
- [ ] Golden case, red first: "how many four-room flats are there" on a Building with no paper answers from the Unit lines. The full golden set passes.
- [ ] Clicked on `:3000` on both Building pages: a count question answers and its citation opens the right page.

## Blocked by

- #227
