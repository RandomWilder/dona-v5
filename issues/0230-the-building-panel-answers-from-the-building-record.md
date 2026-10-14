---
number: 230
title: The Building panel answers from the Building record
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [227]
parent: 226
created: 2026-10-13
closed: 2026-10-14
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

- [x] Estate exposes a read command for the Building record; evidence calls it and reads no estate table.
- [x] On a Building bound the model input carries the Building record whatever tools were chosen; a portfolio bound carries none.
- [x] The record carries no party and no rent.
- [x] Bay and storage counts include how many of each are assigned.
- [x] A Unit-line citation is validated against the Units in this Building's record; any other id is dropped.
- [x] Both Building pages render `כרטיס הבניין` citations linking to the Building page or the cited Unit page.
- [x] The existing Building golden cases (lettings list, protocol search, empty roll) still pass.
- [x] Golden case, red first: "how many four-room flats are there" on a Building with no paper answers from the Unit lines. The full golden set passes.
- [x] Clicked on `:3000` on both Building pages: a count question answers and its citation opens the right page.

## Comment — 2026-10-14

Estate has a new command, `readBuildingRecord`, in `src/estate/internal/record.ts`. It returns the Building's name, address, city, project, handover date, warranty end and status, one line per Unit (number, floor, rooms, area, tenure, built bay, built storage room), and the counts of bays and storage rooms with how many of each are assigned. A Space counts as assigned when a Unit was built with it or when a letting active today assigns it. Which letting is active today is scope's `resolveActiveTenancy`, asked once per Unit, so a letting with no party yet still assigns its spaces. The assigned spaces are then read through the existing `listOccupiedAssignments`, which carries no day predicate. The record has no party and no rent. A test seeds both, plus an ended letting whose bay must not count, and asserts the model input.

Evidence calls `readBuildingRecord` on every Building-bound turn, whichever tools the chooser picked, and hands it to the model as a `RECORD (כרטיס הבניין)` block. The portfolio bound loads no record. The answering model is now always called on a Building bound. The empty-roll sentence still answers when the list was fetched and empty, no hit came back, and the answer does not cite the record. So the model is asked first, and its refusal in that state becomes the empty roll. The existing empty-roll test changed for that reason: it used to assert that the model was not called. A Building-bound refusal is now `אין בכרטיס ובמסמכים תשובה לשאלה הזו.`, and two route tests that pinned the old sentence on the Building pages were updated.

The model names the Unit lines it drew on through `record_units`, by Unit number, which is a new required field in the answering schema. The turn maps those numbers to the Units in the record it loaded and drops any it does not hold. When exactly one line remains, the citation is `{ kind: 'record', record: 'building', id, unitId }` and links to that Unit. Otherwise the citation names the Building. The policy case `tests/policy/office-record-citation.test.ts` gains this. It was red first by mutation: with the model's string taken as the `unitId`, an invented line linked to it. Both Building pages render the citation as `כרטיס הבניין`.

Golden case 016 asks "how many four-room flats" of a fixture Building with no paper. It was red on the turn as it stood before this change (refused, no citation) and green 3/3 after. The record line was first labelled `תאריך מסירה`, and with that label case 009 (protocol search, which asserts the words `מועד המסירה`) dropped from 4/5 at baseline to 2/5. Relabelled `מועד המסירה`, it went 7/8. The code review found that the prompt edit had narrowed the Unit-bound rule "do not mention another Unit" and dropped "a Building" from the no-widening sentence. Both are restored. Against the final prompt the full keyed run passed: golden 16/16, sorter 14/14, extraction required 14/14. The Building and Unit-record cases then passed three more times, 27/27.

Clicked after a fresh `npm run dev`. That server came up on :3001, because another session held :3000 with an older build; it served this tree against the same local database. On בניין מלאות, the old Building page answered "how many 4-room flats" with `בבניין יש דירה אחת בת 4 חדרים — דירה 2.`. Its `כרטיס הבניין` link opened דירה 2's page. The נכסים page answered "how many flats and how many bays" with `בבניין יש 3 דירות ו-2 חניות.`. Its link opened the Building page. Both answers match the database. The review fixes that followed — reusing `listOccupiedAssignments`, typing the status, restoring the prompt sentences — were covered by the tests and the keyed run, not by a second click.

## Blocked by

- #227
