---
number: 227
title: The Unit panel answers from the Unit record
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: []
parent: 226
created: 2026-10-13
closed: 2026-10-14
---

## Parent

#226 — The office turn reads the Unit record and the Building record.

## What to build

The tracer bullet. An operator on a Unit page asks about the flat itself — its size, floor, rooms,
mamad, tenure, the bay or storage room it was built with — and the panel answers from the **Unit
record** even when the flat has no Documents, citing `כרטיס הדירה` with a link to the Unit page.

This ticket carries the record's physical half only: Unit number, Building name and address, floor,
rooms, area, mamad, tenure, built bay and built storage room by number, with every field the account
does not hold marked `לא רשום`. The active letting is #228.

On a Unit bound the record is loaded every turn, search still runs every turn, and the answering
model is always called — the "no hits, refuse without the model" short-circuit no longer applies to a
Unit bound. When neither the record nor the hits answer, the turn refuses with
`אין בכרטיס ובמסמכים תשובה לשאלה הזו.` The portfolio bound keeps its sentence and its short-circuit.
A Building bound is unchanged until #230.

The thread's citation gains the record kind; the model's record citation is validated against the
record loaded this turn, persisted, and rendered by the Unit panel as `כרטיס הדירה` linking to the
Unit page. Existing Document-and-page citations, including old thread rows, are unchanged.

SPEC-evidence (#113) and SPEC-estate (#114) are amended first to say so.

## Acceptance criteria

- [x] Estate exposes a read command for the Unit record; evidence calls it and reads no estate table.
- [x] On a Unit bound with zero Passage hits, the answering model is called and is given the Unit record.
- [x] A field the account does not hold reaches the model as `לא רשום`, never omitted.
- [x] The model input carries no phone and no ID number.
- [x] Built bay and built storage room are labelled as built.
- [x] A Unit-bound refusal is `אין בכרטיס ובמסמכים תשובה לשאלה הזו.`; a portfolio-bound refusal is unchanged and still skips the model on zero hits.
- [x] A record citation is persisted on the thread; a record id the model invents is dropped.
- [x] The Unit panel renders a record citation as `כרטיס הדירה` linking to the Unit page; old Document citations still render.
- [x] Golden cases, each red first: a Unit with no Documents answered from the record; a `לא רשום` field refused rather than guessed; another flat's question on this Unit's bound refused. The full golden set passes.
- [x] Clicked on `:3000` after restarting `npm run dev`: a seeded Unit with no Documents answers its area and the citation opens the Unit page.

## Comment — 2026-10-14

Estate has a new command, `readUnitRecord`, in `src/estate/internal/record.ts`. It returns a typed value. Evidence calls it on every Unit-bound office turn and reads no estate table. The answering model is now always called on a Unit bound. It receives the record as a `RECORD (כרטיס הדירה)` block. In that block every field is present, a missing floor, area, bay or storage room reads `לא רשום`, and the bay and the storage room are labelled `מהבנייה`. The record selects no party column, so no phone and no ID number can reach the model. A test seeds both and asserts that neither does.

The model says whether it used the record through `cites_record`, a boolean. It never names an id. The turn attaches `{ kind: 'record', record: 'unit', id }` for the record it loaded, and attaches nothing when no record was loaded. So "a record id the model invents is dropped" holds by construction. The policy case `tests/policy/office-record-citation.test.ts` pins this. It was red first: with the guard removed, the no-record case kept a citation.

A Unit-bound refusal is now `אין בכרטיס ובמסמכים תשובה לשאלה הזו.`. The portfolio bound keeps its own sentence, and it still skips the model when there are no hits. `OfficeCitation` in staff is now a union. A stored citation with no `kind` reads as a Document citation, so old rows are unchanged. The Unit panel renders a record citation as `כרטיס הדירה`, linking to the Unit page.

There are three new golden cases, 011–013. Case 011 was red against the old turn, which refused on zero hits without calling the model. Cases 012 and 013 are refusals, and the old turn would also have passed them, so they guard this change rather than prove it. The keyed run passed: golden 13/13, sorter 14/14, extraction required 14/14.

Clicked on `:3000` after a restart. The flat was Unit 2 at בניין מלאות, which has no documents. Asked its area, the panel answered `שטח הדירה הוא 97 מ״ר.`, and asked its floor, it answered `הדירה נמצאת בקומה 1.`. Both answers cite `כרטיס הדירה`, which links to `/estate/units/<id>`. The click session used a locally minted test-operator session.

The view already renders a Building record citation as `כרטיס הבניין`, linking to `/estate/buildings/:id`, because the citation type allows it. Nothing produces one until #230.

## Blocked by

None (can start immediately).
