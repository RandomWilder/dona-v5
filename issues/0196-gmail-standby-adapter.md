---
number: 196
title: Gmail standby adapter
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [186]
parent: 181
created: 2026-10-06
closed: 2026-10-08
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The same adapter interface, implemented against the Gmail API with the `gmail.readonly` scope and the
Gmail thread as the thread. Tested on recorded payloads and wired to no mailbox. It is the standby if
the client's inbox is ever Gmail. Sending an emergency reply from Gmail is not built; it would need
another scope and is decided if Gmail is ever wired.

## Acceptance criteria

- [x] Recorded Gmail payloads normalise to the same incoming message as their Outlook equivalents
- [x] Nothing configures or schedules the adapter
- [x] No scope beyond `gmail.readonly` appears anywhere

## Blocked by

- #186 — The intake door, with the sorter faked

## Comment — 2026-10-08

The standby is in. A recorded Gmail message becomes the same incoming mail as the Outlook message it matches: the Gmail thread is the thread, a reply stays on it, and a file is kept while an image embedded in the message is not. Nothing reads a setting, starts a poll, or sends. The only scope named is `gmail.readonly`. Wiring a mailbox, if the inbox is ever Gmail, is a later decision, and so is sending.
