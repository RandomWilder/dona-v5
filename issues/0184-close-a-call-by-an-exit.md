---
number: 184
title: Close a call by one of the four Exits
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [183]
parent: 181
created: 2026-10-06
closed: 2026-10-06
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

An office worker closes a call before any Visit, from any state before SCHEDULED, by one of four
Exits, each with a required reason:
- **Answered**, with a note. A question is a ServiceCall and closes this way.
- **Forwarded**, with the department that owns it (finance, legal and the like) and a note.
- **Duplicate**, naming the call it repeats; the two are linked. Moving the messages between them
  arrives with the intake door, since manual calls carry none yet.
- **Cancelled**, with a note.

A call with no Exit reason is not closed. A closed call is never reopened. Closed calls leave the open
list and the rail count, and remain reachable from a closed filter.

## Acceptance criteria

- [x] Each of the four Exits closes a call from NEW, IDENTIFIED or TRIAGED, and records its reason and the staff account
- [x] An Exit without its reason is refused; a policy case covers it, red first
- [x] Forwarded requires a department; Duplicate requires an existing other call and links both ways
- [x] A closed call cannot be moved to any state
- [x] The rail count and the open list drop the closed call; a closed filter shows it
- [ ] Clicked on `:3000` and on staging

## Blocked by

- #183 — Call page: identify the sender by hand and set a Category

## Comment — 2026-10-06

An office worker closes a call from NEW, IDENTIFIED, or TRIAGED by Answered, Forwarded, Duplicate, or Cancelled. Each exit records its reason and the staff account. A blank note, a Forwarded close without a department, and a Duplicate that does not name another existing call are refused, and the database refuses them too. A closed call cannot change state. It leaves the open list and the rail count, and the closed filter still shows it. A duplicate points at the call it repeats, and that call lists the one that named it. Messages are not moved; a call logged by hand carries none, and that move waits for the intake door.

The restarted server on `:3000` took the form: a blank reason was refused, an answered close left the open list and the rail, the closed filter showed it, and a duplicate linked both ways. Staging is still after merge.
