---
number: 192
title: Retention sweep for filtered messages
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

Filtered messages are kept for 6 months and then deleted by a scheduled sweep, unless they were
rescued into a call. The originals stay in the mailbox and on the phone whatever this system keeps.
The sweep is idempotent, logs how many it deleted, and deletes nothing else.

## Acceptance criteria

- [x] A Filtered message older than 6 months is deleted by the sweep; a younger one is not
- [x] A rescued message, and a call returned to filtered, are handled as SPEC-calls.md says, with a test for each
- [x] Running the sweep twice deletes nothing the second time
- [x] The sweep runs on a schedule on staging

## Blocked by

- #186 — The intake door, with the sorter faked

## Comment — 2026-10-08

Closed. The sweep deletes a filtered message older than six months and leaves a younger one, including on a month that has no matching day. A rescued message stays. A call returned to filtered loses its messages once the return is older than six months, and the call record stays. A second run deletes nothing. Staging deploys a daily job at 04:00 Israel time. Production is not scheduled.

The document bucket has no delete, so a filtered message's attachment bytes stay until a person removes them. `./infra/bootstrap.sh staging` has to be run once before the next staging deploy, or the new schedule step fails: it grants the deploy identity Cloud Scheduler and lets that service mint a token for the runtime account.
