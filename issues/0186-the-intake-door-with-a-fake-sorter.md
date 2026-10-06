---
number: 186
title: The intake door, with the sorter faked
status: open
labels: [ready-for-agent]
assignee:
blocked_by: [183, 185]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

Every channel will enter through one door, and this ticket builds it in `channel` with no real channel
yet. An adapter's only job will be to hand the door one normalised incoming message: Source channel,
external message id, external thread id, sender address, received time, subject, body, attachments,
and whether it is an echo. The door then runs, in this order: de-duplicate on the external message
id; store the Message; check for an emergency deterministically; thread; sort.

Threading: a message on a thread with an open call attaches to it. A message on a thread whose call
is closed opens a new call linked to the closed one. Sorting goes through the sorter port, injected,
and here only a fake: a verdict of call opens a ServiceCall in NEW with the proposed Category and
summary stored and displayed; unsure opens one marked "to review"; noise becomes a Filtered message.
A port failure becomes a "to review" call, and never drops the message. An echo is stored on the
conversation and the call's timeline and never opens a call.

The tab gains the filtered list, with rescue (a Filtered message becomes a call) and return to
filtered (a call the office judges not to be one goes back, marked returned, counted in no closed
figure, with the sorter's label kept beside the office's). The Duplicate Exit now moves the
messages to the call it repeats. Messages show on the call page's timeline.

Sender identification is not here; every call from the door waits in NEW for a person to identify
it until the identification ticket.

## Acceptance criteria

- [ ] The door's contract is tested with an injected fake sorter, against real Postgres
- [ ] The same external message id delivered twice is stored once
- [ ] A message matching an emergency term is flagged before the sorter is called; a test proves the sorter was not called first
- [ ] Threading attaches to an open call, and opens a linked new call when the thread's call is closed
- [ ] Call, unsure and noise verdicts each land where SPEC-channel.md says; a throwing sorter yields a "to review" call
- [ ] An echo never opens a call
- [ ] Rescue and return to filtered work from the screen and keep the labels described
- [ ] Duplicate moves the messages
- [ ] A dev-only way to push a fabricated message through the door exists, so the path is clickable on `:3000`

## Blocked by

- #183 — Call page: identify the sender by hand and set a Category
- #185 — Emergency: the flag, the pin and the editable terms
