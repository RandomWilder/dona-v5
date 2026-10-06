---
number: 184
title: Close a call by one of the four Exits
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [183]
parent: 181
created: 2026-10-06
closed:
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

- [ ] Each of the four Exits closes a call from NEW, IDENTIFIED or TRIAGED, and records its reason and the staff account
- [ ] An Exit without its reason is refused; a policy case covers it, red first
- [ ] Forwarded requires a department; Duplicate requires an existing other call and links both ways
- [ ] A closed call cannot be moved to any state
- [ ] The rail count and the open list drop the closed call; a closed filter shows it
- [ ] Clicked on `:3000` and on staging

## Blocked by

- #183 — Call page: identify the sender by hand and set a Category
