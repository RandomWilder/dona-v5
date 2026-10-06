---
number: 196
title: Gmail standby adapter
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [186]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

The same adapter interface, implemented against the Gmail API with the `gmail.readonly` scope and the
Gmail thread as the thread. Tested on recorded payloads and wired to no mailbox. It is the standby if
the client's inbox is ever Gmail. Sending an emergency reply from Gmail is not built; it would need
another scope and is decided if Gmail is ever wired.

## Acceptance criteria

- [ ] Recorded Gmail payloads normalise to the same incoming message as their Outlook equivalents
- [ ] Nothing configures or schedules the adapter
- [ ] No scope beyond `gmail.readonly` appears anywhere

## Blocked by

- #186 — The intake door, with the sorter faked
