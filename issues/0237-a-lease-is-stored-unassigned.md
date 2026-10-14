---
number: 237
title: "A lease is stored unassigned, and its flat is chosen at opening"
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed: 2026-10-14
---

## Parent

#232: A lease is unassigned until its draft opens ([0232](0232-a-lease-is-unassigned-until-its-draft-opens.md)).

## What to build

Uploading a lease no longer asks for, or decides, a flat. Every door that uploads a lease (A16's המסמך, A12, A1's unit-first door, the flat page) stores it as an **Unassigned document**:
- under the object path `unassigned/lease/<file hash>.<ext>`;
- with no `document_link` written at upload.

A unit carried by the door is kept only as a preselection for opening. Duplicate bytes are still news, with a link to the existing document. Other document types are unchanged.

The deterministic place reader still runs at upload, and its result is kept as the reading's address proposal. On פתיחת טיוטה, the flat is chosen:
- **Preselected** when the address resolves to exactly one flat, or when the door carried one.
- **Otherwise** a candidate list and search, under A12's four sentences (nothing read, annex, in nobody's portfolio, several flats). Create-building and create-flat are offered under `estate.write`, through the existing A11/A13 commands.

A chosen flat whose address disagrees with the reading is shown side by side and does not refuse. The press writes the document's `UNIT` `SUBJECT` link exactly once, beside everything #234 writes.

"Which flat is this document about" reads the path when the path names a place, and the `SUBJECT` link when it is unassigned. An unopened lease has neither, so search, retrieval and office answers do not reach it.

A16's stepper becomes **המסמך · הקריאה · פתיחת טיוטה · הטיוטה · די היום**. Documents filed under place paths before this ticket keep their paths and their anchors.

Spec: ADR-0015; SPEC-evidence "An unassigned lease"; SPEC-flows A1, A12, A16 as amended at #232.

## Acceptance criteria

- [x] A lease uploaded through each door is stored under the unassigned path, with no link. The same file uploaded again shows the existing document.
- [x] The path builder refuses the unassigned root for any type other than `lease`. `PlaceKind` is unchanged.
- [x] A lease whose address resolves to one flat opens with that flat preselected. A lease uploaded from a flat page opens with that flat preselected.
- [x] Zero, several, nothing read and annex each show their sentence, the candidates and search. An admin sees create; an operator does not.
- [x] A chosen flat that disagrees with the read address is shown beside it, and opening is allowed.
- [x] Opening writes exactly one `UNIT` `SUBJECT` link. The anchor of the document is that flat from then on.
- [x] An unopened lease is not returned by search, retrieval or the office question-answer panel.
- [x] A document filed under a place path before this change still resolves to its flat.
- [x] The stepper shows the five new beats.
- [x] HTTP tests at the A16 seam; the storage-path unit tests cover the new builder.
- [x] Clicked on `:3000`: upload a fixture lease without choosing a flat, then open it.

## Comment — 2026-10-14

Every lease door now files through `fileDocument` with no place: A16, A12, the flat page, and a call's attachment. The bytes go to `unassigned/lease/<hash>.<ext>` and no link is written. The same bytes again are refused, with a link to the existing document's filing workspace. Beside the bytes sits `<hash>.proposal.json`. It holds the place reader's output and the door's flat, if any. SPEC-evidence now names this file: a preselection for פתיחת טיוטה that nothing else reads. The issue asked that the door's flat be "kept only as a preselection", and this file is where it is kept.

On פתיחת טיוטה the flat is chosen in this order:
- the anchor;
- else the flat posted or picked on the screen;
- else the door's flat;
- else an exact address match.

The press locks the document row, then writes the one `UNIT` `SUBJECT` link. Attaching to an existing letting links that letting's flat, not the screen's.

`anchorOf` reads the path when it names a place, and that link when it does not. Search excludes an unassigned document with no link. A lease filed under a place path before this change keeps its path, its link and its flat. A flat asked for on the screen does not override it. That case is in `lease-opening.test.ts`, checked by a mutation that makes the posted flat win.

Clicked on `:3000` while signed in. A fixture lease (a fictional tenant, made for the click and deleted afterwards) was uploaded through A16 without choosing a flat. It was stored as `gs://dona-v5-dev-docs/unassigned/lease/41b0….pdf` with no link. פתיחת טיוטה preselected הברוש 171 · דירה 3 from the address. After both dates and the tenant were signed, the press opened the draft with exactly one `UNIT` `SUBJECT` link, plus the `TENANCY` and `SIGNATORY` links. The full suite passed with 1198 tests, plus the 41 hook tests.

## Blocked by

- #234
