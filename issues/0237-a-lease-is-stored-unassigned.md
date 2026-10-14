---
number: 237
title: "A lease is stored unassigned, and its flat is chosen at opening"
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [234]
parent: 232
created: 2026-10-14
closed:
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

- [ ] A lease uploaded through each door is stored under the unassigned path, with no link. The same file uploaded again shows the existing document.
- [ ] The path builder refuses the unassigned root for any type other than `lease`. `PlaceKind` is unchanged.
- [ ] A lease whose address resolves to one flat opens with that flat preselected. A lease uploaded from a flat page opens with that flat preselected.
- [ ] Zero, several, nothing read and annex each show their sentence, the candidates and search. An admin sees create; an operator does not.
- [ ] A chosen flat that disagrees with the read address is shown beside it, and opening is allowed.
- [ ] Opening writes exactly one `UNIT` `SUBJECT` link. The anchor of the document is that flat from then on.
- [ ] An unopened lease is not returned by search, retrieval or the office question-answer panel.
- [ ] A document filed under a place path before this change still resolves to its flat.
- [ ] The stepper shows the five new beats.
- [ ] HTTP tests at the A16 seam; the storage-path unit tests cover the new builder.
- [ ] Clicked on `:3000`: upload a fixture lease without choosing a flat, then open it.

## Blocked by

- #234
