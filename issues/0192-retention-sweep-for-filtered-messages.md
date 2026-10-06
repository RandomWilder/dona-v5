---
number: 192
title: Retention sweep for filtered messages
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

Filtered messages are kept for 6 months and then deleted by a scheduled sweep, unless they were
rescued into a call. The originals stay in the mailbox and on the phone whatever this system keeps.
The sweep is idempotent, logs how many it deleted, and deletes nothing else.

## Acceptance criteria

- [ ] A Filtered message older than 6 months is deleted by the sweep; a younger one is not
- [ ] A rescued message, and a call returned to filtered, are handled as SPEC-calls.md says, with a test for each
- [ ] Running the sweep twice deletes nothing the second time
- [ ] The sweep runs on a schedule on staging

## Blocked by

- #186 — The intake door, with the sorter faked
