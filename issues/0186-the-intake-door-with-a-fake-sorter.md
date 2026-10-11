---
number: 186
title: The intake door, with the sorter faked
status: closed
labels: [ready-for-agent]
assignee:
blocked_by: [183, 185]
parent: 181
created: 2026-10-06
closed: 2026-10-06
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

- [x] The door's contract is tested with an injected fake sorter, against real Postgres
- [x] The same external message id delivered twice is stored once
- [x] A message matching an emergency term is flagged before the sorter is called; a test proves the sorter was not called first
- [x] Threading attaches to an open call, and opens a linked new call when the thread's call is closed
- [x] Call, unsure and noise verdicts each land where SPEC-channel.md says; a throwing sorter yields a "to review" call
- [x] An echo never opens a call
- [x] Rescue and return to filtered work from the screen and keep the labels described
- [x] Duplicate moves the messages
- [x] A dev-only way to push a fabricated message through the door exists, so the path is clickable on `:3000`

## Comment — 2026-10-06

Closed after review. The door takes one normalised message, stores it once, checks an emergency before the sorter, and either attaches to the open call on that thread or opens a new call in NEW linked to the closed one. A call verdict keeps the proposed category and Hebrew summary beside the call; they do not become the call's category and they do not move it out of NEW. Unsure, and a sorter that throws, open a call marked for review. Noise is filtered unless the text matches an emergency term, in which case it is still a flagged call. An echo is stored and never opens a call. The filtered list rescues a message into a call and returns a call without closing it, keeping the sorter's label beside הוחזר. A duplicate exit moves that call's messages onto the one it repeats. Identification and the duty reply are later tickets.

Clicked on `:3000` after a restart: the dev form sent an email, the call opened in NEW with the proposal and the message (including the file name) on the timeline, and the filtered list rendered empty. The test call was removed afterwards.

## Comment — 2026-10-06

A returned call was still offered the four Exits, and saving one was refused because a returned call cannot be closed. The page now offers rescue instead, and leaves the exits until the call is back on the open list. The filtered list and the dev intake form are in the screen registry. The Hebrew body column is marked as the same personal text as the original.

## Comment — 2026-10-06

The door stored the message only after the emergency check, so a check that threw lost it. The message is now stored first. The same delivery again finishes that one row: one call, and the sorter runs once. A returned call put back on the open list keeps the sorter's label; the office's "returned" mark is cleared because the call is no longer returned, which is what the mark means.

## Blocked by

- #183 — Call page: identify the sender by hand and set a Category
- #185 — Emergency: the flag, the pin and the editable terms
