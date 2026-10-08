---
number: 195
title: The emergency reply by email
status: open
labels: [ready-for-human]
assignee:
blocked_by: [185, 188]
parent: 181
created: 2026-10-06
closed:
---

## Parent

#181 — Service calls arrive from every channel into one קריאות tab.

## What to build

When an email is flagged an emergency, the system replies once on the same thread, from the shared
mailbox, with the fixed text and the duty phone number, composed from the duty contact rows with no
model involved. It uses `Mail.Send`, scoped to that one mailbox and used for this reply only (decided
6 Oct 2026). The reply lands in Sent Items like any office reply and appears on the call's timeline.
Its wording is the director's to approve; until then staging sends the placeholder.

Needs from outside the repo: the pilot grant (#188) is `Mail.Read` only. Before this can be clicked,
Dona Dom's administrator adds the Exchange role Application Mail.Send on the same one-mailbox scope.

## Acceptance criteria

- [x] A flagged email produces exactly one reply on its thread, from the staging test mailbox
- [x] A second emergency email on the same open call does not send a second reply
- [x] A call flagged by hand sends nothing
- [x] No other code path can send mail; the send is behind one function used by this reply alone
- [ ] Clicked on staging: the reply is in the test mailbox's Sent Items and on the timeline

## Blocked by

- #185 — Emergency: the flag, the pin and the editable terms
- #188 — Outlook: the staging test mailbox arrives in the tab

## Comment — 2026-10-08

A flagged email gets one reply on its own thread, from the configured mailbox, before the sorter or the translator is asked. The sentence is the placeholder duty text. A second emergency on that open call does not send another. A hand flag sends nothing. The reply is on the call's timeline and audited. Graph refusing the send leaves the message held, and the next delivery sends once. The only mail send is that reply.

Left for the director: click it on staging, once Dona Dom's administrator adds Application Mail.Send on the same one-mailbox scope. The wording stays the placeholder until it is approved.
