---
number: 190
title: Attachments on the call, and "file as document"
status: open
labels: [ready-for-agent]
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

- [ ] Attachments from the Outlook adapter show on the timeline with name, type and size, and open
- [ ] "File as document" creates exactly one Unassigned document through evidence's path, and is audited
- [ ] Filing the same attachment twice is refused or idempotent, never two Documents
- [ ] Clicked on staging with an email to the test mailbox carrying a PDF of a fabricated document

## Blocked by

- #188 — Outlook: the staging test mailbox arrives in the tab
