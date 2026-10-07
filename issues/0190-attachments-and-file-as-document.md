---
number: 190
title: Attachments on the call, and "file as document"
status: open
labels: [ready-for-human]
assignee:
blocked_by: [188]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

Attachments stay on their Message and show on the call's timeline, viewable by staff. An office
worker can file one as a document: through evidence's filing path, it becomes an Unassigned document
(לא מתוייק) for the office to file. That is the only way an attachment becomes a Document.

## Acceptance criteria

- [x] Attachments from the Outlook adapter show on the timeline with name, type and size, and open
- [x] "File as document" creates exactly one Unassigned document through evidence's path, and is audited
- [x] Filing the same attachment twice is refused or idempotent, never two Documents
- [ ] Clicked on staging with an email to the test mailbox carrying a PDF of a fabricated document

## Comment — 2026-10-07

An attachment stays on its message. The call shows the name, the type and the size, and the office opens the file from the call. Filing goes through evidence's path: the office declares the type, the file is anchored to the unit the isolation join names when that address is exactly one household, and the document has no tenancy link. A guarantor's contact is not a match. Filing the same attachment again is that document, and both the filing and the attachment write are audited.

A file the mailbox marks as embedded is not an attachment. A file whose bytes were not fetched is shown and cannot be opened or filed. A PDF whose text does not carry the chosen type's words is refused; a scan with no text layer is filed unverified.

Left for the director: the staging click, an email to the test mailbox carrying a PDF of a fabricated document. That click waits on the same mailbox as #188.

## Blocked by

- #188 — Outlook: the staging test mailbox arrives in the tab
